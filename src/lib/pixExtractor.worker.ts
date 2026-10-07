// ---------------------------------------------------------------------------
// Web Worker: roda a extração do Pix (render do PDF + jsQR) FORA da thread
// principal, usando OffscreenCanvas em vez de <canvas> do DOM.
// ---------------------------------------------------------------------------
//
// [2026-08] Motivo de existir: `extrairPixLocal` sozinho já levava ~15-20s
// por PDF em testes reais (múltiplos renders em resolução alta + jsQR em
// blocos, ver pixExtractor.ts) -- rodando na thread principal, isso trava a
// página inteira (cliques não respondem, scroll para, spinners congelam)
// pelo tempo todo do processamento. Não reduz o tempo de CPU gasto (mesma
// conta, ver `ALVOS_PX_CANTO` etc.), só tira o trabalho da thread que
// desenha a UI, pra a página continuar respondendo enquanto processa.
//
// A lógica de render+QR em si é EXATAMENTE A MESMA de pixExtractor.ts
// (mesmas regiões, mesmos alvos de resolução, mesma varredura em blocos,
// mesma validação de payload) -- só a fonte do canvas muda: aqui é
// `OffscreenCanvas` (disponível dentro de Workers, sem DOM) em vez de
// `document.createElement("canvas")`. Duplicar essa lógica entre os dois
// arquivos é proposital: manter os dois pipelines idênticos por import
// compartilhado exigiria separar cada função em módulo `-shared.ts` sem
// nenhuma referência a `document`/`HTMLCanvasElement`, o que só compensa se
// o código divergir com o tempo. Por ora, qualquer ajuste na lógica de
// extração (regiões, alvos, overlap) precisa ser espelhado nos dois
// arquivos -- ver `pixExtractor.ts` pro comentário completo de cada
// constante/decisão, aqui só o essencial pra não repetir.

import jsQR from "jsqr";

// ---------------------------------------------------------------------
// Validação do payload Pix (EMV / BR Code) -- idêntico a pixExtractor.ts
// ---------------------------------------------------------------------

function crc16ccitt(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function isValidPixPayload(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  const payload = raw.trim();

  if (!payload.startsWith("000201")) return false;
  if (!payload.includes("br.gov.bcb.pix")) return false;

  const crcMatch = payload.match(/6304([0-9A-Fa-f]{4})$/);
  if (!crcMatch) return false;

  const providedCrc = crcMatch[1]!.toUpperCase();
  const payloadForCrc = payload.slice(0, payload.length - 4);
  return providedCrc === crc16ccitt(payloadForCrc);
}

// ---------------------------------------------------------------------
// Configuração -- MESMOS valores de pixExtractor.ts (ver lá o comentário
// completo de por que cada um foi escolhido).
// ---------------------------------------------------------------------

const MAX_PAGINAS_POR_PDF = 4;
const TIMEOUT_POR_PAGINA_MS = 20_000;

const REGIAO_CANTO_JUSTA = { x0: 0.45, y0: 0.55, x1: 1, y1: 1 };
const REGIAO_CANTO_AMPLA = { x0: 0.28, y0: 0.38, x1: 1, y1: 1 };
const REGIAO_PAGINA_INTEIRA = { x0: 0, y0: 0, x1: 1, y1: 1 };

const ALVOS_PX_CANTO = [1800, 2600];
const ALVOS_PX_CANTO_AMPLO = [2200, 2800];
const ALVOS_PX_PAGINA_INTEIRA = [1800, 2600];

const QR_TILE_COLS = 3;
const QR_TILE_ROWS = 4;
const QR_TILE_OVERLAP = 0.4;
const QR_TILE_MIN_DIMENSAO = 300;

// ---------------------------------------------------------------------
// Render local (pdfjs-dist) -- usa OffscreenCanvas em vez de <canvas> DOM
// ---------------------------------------------------------------------

async function carregarPdfjs() {
  // Dentro de um worker módulo, `import.meta.url` aponta pra este próprio
  // arquivo -- o caminho relativo do worker do pdfjs continua resolvendo
  // certo a partir daqui.
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return pdfjsLib;
}

type RegiaoFracao = { x0: number; y0: number; x1: number; y1: number };

async function renderizarRegiaoDaPagina(
  pagina: any,
  regiao: RegiaoFracao,
  alvoPx: number,
): Promise<OffscreenCanvas | null> {
  const base = pagina.getViewport({ scale: 1 });
  const larguraRecortePt = base.width * (regiao.x1 - regiao.x0);
  const alturaRecortePt = base.height * (regiao.y1 - regiao.y0);
  const maiorLadoRecortePt = Math.max(larguraRecortePt, alturaRecortePt);
  const escala = Math.min(6, Math.max(0.5, alvoPx / Math.max(1, maiorLadoRecortePt)));

  const viewportCompleto = pagina.getViewport({ scale: escala });
  const x0 = viewportCompleto.width * regiao.x0;
  const y0 = viewportCompleto.height * regiao.y0;
  const x1 = viewportCompleto.width * regiao.x1;
  const y1 = viewportCompleto.height * regiao.y1;

  const largura = Math.max(1, Math.ceil(x1 - x0));
  const altura = Math.max(1, Math.ceil(y1 - y0));
  const canvas = new OffscreenCanvas(largura, altura);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(-x0, -y0);

  await pagina.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: viewportCompleto })
    .promise;
  return canvas;
}

