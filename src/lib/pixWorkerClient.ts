// Extração de dados do boleto: valor, vencimento e linha digitável vêm do
// OCR feito pelo Worker `processo-de-pdf` (OCR.space) -- isso continua igual,
// é texto impresso mesmo, o Worker sempre foi bom nisso.
//
// [REESCRITO] O Pix "copia e cola" NÃO depende mais do Worker. Antes, o
// Worker tentava achar o Pix chamando `unpdf.extractImages()` no PDF e
// rodando jsQR nas imagens raster embutidas -- isso nunca funcionou de
// forma confiável: falha silenciosa sempre que o QR é desenhado como VETOR
// (retângulos via operador de desenho do PDF) em vez de vir como imagem
// embutida, que é como muitos geradores de boleto desenham o QR pra ficar
// nítido em qualquer resolução de impressão. `extractImages` simplesmente
// não via nada nesse caso.
//
// Agora o Pix é extraído 100% LOCAL, renderizando a página num <canvas> via
// pdfjs-dist e lendo o QR direto do bitmap com jsQR -- isso não depende de
// como o QR foi desenhado no PDF, só de pixel. Ver `src/lib/pixExtractor.ts`
// pra lógica completa (prioriza o canto inferior direito da página, onde o
// Pix SEMPRE está nos boletos testados, com fallback de página inteira +
// blocos pra casos fora do padrão) e o processamento em lotes de 10 PDFs.
//
// `pdfjs-dist` é importado dinamicamente (nunca no topo do módulo) dentro
// de pixExtractor.ts porque este projeto roda com SSR (TanStack
// Start/Nitro) -- ver comentário lá.
import { extrairPixLocal, extrairPixEmLotes } from "@/lib/pixExtractor";
import { extrairCamposDoBoleto, type RespostaWorkerBruta } from "@/lib/camposBoleto";
import type { AmbienteOcr } from "@/lib/ocrLocal";
export { extrairPixEmLotes };

const WORKER_URL =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ||
  "https://processo-de-pdf.erickramiro2010.workers.dev";

// Limite real do Worker/OCR.space (ver worker.js: OCR_SPACE_LIMIT_BYTES).
const LIMITE_BYTES_WORKER = 1 * 1024 * 1024; // 1MB

// Só duas faixas da página vão pro Worker, empilhadas num JPEG só: o TOPO
// (nome, "Código" = OS da planilha do supervisor, vencimento, valor) e o
// RODAPÉ (linha digitável). Fica em ~200KB, longe do limite de 1MB -- antes
// mandávamos a página inteira e PDFs escaneados estouravam 413. Cabeçalho
// fica na 1ª página ou, quando a 1ª é propaganda, na 2ª.
const FRACAO_FAIXA = 0.12;
const LARGURA_RECORTE_PX = 1800;

// 30s: em lote grande o OCR.space às vezes passa de 20s sem estar fora do ar.
const TIMEOUT_POR_PAGINA_MS = 30_000;

export type DadosPix = {
  pixCopiaCola: string;
  valor: string | null;
  vencimento: string | null;
  linhaDigitavel: string | null;
  codigo: string | null; // "Código" do cabeçalho, ex "010/022067040"
  nome: string | null; // nome do titular lido no cabeçalho (best-effort)
};

type CamposOcr = {
  pixCopiaColaTexto: string | null; // último recurso: Pix como texto impresso, achado pelo OCR (raro)
  valor: string | null;
  vencimento: string | null;
  linhaDigitavel: string | null;
  codigo: string | null;
  nome: string | null;
};


function comTimeout<T>(promise: Promise<T>, ms: number, valorPadrao: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(valorPadrao), ms)),
  ]);
}

async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return pdfjsLib;
}

// Renderiza a página e empilha topo (primeiro -- o Worker usa a 1ª data
// como vencimento) + rodapé num JPEG <= 1MB.
async function recortarCabecalho(doc: any, numeroPagina: number): Promise<Blob | null> {
  const pagina = await doc.getPage(numeroPagina);
  const pagCanvas = document.createElement("canvas");
  const canvas = document.createElement("canvas");
  try {
    const base = pagina.getViewport({ scale: 1 });
    const viewport = pagina.getViewport({ scale: LARGURA_RECORTE_PX / base.width });
    pagCanvas.width = Math.ceil(viewport.width);
    pagCanvas.height = Math.ceil(viewport.height);
    const pagCtx = pagCanvas.getContext("2d");
    const ctx = canvas.getContext("2d");
    if (!pagCtx || !ctx) return null;
    pagCtx.fillStyle = "#ffffff";
    pagCtx.fillRect(0, 0, pagCanvas.width, pagCanvas.height);
    await pagina.render({ canvasContext: pagCtx, viewport }).promise;

    const w = pagCanvas.width;
    const faixa = Math.ceil(pagCanvas.height * FRACAO_FAIXA);
    canvas.width = w;
    canvas.height = faixa * 2;
    ctx.drawImage(pagCanvas, 0, 0, w, faixa, 0, 0, w, faixa);
    ctx.drawImage(pagCanvas, 0, pagCanvas.height - faixa, w, faixa, 0, faixa, w, faixa);

    for (const qualidade of [0.85, 0.6, 0.4]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", qualidade));
      if (blob && blob.size <= LIMITE_BYTES_WORKER) return blob;
    }
    return null;
  } finally {
    for (const c of [pagCanvas, canvas]) { c.width = 0; c.height = 0; }
    try { pagina.cleanup(); } catch (_) { /* noop */ }
  }
}

