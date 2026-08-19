// ---------------------------------------------------------------------------
// Extração do Pix "copia e cola" -- 100% LOCAL (navegador), via QR Code.
// ---------------------------------------------------------------------------
//
// HISTÓRICO (por que este arquivo existe e como as tentativas anteriores
// falharam -- ver CONTEXTO.md pra mais detalhe):
//   1) Renderizar o PDF no backend (Render, pdfjs-dist) pra achar o Pix
//      estourava o limite de RAM do plano free (512MB) -- backend não pode
//      mais tocar em bytes de PDF.
//   2) Mandar a página fatiada pro Worker Cloudflare (`unpdf.extractImages`
//      + jsQR) nunca funcionou de forma confiável: `extractImages` só vê
//      imagens EMBUTIDAS no PDF -- quando o gerador do boleto desenha o QR
//      como VETOR (retângulos via operador de desenho, comum pra manter o
//      QR nítido em qualquer resolução de impressão), não existe "imagem"
//      nenhuma pra extrair e a busca sempre voltava vazia.
//   3) A solução que REALMENTE funciona: renderizar a página num <canvas>
//      no navegador (via pdfjs-dist) e rodar jsQR em cima do bitmap -- isso
//      não depende de como o QR foi desenhado no PDF (vetor ou imagem),
//      porque a essa altura já é só pixel.
//
// O QUE MUDOU NESTA REESCRITA (melhoria de lógica, não só "voltar a
// funcionar"):
//   - O Pix SEMPRE aparece no canto inferior direito das faturas testadas.
//     Em vez de renderizar a página inteira (caro) e depois recortar/varrer
//     em blocos, agora renderizamos DIRETO só o retângulo do canto (ver
//     `renderizarRegiaoDaPagina`) numa escala bem mais alta -- o canvas
//     alocado tem o tamanho do RECORTE, não da página inteira, então dá pra
//     usar resolução alta sem pagar o custo de uma página inteira nessa
//     mesma resolução. Isso resolve o caso comum em 1 render pequeno, sem
//     precisar mais do vaivém "tenta a página inteira, falhou, varre 12
//     blocos".
//   - Full-page + varredura em blocos continua existindo, mas só como
//     fallback pra boletos fora do padrão (layout diferente, Pix não achado
//     no canto) -- ver `extrairPixDaPagina`.
//   - Processamento em LOTES DE 10 PDFs por vez (`extrairPixEmLotes`), com
//     concorrência limitada dentro de cada lote e uma pequena pausa entre
//     lotes -- dá tempo do navegador liberar (GC) os canvases/ArrayBuffers
//     do lote anterior antes de abrir o próximo, em vez de acumular memória
//     de centenas de PDFs em voo ao mesmo tempo. Mesmo padrão já usado (e
//     comprovadamente estável) na extração manual em `routes/pix.tsx`.
//
// `pdfjs-dist` é importado dinamicamente (nunca no topo do módulo) porque
// este projeto roda com SSR (TanStack Start/Nitro) -- um import estático
// executaria `GlobalWorkerOptions.workerSrc = new URL(...)` durante o SSR,
// onde não existe `Worker`/DOM, derrubando a rota inteira. Import dinâmico +
// guard de `typeof document` garantem que só roda no navegador.

import jsQR from "jsqr";

// ---------------------------------------------------------------------
// Validação do payload Pix (EMV / BR Code)
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

  const providedCrc = crcMatch[1].toUpperCase();
  const payloadForCrc = payload.slice(0, payload.length - 4);
  return providedCrc === crc16ccitt(payloadForCrc);
}

// ---------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------

// O Pix está sempre numa das primeiras páginas (capa/1ª via) -- boletos
// giram em torno de 4 páginas, então cobre o documento inteiro sem gastar
// tempo à toa em casos fora da curva.
const MAX_PAGINAS_POR_PDF = 4;

const TIMEOUT_POR_PAGINA_MS = 20_000;

// Retângulo do canto inferior direito, em FRAÇÃO da página (0..1). Primeira
// tentativa: janela justa (onde o Pix normalmente está). Segunda tentativa:
// janela mais generosa, pra boletos com margens/layout um pouco diferentes.
// Em ambos os casos ainda é uma fração pequena da página inteira.
const REGIAO_CANTO_JUSTA = { x0: 0.45, y0: 0.55, x1: 1, y1: 1 };
const REGIAO_CANTO_AMPLA = { x0: 0.28, y0: 0.38, x1: 1, y1: 1 };
const REGIAO_PAGINA_INTEIRA = { x0: 0, y0: 0, x1: 1, y1: 1 };