function liberarCanvas(canvas: OffscreenCanvas | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

// ---------------------------------------------------------------------
// Leitura de QR -- idêntico a pixExtractor.ts, só o tipo do contexto muda
// ---------------------------------------------------------------------

function lerQrDoRetangulo(
  ctx: OffscreenCanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
): string | null {
  if (w < 20 || h < 20) return null;
  try {
    const imageData = ctx.getImageData(x0, y0, w, h);
    const resultado = jsQR(imageData.data, imageData.width, imageData.height);
    const payload = resultado?.data?.trim();
    return isValidPixPayload(payload) ? payload : null;
  } catch (err) {
    console.warn("[pixExtractor.worker] jsQR falhou:", (err as Error).message);
    return null;
  }
}

function ordemDosBlocos(linhas: number, colunas: number): Array<[number, number]> {
  const ordemLinhas = [linhas - 1, ...Array.from({ length: linhas - 1 }, (_, i) => i)];
  const ordem: Array<[number, number]> = [];
  for (const linha of ordemLinhas) {
    for (let coluna = 0; coluna < colunas; coluna++) ordem.push([linha, coluna]);
  }
  return ordem;
}

function escanearBlocos(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): string | null {
  if (width < QR_TILE_MIN_DIMENSAO || height < QR_TILE_MIN_DIMENSAO) return null;

  const tileWBase = width / QR_TILE_COLS;
  const tileHBase = height / QR_TILE_ROWS;

  for (const [linha, coluna] of ordemDosBlocos(QR_TILE_ROWS, QR_TILE_COLS)) {
    const x0 = Math.max(0, Math.floor(coluna * tileWBase - tileWBase * QR_TILE_OVERLAP));
    const y0 = Math.max(0, Math.floor(linha * tileHBase - tileHBase * QR_TILE_OVERLAP));
    const x1 = Math.min(width, Math.ceil((coluna + 1) * tileWBase + tileWBase * QR_TILE_OVERLAP));
    const y1 = Math.min(height, Math.ceil((linha + 1) * tileHBase + tileHBase * QR_TILE_OVERLAP));

    const pix = lerQrDoRetangulo(ctx, x0, y0, x1 - x0, y1 - y0);
    if (pix) return pix;
  }

  return null;
}

// ---------------------------------------------------------------------
// Extração por página / por PDF -- mesma sequência de pixExtractor.ts
// ---------------------------------------------------------------------

export type ResultadoPixWorker = {
  pixCopiaCola: string;
  pagina: number;
  origem: "canto" | "canto-ampliado" | "pagina-inteira";
};

async function tentarRegiaoEmVariosAlvos(pagina: any, regiao: RegiaoFracao, alvos: number[]): Promise<string | null> {
  for (const alvoPx of alvos) {
    const canvas = await renderizarRegiaoDaPagina(pagina, regiao, alvoPx);
    if (!canvas) continue;
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
      liberarCanvas(canvas);
      continue;
    }

    let pix = lerQrDoRetangulo(ctx, 0, 0, canvas.width, canvas.height);
    if (!pix) pix = escanearBlocos(ctx, canvas.width, canvas.height);
    liberarCanvas(canvas);
    if (pix) return pix;
  }
  return null;
}

