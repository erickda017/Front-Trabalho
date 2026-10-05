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
const MAX_PAGINAS_CABECALHO = 2;

const TIMEOUT_POR_PAGINA_MS = 20_000;

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

type RespostaWorker = {
  success: boolean;
  data?: {
    pixCopiaCola?: string | null;
    valor?: string | null;
    vencimento?: string | null;
    linhaDigitavel?: string | null;
    codigo?: string | null;
    nome?: string | null;
  };
  error?: string;
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

// Chama o Worker pra OCR do recorte. O `pixCopiaCola` que o Worker
// eventualmente devolver é só fallback de texto impresso -- a fonte
// principal do Pix é o QR lido localmente (pixExtractor.ts).
async function consultarWorker(recorte: Blob, nome: string): Promise<CamposOcr | null> {
  const formData = new FormData();
  formData.append("file", recorte, nome);

  const resposta = await fetch(WORKER_URL, { method: "POST", body: formData });
  if (!resposta.ok) {
    const corpoErro = await resposta.text().catch(() => "");
    console.error(`[pixWorkerClient] worker respondeu ${resposta.status} (${nome}):`, corpoErro);
    return null;
  }

  const json = (await resposta.json().catch(() => null)) as RespostaWorker | null;
  if (!json?.success) {
    if (json?.error) console.warn(`[pixWorkerClient] ${nome}:`, json.error);
    return null;
  }

  return {
    pixCopiaColaTexto: json.data?.pixCopiaCola ?? null,
    valor: json.data?.valor ?? null,
    vencimento: json.data?.vencimento ?? null,
    linhaDigitavel: json.data?.linhaDigitavel ?? null,
    codigo: json.data?.codigo ?? null,
    nome: json.data?.nome ?? null,
  };
}

// Página 1, e se o cabeçalho não estiver lá (sem "Código"), página 2.
async function extrairCamposOcr(arquivo: File | Blob, nomeArquivo: string): Promise<CamposOcr | null> {
  let doc: any = null;
  try {
    const pdfjsLib = await carregarPdfjs();
    doc = await pdfjsLib.getDocument({ data: await arquivo.arrayBuffer() }).promise;
    const paginas = Math.min(doc.numPages, MAX_PAGINAS_CABECALHO);

    let melhor: CamposOcr | null = null;
    for (let p = 1; p <= paginas; p++) {
      const recorte = await recortarCabecalho(doc, p);
      if (!recorte) continue;
      const nome = nomeArquivo.replace(/\.pdf$/i, "") + `-topo-${p}.jpg`;
      const campos = await comTimeout(consultarWorker(recorte, nome), TIMEOUT_POR_PAGINA_MS, null);
      if (campos?.codigo) return campos;
      if (!melhor && campos && (campos.valor || campos.vencimento || campos.pixCopiaColaTexto)) melhor = campos;
    }
    return melhor;
  } catch (err) {
    console.error("[pixWorkerClient] erro ao extrair campos via OCR:", (err as Error).message);
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
