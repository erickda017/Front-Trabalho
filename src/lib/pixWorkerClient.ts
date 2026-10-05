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
import { extrairCamposPorTexto } from "@/lib/textoCabecalhoPdf";
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

// [2026-10] Worker (OCR.space, plano gratuito) falha em rajada depois de
// ~100 PDFs seguidos e volta sozinho depois de um tempo. Duas proteções:
//  - 1 nova tentativa (após 3s) em erro de rede/429/5xx;
//  - depois de 3 falhas SEGUIDAS, o Worker fica "em pausa" por 60s: os
//    próximos PDFs nem tentam (não gastam 20s de timeout cada) e usam só a
//    leitura local de texto (lib/textoCabecalhoPdf.ts). Qualquer sucesso
//    zera o contador.
const FALHAS_PARA_PAUSAR = 3;
const PAUSA_WORKER_MS = 60_000;
let falhasSeguidas = 0;
let workerPausadoAte = 0;

export function workerEmPausa(): boolean {
  return Date.now() < workerPausadoAte;
}

function registrarResultadoWorker(ok: boolean) {
  if (ok) {
    falhasSeguidas = 0;
    return;
  }
  falhasSeguidas++;
  if (falhasSeguidas >= FALHAS_PARA_PAUSAR) {
    workerPausadoAte = Date.now() + PAUSA_WORKER_MS;
    falhasSeguidas = 0;
    console.warn(`[pixWorkerClient] Worker falhou ${FALHAS_PARA_PAUSAR}x seguidas -- pausado por ${PAUSA_WORKER_MS / 1000}s, usando só leitura local do PDF.`);
  }
}

type RespostaConsulta = { campos: CamposOcr | null; transitorio: boolean };

async function consultarWorkerUmaVez(recorte: Blob, nome: string): Promise<RespostaConsulta> {
  const formData = new FormData();
  formData.append("file", recorte, nome);

  let resposta: Response;
  try {
    resposta = await fetch(WORKER_URL, { method: "POST", body: formData });
  } catch (err) {
    // "Failed to fetch": rede/CORS -- o Worker estourado às vezes responde
    // sem cabeçalho CORS, e o navegador mostra como erro de rede.
    console.warn(`[pixWorkerClient] falha de rede no Worker (${nome}):`, (err as Error).message);
    return { campos: null, transitorio: true };
  }
  if (!resposta.ok) {
    const corpoErro = await resposta.text().catch(() => "");
    console.warn(`[pixWorkerClient] worker respondeu ${resposta.status} (${nome}):`, corpoErro.slice(0, 200));
    return { campos: null, transitorio: resposta.status === 429 || resposta.status >= 500 };
  }

  const json = (await resposta.json().catch(() => null)) as RespostaWorker | null;
  if (!json?.success) {
    if (json?.error) console.warn(`[pixWorkerClient] ${nome}:`, json.error);
    // Resposta "success:false" com corpo = OCR rodou e não achou nada (não é
    // falha do Worker); sem corpo JSON = resposta quebrada (trata como falha).
    return { campos: null, transitorio: !json };
  }

  return {
    transitorio: false,
    campos: {
      pixCopiaColaTexto: json.data?.pixCopiaCola ?? null,
      valor: json.data?.valor ?? null,
      vencimento: json.data?.vencimento ?? null,
      linhaDigitavel: json.data?.linhaDigitavel ?? null,
      codigo: json.data?.codigo ?? null,
      nome: json.data?.nome ?? null,
    },
  };
}

// Chama o Worker pra OCR do recorte. O `pixCopiaCola` que o Worker
// eventualmente devolver é só fallback de texto impresso -- a fonte
// principal do Pix é o QR lido localmente (pixExtractor.ts).
async function consultarWorker(recorte: Blob, nome: string): Promise<CamposOcr | null> {
  if (workerEmPausa()) return null;
  let r = await comTimeout(consultarWorkerUmaVez(recorte, nome), TIMEOUT_POR_PAGINA_MS, { campos: null, transitorio: true });
  if (r.transitorio && !workerEmPausa()) {
    await new Promise((ok) => setTimeout(ok, 3000));
    r = await comTimeout(consultarWorkerUmaVez(recorte, nome), TIMEOUT_POR_PAGINA_MS, { campos: null, transitorio: true });
  }
  registrarResultadoWorker(!r.transitorio);
  return r.campos;
}

// Campos vazios de `base` preenchidos com os de `extra` (nunca sobrescreve).
function completar(base: CamposOcr, extra: Partial<CamposOcr> | null): CamposOcr {
  if (!extra) return base;
  const out = { ...base };
  for (const k of Object.keys(out) as (keyof CamposOcr)[]) out[k] ??= extra[k] ?? null;
  return out;
}

// [2026-10] Ordem: 1) leitura LOCAL do texto do PDF (rápida, sem rede, sem
// limite -- lib/textoCabecalhoPdf.ts); 2) Worker/OCR só se faltou Código
// ou Vencimento (PDF escaneado, layout diferente). Antes era só o Worker:
// com ele fora do ar/limitado, TODO PDF ficava sem Código, e a planilha do
// supervisor não casava nada. Quando os dois leem algo, o local vale
// (texto do próprio PDF é exato; OCR pode errar dígito) e o Worker só
// completa o que faltou.
async function extrairCamposOcr(arquivo: File | Blob, nomeArquivo: string): Promise<CamposOcr | null> {
  let doc: any = null;
  try {
    const pdfjsLib = await carregarPdfjs();
    doc = await pdfjsLib.getDocument({ data: await arquivo.arrayBuffer() }).promise;

    let campos: CamposOcr = { pixCopiaColaTexto: null, valor: null, vencimento: null, linhaDigitavel: null, codigo: null, nome: null };
    try {
      const { semTexto: _semTexto, ...lidos } = await extrairCamposPorTexto(doc);
      campos = completar(campos, lidos);
    } catch (err) {
      console.warn("[pixWorkerClient] leitura local de texto falhou:", (err as Error).message);
    }
    if (campos.codigo && campos.vencimento) return campos;

    // Worker: página 1, e se o cabeçalho não estiver lá (sem "Código"), página 2.
    const paginas = Math.min(doc.numPages, MAX_PAGINAS_CABECALHO);
    for (let p = 1; p <= paginas && !workerEmPausa(); p++) {
      const recorte = await recortarCabecalho(doc, p);
      if (!recorte) continue;
      const nome = nomeArquivo.replace(/\.pdf$/i, "") + `-topo-${p}.jpg`;
      const ocr = await consultarWorker(recorte, nome);
      if (ocr?.codigo) return completar(campos, ocr);
      if (ocr && (ocr.valor || ocr.vencimento || ocr.pixCopiaColaTexto)) campos = completar(campos, ocr);
    }
    return Object.values(campos).some(Boolean) ? campos : null;
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