async function extrairPixDaPagina(pagina: any, indicePagina: number): Promise<ResultadoPixWorker | null> {
  let pix = await tentarRegiaoEmVariosAlvos(pagina, REGIAO_CANTO_JUSTA, ALVOS_PX_CANTO);
  if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem: "canto" };

  pix = await tentarRegiaoEmVariosAlvos(pagina, REGIAO_CANTO_AMPLA, ALVOS_PX_CANTO_AMPLO);
  if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem: "canto-ampliado" };

  pix = await tentarRegiaoEmVariosAlvos(pagina, REGIAO_PAGINA_INTEIRA, ALVOS_PX_PAGINA_INTEIRA);
  if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem: "pagina-inteira" };

  return null;
}

// [2026-10] CANTO "NATIVO": PDFs de impressora virtual ("Microsoft Print To
// PDF") e escaneados guardam a página como UMA imagem de ~144 dpi, onde o QR
// do Pix tem ~1px por módulo. Pedir ao pdfjs uma escala alta (alvos de
// 1800/2600px acima) faz ELE reamostrar essa imagem, e o resultado ficou
// borrado a ponto do jsQR não ler -- foi o que derrubou 18 de 48 PDFs
// (ex.: faturas da Claro com capa de "primeira fatura" na página 1, QR na
// página 2). Testado no Chromium com os PDFs reais: render em escala 2 (1
// pixel do canvas = 1 pixel da imagem, sem reamostrar) + ampliação do
// canvas com suavização do próprio navegador lê todos. É barato (render
// pequeno), então roda ANTES dos alvos altos, em todas as páginas.
const ESCALA_NATIVA = 2;
const FATOR_AMPLIACAO_NATIVO = 3;

async function tentarCantoNativo(pagina: any, regiao: RegiaoFracao, comBlocos: boolean): Promise<string | null> {
  const viewport = pagina.getViewport({ scale: ESCALA_NATIVA });
  const x0 = Math.floor(viewport.width * regiao.x0);
  const y0 = Math.floor(viewport.height * regiao.y0);
  const w = Math.max(1, Math.ceil(viewport.width * regiao.x1) - x0);
  const h = Math.max(1, Math.ceil(viewport.height * regiao.y1) - y0);

  const origem = new OffscreenCanvas(w, h);
  origem.width = w;
  origem.height = h;
  const ctxOrigem = origem.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctxOrigem) return null;
  ctxOrigem.fillStyle = "#ffffff";
  ctxOrigem.fillRect(0, 0, w, h);
  ctxOrigem.translate(-x0, -y0);
  await pagina.render({ canvasContext: ctxOrigem as unknown as CanvasRenderingContext2D, viewport }).promise;

  const ampliado = new OffscreenCanvas(w * FATOR_AMPLIACAO_NATIVO, h * FATOR_AMPLIACAO_NATIVO);
  const ctxAmpliado = ampliado.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctxAmpliado) {
    liberarCanvas(origem);
    return null;
  }
  ctxAmpliado.imageSmoothingEnabled = true;
  ctxAmpliado.imageSmoothingQuality = "high";
  ctxAmpliado.drawImage(origem as any, 0, 0, w, h, 0, 0, ampliado.width, ampliado.height);
  liberarCanvas(origem);

  let pix = lerQrDoRetangulo(ctxAmpliado, 0, 0, ampliado.width, ampliado.height);
  if (!pix && comBlocos) pix = escanearBlocos(ctxAmpliado, ampliado.width, ampliado.height);
  liberarCanvas(ampliado);
  return pix;
}