// [2026-10] Chamada crua ao Worker (1 tentativa) -- a política de
// nova tentativa, a ordem Worker -> leitura local e a fusão dos campos ficam
// em lib/camposBoleto.ts (testável em Node com os PDFs reais).
async function chamarWorker(doc: any, numeroPagina: number, nomeArquivo: string): Promise<RespostaWorkerBruta | null> {
  const recorte = await recortarCabecalho(doc, numeroPagina);
  if (!recorte) return null;
  const formData = new FormData();
  formData.append("file", recorte, nomeArquivo.replace(/\.pdf$/i, "") + `-topo-${numeroPagina}.jpg`);
  const chamada = (async (): Promise<RespostaWorkerBruta> => {
    try {
      const resposta = await fetch(WORKER_URL, { method: "POST", body: formData });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) console.warn(`[pixWorkerClient] worker respondeu ${resposta.status}.`);
      return { status: resposta.status, json };
    } catch (err) {
      // "Failed to fetch": rede/CORS (o Worker estourado às vezes responde
      // sem cabeçalho CORS e o navegador mostra como erro de rede).
      console.warn("[pixWorkerClient] falha de rede no Worker.");
      return { status: "rede", json: null };
    }
  })();
  return comTimeout(chamada, TIMEOUT_POR_PAGINA_MS, { status: "timeout", json: null });
}

// OCR local (fallback): Tesseract.js carregado só quando o Worker falha pela
// 1ª vez -- quem nunca precisa do fallback não baixa nada.
const ambienteOcrNavegador = async (): Promise<AmbienteOcr> => {
  const { createWorker, PSM } = await import("tesseract.js");
  return {
    criarCanvas: (largura, altura) => {
      const c = document.createElement("canvas");
      c.width = largura;
      c.height = altura;
      return c;
    },
    paraImagem: (canvas) => canvas,
    // Mesmo modelo usado na validação com os 95 PDFs reais (português, ~1,4MB, cacheado pelo navegador).
    criarWorkerTesseract: () =>
      createWorker("por", 1, { langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/por/4.0.0_best_int", logger: () => {} }),
    PSM: { AUTO: PSM.AUTO, SPARSE_TEXT: PSM.SPARSE_TEXT, SINGLE_LINE: PSM.SINGLE_LINE },
  };
};

async function extrairCamposOcr(arquivo: File | Blob, nomeArquivo: string): Promise<CamposOcr | null> {
  let doc: any = null;
  try {
    const pdfjsLib = await carregarPdfjs();
    doc = await pdfjsLib.getDocument({ data: await arquivo.arrayBuffer() }).promise;
    const { campos, fonteCodigo } = await extrairCamposDoBoleto(doc, nomeArquivo, {
      chamarWorker: (d, p) => chamarWorker(d, p, nomeArquivo),
      ambienteOcr: ambienteOcrNavegador,
      log: (nivel, msg) => console[nivel](msg),
    });
    if (fonteCodigo && fonteCodigo !== "worker") console.info(`[pixWorkerClient] código lido por fallback (${fonteCodigo}).`);
    return campos;
  } catch (err) {
    console.error("[pixWorkerClient] erro ao extrair campos do PDF:", (err as Error).message);
    return null;
  } finally {
    try { doc?.destroy(); } catch (_) { /* noop */ }
  }
}

// Ponto de entrada principal: roda a extração local do Pix (via QR, ver
// pixExtractor.ts) e o OCR de texto (via Worker) EM PARALELO -- são
// pipelines independentes, um não precisa esperar o outro. O Pix só vem
// como `null` de propósito se nem o QR local nem o fallback de texto do OCR
// acharem nada -- o restante dos campos (valor/vencimento/linha digitável)
// não bloqueia nem é bloqueado pelo resultado do Pix.
export async function extrairDadosPix(arquivo: File | Blob, nomeArquivo = "boleto.pdf"): Promise<DadosPix | null> {
  if (typeof document === "undefined") {
    console.warn("[pixWorkerClient] chamado fora do navegador (SSR?) -- ignorando.");
    return null;
  }

  const [pixLocal, camposOcr] = await Promise.all([
    extrairPixLocal(arquivo).catch((err) => {
      console.error("[pixWorkerClient] falha na extração local do Pix:", (err as Error).message);
      return null;
    }),
    extrairCamposOcr(arquivo, nomeArquivo),
  ]);

  const pixCopiaCola = pixLocal?.pixCopiaCola ?? camposOcr?.pixCopiaColaTexto ?? null;
  if (!pixCopiaCola) return null;

  return {
    pixCopiaCola,
    valor: camposOcr?.valor ?? null,
    vencimento: camposOcr?.vencimento ?? null,
    linhaDigitavel: camposOcr?.linhaDigitavel ?? null,
    codigo: camposOcr?.codigo ?? null,
    nome: camposOcr?.nome ?? null,
  };
}

// Mantido por compatibilidade com código/telemetria antigo que ainda possa
// importar pelo nome anterior -- prefira `extrairDadosPix` em código novo.
export const extrairDadosPixViaWorker = extrairDadosPix;