// Maior lado do recorte renderizado, em pixels. Como o recorte do canto é
// pequeno, dá pra mirar alto (QR fica bem denso/nítido) sem que o canvas
// fique grande -- bem mais barato que a mesma resolução na página inteira.
const ALVO_PX_CANTO_JUSTA = 900;
const ALVO_PX_CANTO_AMPLA = 1200;
// Fallback de página inteira -- só entra se o canto (nas duas tentativas)
// não achar nada. Escalas crescentes, igual à lógica antiga.
const ALVOS_PX_PAGINA_INTEIRA = [1200, 1800];

// Varredura em blocos (só usada no fallback de página inteira) -- cobre
// boletos com mais de um QR Code na mesma página (QR de app/parceiro +
// Pix). Ordem prioriza a última linha (fundo da página) primeiro.
const QR_TILE_COLS = 3;
const QR_TILE_ROWS = 4;
const QR_TILE_OVERLAP = 0.18;
const QR_TILE_MIN_DIMENSAO = 500;

// ---------------------------------------------------------------------
// Render local (pdfjs-dist)
// ---------------------------------------------------------------------

async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return pdfjsLib;
}

type RegiaoFracao = { x0: number; y0: number; x1: number; y1: number };

// Renderiza SÓ o retângulo pedido da página (em fração 0..1), numa escala
// calculada a partir do tamanho do PRÓPRIO RECORTE (não da página inteira)
// -- é isso que permite mirar alto (`alvoPx`) sem alocar um canvas do
// tamanho da página inteira: o canvas só tem o tamanho do recorte.
async function renderizarRegiaoDaPagina(
  pagina: any,
  regiao: RegiaoFracao,
  alvoPx: number,
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;

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

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(x1 - x0));
  canvas.height = Math.max(1, Math.ceil(y1 - y0));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Fundo branco -- PDF com fundo transparente vira imagem preta sem isso,
  // e o jsQR fica ilegível.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Desloca a origem pra o recorte cair dentro do canvas pequeno (que só
  // tem o tamanho do recorte, não da página inteira).
  ctx.translate(-x0, -y0);

  await pagina.render({ canvasContext: ctx, viewport: viewportCompleto }).promise;
  return canvas;
}

function liberarCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

// ---------------------------------------------------------------------
// Leitura de QR
// ---------------------------------------------------------------------

function lerQrDoRetangulo(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): string | null {
  if (w < 20 || h < 20) return null;
  try {
    const imageData = ctx.getImageData(x0, y0, w, h);
    const resultado = jsQR(imageData.data, imageData.width, imageData.height);
    const payload = resultado?.data?.trim();
    return isValidPixPayload(payload) ? payload : null;
  } catch (err) {
    console.warn("[pixExtractor] jsQR falhou:", (err as Error).message);
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

// Varre o canvas inteiro em blocos sobrepostos -- só chamada no fallback de
// página inteira, quando o scan direto da página toda não achou nada
// (ex: boleto com vários QR Codes na mesma página).
function escanearBlocos(ctx: CanvasRenderingContext2D, width: number, height: number): string | null {
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
// Extração por página / por PDF
// ---------------------------------------------------------------------

export type ResultadoPix = {
  pixCopiaCola: string;
  /** Página (1-based) onde o Pix foi encontrado. */
  pagina: number;
  /** De onde veio o resultado -- útil pra depurar/telemetria, não afeta o uso normal. */
  origem: "canto" | "canto-ampliado" | "pagina-inteira" | "blocos";
};

async function extrairPixDaPagina(pagina: any, indicePagina: number): Promise<ResultadoPix | null> {
  // 1) Canto inferior direito, janela justa -- caminho rápido, cobre a
  //    esmagadora maioria dos boletos (o Pix SEMPRE está nessa região).
  let canvas = await renderizarRegiaoDaPagina(pagina, REGIAO_CANTO_JUSTA, ALVO_PX_CANTO_JUSTA);
  if (canvas) {
    const ctx = canvas.getContext("2d");
    const pix = ctx ? lerQrDoRetangulo(ctx, 0, 0, canvas.width, canvas.height) : null;
    liberarCanvas(canvas);
    if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem: "canto" };
  }

  // 2) Canto ampliado -- boletos com margens/layout um pouco diferentes.
  canvas = await renderizarRegiaoDaPagina(pagina, REGIAO_CANTO_AMPLA, ALVO_PX_CANTO_AMPLA);
  if (canvas) {
    const ctx = canvas.getContext("2d");
    const pix = ctx ? lerQrDoRetangulo(ctx, 0, 0, canvas.width, canvas.height) : null;
    liberarCanvas(canvas);
    if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem: "canto-ampliado" };
  }

  // 3) Fallback: página inteira, escalas crescentes, com varredura em
  //    blocos se o scan direto não bater de primeira.
  for (const alvoPx of ALVOS_PX_PAGINA_INTEIRA) {
    canvas = await renderizarRegiaoDaPagina(pagina, REGIAO_PAGINA_INTEIRA, alvoPx);
    if (!canvas) continue;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      liberarCanvas(canvas);
      continue;
    }

    let pix = lerQrDoRetangulo(ctx, 0, 0, canvas.width, canvas.height);
    let origem: ResultadoPix["origem"] = "pagina-inteira";
    if (!pix) {
      pix = escanearBlocos(ctx, canvas.width, canvas.height);
      origem = "blocos";
    }
    liberarCanvas(canvas);
    if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem };
  }

  return null;
}