async function extrairPixRapidoDaPagina(pagina: any, indicePagina: number): Promise<ResultadoPixWorker | null> {
  for (const [regiao, origem] of [
    [REGIAO_CANTO_JUSTA, "canto"],
    [REGIAO_CANTO_AMPLA, "canto-ampliado"],
  ] as const) {
    // Blocos (lento) só na janela justa; a ampla é só leitura direta -- a
    // varredura completa de sempre cobre o resto na 2ª passada.
    const pix = await tentarCantoNativo(pagina, regiao, origem === "canto");
    if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem };
  }
  return null;
}

function comTimeout<T>(promise: Promise<T>, ms: number, valorPadrao: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(valorPadrao), ms))]);
}

async function extrairPixDoBuffer(buffer: ArrayBuffer): Promise<ResultadoPixWorker | null> {
  let doc: any = null;
  try {
    const pdfjsLib = await carregarPdfjs();
    doc = await pdfjsLib.getDocument({ data: buffer }).promise;

    const totalPaginas = Math.min(doc.numPages, MAX_PAGINAS_POR_PDF);
    // 2 passadas: primeiro só a leitura rápida (nativa) em TODAS as páginas --
    // assim a capa de propaganda da página 1 não gasta o tempo todo da
    // página (varredura pesada sem achar nada) antes de chegar na página
    // com o QR. Só depois a varredura completa de sempre.
    for (const rapido of [true, false]) {
      for (let indice = 0; indice < totalPaginas; indice++) {
        let pagina: any = null;
        try {
          pagina = await doc.getPage(indice + 1);
          const tarefa = rapido ? extrairPixRapidoDaPagina(pagina, indice) : extrairPixDaPagina(pagina, indice);
          const resultado = await comTimeout(tarefa, TIMEOUT_POR_PAGINA_MS, null);
          if (resultado) return resultado;
        } catch (err) {
          if (!rapido) throw err;
          console.warn("[pixExtractor] leitura nativa falhou, segue pro método completo:", (err as Error).message);
        } finally {
          if (pagina && typeof pagina.cleanup === "function") {
            try { pagina.cleanup(); } catch (_) { /* noop */ }
          }
        }
      }
    }
    return null;
  } finally {
    if (doc) {
      if (typeof doc.cleanup === "function") {
        try { doc.cleanup(); } catch (_) { /* noop */ }
      }
      if (typeof doc.destroy === "function") {
        try { doc.destroy(); } catch (_) { /* noop */ }
      }
    }
  }
}

// ---------------------------------------------------------------------
// Protocolo de mensagens com a thread principal
// ---------------------------------------------------------------------
//
// Cada pedido leva um `id` pra casar request/response -- o worker é
// reaproveitado entre chamadas (ver `pixExtractor.ts`), então várias
// extrações podem estar em voo ao mesmo tempo (o worker processa uma de
// cada vez, mas a fila de mensagens permite enfileirar sem trocar de
// worker a cada PDF).

type PedidoExtracao = { id: number; buffer: ArrayBuffer };
type RespostaExtracao =
  | { id: number; ok: true; resultado: ResultadoPixWorker | null }
  | { id: number; ok: false; erro: string };

self.onmessage = async (evento: MessageEvent<PedidoExtracao>) => {
  const { id, buffer } = evento.data;
  try {
    const resultado = await extrairPixDoBuffer(buffer);
    const resposta: RespostaExtracao = { id, ok: true, resultado };
    (self as unknown as Worker).postMessage(resposta);
  } catch (err) {
    const resposta: RespostaExtracao = { id, ok: false, erro: (err as Error).message };
    (self as unknown as Worker).postMessage(resposta);
  }
};