function comTimeout<T>(promise: Promise<T>, ms: number, valorPadrao: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(valorPadrao), ms)),
  ]);
}

// Ponto de entrada: extrai o Pix de UM PDF, 100% local.
export async function extrairPixLocal(arquivo: File | Blob): Promise<ResultadoPix | null> {
  if (typeof document === "undefined") {
    console.warn("[pixExtractor] chamado fora do navegador (SSR?) -- ignorando.");
    return null;
  }

  let doc: any = null;
  try {
    const pdfjsLib = await carregarPdfjs();
    const buffer = await arquivo.arrayBuffer();
    doc = await pdfjsLib.getDocument({ data: buffer }).promise;

    const totalPaginas = Math.min(doc.numPages, MAX_PAGINAS_POR_PDF);
    for (let indice = 0; indice < totalPaginas; indice++) {
      let pagina: any = null;
      try {
        pagina = await doc.getPage(indice + 1);
        const resultado = await comTimeout(extrairPixDaPagina(pagina, indice), TIMEOUT_POR_PAGINA_MS, null);
        if (resultado) return resultado;
      } finally {
        if (pagina && typeof pagina.cleanup === "function") {
          try { pagina.cleanup(); } catch (_) { /* noop */ }
        }
      }
    }
    return null;
  } catch (err) {
    console.error("[pixExtractor] erro ao extrair Pix do PDF:", (err as Error).message);
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
// Processamento em lotes
// ---------------------------------------------------------------------

const TAMANHO_LOTE_PADRAO = 10;
const CONCORRENCIA_DENTRO_DO_LOTE = 3;

export type ItemParaExtrairPix = { arquivo: File | Blob; nomeArquivo?: string };

export type OpcoesExtracaoEmLotes = {
  tamanhoLote?: number;
  concorrencia?: number;
  onProgresso?: (p: { processados: number; total: number }) => void;
};

// Processa vários PDFs em LOTES DE 10 (por padrão): dentro de cada lote roda
// com concorrência limitada, e só abre o próximo lote quando o atual termina
// -- dá tempo do navegador liberar a memória dos canvases do lote anterior
// antes de começar o próximo, em vez de acumular tudo em voo de uma vez.
export async function extrairPixEmLotes(
  itens: ItemParaExtrairPix[],
  opcoes?: OpcoesExtracaoEmLotes,
): Promise<Array<ResultadoPix | null>> {
  const tamanhoLote = opcoes?.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const concorrencia = opcoes?.concorrencia ?? CONCORRENCIA_DENTRO_DO_LOTE;
  const resultados: Array<ResultadoPix | null> = new Array(itens.length).fill(null);

  for (let inicioLote = 0; inicioLote < itens.length; inicioLote += tamanhoLote) {
    const lote = itens.slice(inicioLote, inicioLote + tamanhoLote);

    let proximoNoLote = 0;
    async function worker() {
      while (proximoNoLote < lote.length) {
        const indiceNoLote = proximoNoLote++;
        const item = lote[indiceNoLote];
        if (!item) continue;
        try {
          resultados[inicioLote + indiceNoLote] = await extrairPixLocal(item.arquivo);
        } catch (err) {
          console.error(`[pixExtractor] falha ao processar "${item.nomeArquivo ?? "arquivo"}":`, (err as Error).message);
          resultados[inicioLote + indiceNoLote] = null;
        }
        opcoes?.onProgresso?.({ processados: inicioLote + indiceNoLote + 1, total: itens.length });
      }
    }

    await Promise.all(Array.from({ length: Math.min(concorrencia, lote.length) }, () => worker()));

    // Pausa curta entre lotes -- deixa o GC do navegador liberar os
    // canvases/ArrayBuffers do lote que acabou de terminar.
    if (inicioLote + tamanhoLote < itens.length) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return resultados;
}
