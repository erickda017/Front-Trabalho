// Extração de dados do boleto: valor, vencimento e linha digitável vêm do
// OCR feito pelo Worker `processo-de-pdf`. O Pix copia-e-cola idealmente
// também vem do Worker (ele já tenta achar via unpdf/extractImages+jsQR,
// sem custo nenhum pro navegador) -- só quando ISSO falha é que escaneamos
// localmente, renderizando a página num <canvas> e rodando jsQR (ver
// escanearPixNaPagina / processarPagina). Deliberadamente NÃO fazemos o scan
// local sempre/em paralelo: renderizar página inteira em alta resolução pra
// todo arquivo é pesado (RAM/CPU do navegador), então isso só roda como
// fallback, pros PDFs que o Worker realmente não resolve sozinho.
//
// FIX (bug: "acha tudo, menos o Pix"): o Worker tentava achar o Pix chamando
// `unpdf.extractImages()` no PDF e rodando jsQR só nas imagens raster
// embutidas encontradas. Isso falha silenciosamente sempre que o QR do
// boleto é desenhado como VETOR (retângulos via operadores de desenho do
// PDF) em vez de vir como uma imagem embutida (Image XObject) -- que é
// exatamente como muitos geradores de boleto desenham o QR, pra ficar
// nítido em qualquer resolução de impressão. `extractImages` simplesmente
// não vê nada nesse caso (não é uma "imagem" do ponto de vista do PDF), daí
// `pixCopiaCola` sempre voltava `null` pra esses boletos, mesmo com o resto
// dos campos (linha digitável, vencimento) extraídos certinho via OCR de
// texto. O Worker roda em Cloudflare Workers, que não tem Canvas/DOM nem
// suporta módulos nativos (@napi-rs/canvas) -- não dá pra renderizar a
// página lá pra resolver isso no servidor. O navegador é o único lugar com
// Canvas disponível "de graça", por isso o fallback é aqui, e só aqui.
//
// Por que fatiar o PDF antes de mandar pro Worker:
// - O back-end (Render, 512MB de RAM) NUNCA MAIS deve tocar em bytes de PDF --
//   nem o Worker deve receber arquivos grandes demais, que custam tempo/CPU de
//   OCR à toa. Um boleto de 4+ páginas frequentemente tem o Pix numa página só
//   (normalmente a 1ª via); as outras são carnê, contrato, aviso etc.
// - Cortamos o PDF em páginas individuais com pdf-lib (100% no navegador) e
//   mandamos cada página separadamente pro Worker, parando assim que uma
//   responder com um Pix válido. Isso mantém cada requisição pequena (< 1MB
//   na esmagadora maioria dos casos, já que sobra só 1 página) e evita
//   deixar o Worker escanear páginas irrelevantes desnecessariamente.
//
// IMPORTANTE (fix 413 + fix SSR): quando uma página fatiada ainda passa de
// 1MB (ex: boleto escaneado com imagem de alta resolução numa página só),
// rasterizamos ela em JPEG comprimido antes de enviar (ver rasterizarComoJpeg)
// em vez de mandar o PDF cru e estourar 413 no Worker/OCR.space.
//
// `pdfjs-dist` é importado dinamicamente (import() dentro da função, nunca no
// topo do módulo) porque este projeto roda com SSR (TanStack Start/Nitro). Um
// import estático de pdfjs-dist no topo do módulo executa
// `pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(...)` durante o SSR
// também -- no servidor não existe `Worker`/DOM, e isso derruba a rota
// inteira com "Something went wrong on our end" mesmo com o build passando.
// Import dinâmico + guard de `typeof document` garantem que esse código só
// roda no navegador.
import { PDFDocument } from "pdf-lib";
import jsQR from "jsqr";

const WORKER_URL =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ||
  "https://processo-de-pdf.erickramiro2010.workers.dev";

// Limite real do Worker/OCR.space (ver worker.js: OCR_SPACE_LIMIT_BYTES).
// Página de PDF que passar disso agora é rasterizada e comprimida como JPEG
// (ver rasterizarComoJpeg) em vez de enviada crua e estourar 413.
const LIMITE_BYTES_POR_PAGINA = 1 * 1024 * 1024; // 1MB

// Só faz sentido procurar o Pix nas primeiras páginas -- na prática ele está
// sempre na capa/1ª via do boleto. Seus boletos giram em torno de 4 páginas,
// então 4 já cobre o documento inteiro sem gastar tempo/rede à toa em casos
// fora da curva (ajuste aqui se algum lote tiver documentos maiores).
const MAX_PAGINAS_POR_PDF = 4;

const TIMEOUT_POR_PAGINA_MS = 20_000;

// Tamanho máximo (maior lado, em px) do bitmap renderizado pra escanear QR.
// jsQR não precisa de DPI alto como o OCR de texto precisa -- um QR de
// boleto (tipicamente uns 3-4cm no papel) fica com módulos de sobra pro
// jsQR mesmo numa página inteira renderizada a ~1200px de lado. Isso é o
// que mantém o custo de RAM/CPU no navegador baixo: um canvas de 1200px é
// ~1/8 dos pixels de um de 3400px (scale 4x numa A4), então ~8x menos
// memória por render. Só escalamos pra cima (ALVO_PX_FALLBACK) se a
// primeira tentativa não achar nada.
const ALVO_PX_SCAN_QR = 1200;
const ALVO_PX_SCAN_QR_FALLBACK = 1800;

// ---------------------------------------------------------------------
// Validação do payload Pix (EMV / BR Code) -- mesma regra usada no Worker
// (ver worker.js: isValidPixPayload/crc16ccitt). Duplicada aqui de propósito:
// o Worker segue validando o Pix que ele mesmo encontra via OCR (texto), e
// aqui validamos o Pix lido do QR direto no navegador -- os dois precisam
// bater no mesmo critério (prefixo 000201, chave br.gov.bcb.pix, CRC16
// correto) pra não devolver lixo pro usuário.
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

export type DadosPix = {
  pixCopiaCola: string;
  valor: string | null;
  vencimento: string | null;
  linhaDigitavel: string | null;
};

type RespostaWorker = {
  success: boolean;
  data?: {
    pixCopiaCola?: string | null;
    valor?: string | null;
    vencimento?: string | null;
    linhaDigitavel?: string | null;
  };
  error?: string;
};

function comTimeout<T>(promise: Promise<T>, ms: number, valorPadrao: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(valorPadrao), ms)),
  ]);
}

// Fatia um PDF em documentos de 1 página cada, na ordem original, limitado a
// MAX_PAGINAS_POR_PDF. Cada página vira um PDF independente e válido (não é só
// um corte de bytes) -- necessário pro Worker conseguir abrir/rasterizar.
async function fatiarPdfEmPaginas(arquivo: File | Blob): Promise<Blob[]> {
  const buffer = await arquivo.arrayBuffer();
  const origem = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPaginas = origem.getPageCount();
  const paginasParaChecar = Math.min(totalPaginas, MAX_PAGINAS_POR_PDF);

  const fatias: Blob[] = [];
  for (let indice = 0; indice < paginasParaChecar; indice++) {
    const novo = await PDFDocument.create();
    const [pagina] = await novo.copyPages(origem, [indice]);
    novo.addPage(pagina);
    // useObjectStreams: false gera um PDF um pouco maior, mas mais compatível
    // com parsers simples de OCR/Worker; o ganho de tamanho de object streams
    // é marginal comparado a já termos cortado pra 1 página só.
    const bytes = await novo.save({ useObjectStreams: false });
    fatias.push(new Blob([bytes], { type: "application/pdf" }));
  }
  return fatias;
}

// `pdfjsLib` é importado dinamicamente aqui dentro -- nunca no topo do
// módulo -- pra não rodar em SSR (ver comentário no topo do arquivo).
async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return pdfjsLib;
}

// Renderiza a 1ª página de um PDF (já fatiado) num <canvas>, numa escala
// fixa (usado pelo rasterizador JPEG) OU limitando o maior lado a `maxDim`
// pixels (usado pelo scanner de QR, que não precisa de tanta resolução --
// ver ALVO_PX_SCAN_QR). Só um dos dois deve ser passado.
async function renderizarPaginaEmCanvas(
  paginaPdfBlob: Blob,
  opcoes: { scale: number } | { maxDim: number },
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") {
    // Estamos em SSR/Node (sem DOM/canvas) -- não há como rasterizar aqui.
    // Isso não deveria acontecer na prática (extrairDadosPixViaWorker já
    // garante que só roda no navegador), mas é uma proteção extra.
    return null;
  }

  const pdfjsLib = await carregarPdfjs();
  const buffer = await paginaPdfBlob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  try {
    const pagina = await doc.getPage(1);

    let scale: number;
    if ("scale" in opcoes) {
      scale = opcoes.scale;
    } else {
      // Descobre o tamanho intrínseco da página (scale 1) pra calcular a
      // escala que faz o maior lado bater em `maxDim` -- independe do
      // tamanho real do PDF (alguns boletos vêm com mediabox gigante).
      const tamanhoBase = pagina.getViewport({ scale: 1 });
      const maiorLado = Math.max(tamanhoBase.width, tamanhoBase.height);
      scale = Math.min(3, Math.max(0.5, opcoes.maxDim / maiorLado));
    }

    const viewport = pagina.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    // Fundo branco -- PDFs com fundo transparente viram imagem preta sem
    // isso (e o jsQR/JPEG ficam ilegíveis).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await pagina.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } finally {
    // Libera os recursos internos do pdf.js (fontes, workers, cache de
    // página) assim que terminamos com essa página -- sem isso, processar
    // muitos arquivos em sequência acumula memória desnecessariamente.
    doc.destroy();
  }
}

// Renderiza a página em JPEG comprimido, reduzindo escala/qualidade em
// passos até caber no limite do Worker. Isso substitui o antigo "manda cru e
// torce" -- que estourava 413 em boletos com imagem de alta resolução (scan)
// numa página só.
async function rasterizarComoJpeg(paginaPdfBlob: Blob, limiteBytes: number): Promise<Blob | null> {
  const tentativas: Array<{ scale: number; quality: number }> = [
    { scale: 2.5, quality: 0.85 },
    { scale: 2.0, quality: 0.8 },
    { scale: 1.5, quality: 0.75 },
    { scale: 1.2, quality: 0.6 },
    { scale: 1.0, quality: 0.5 },
  ];

  for (const { scale, quality } of tentativas) {
    const canvas = await renderizarPaginaEmCanvas(paginaPdfBlob, { scale });
    if (!canvas) continue;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    canvas.width = 0;
    canvas.height = 0;

    if (blob && blob.size <= limiteBytes) return blob;
    // Guarda o menor obtido até agora caso nenhuma tentativa entre no limite.
    if (blob && scale === tentativas[tentativas.length - 1].scale) return blob;
  }
  return null;
}

// FIX (bug: "não acha o Pix quando a página tem mais de um QR Code"):
// boletos com vários QR na mesma página (ex: QR do app da operadora, QR de
// desconto/parceiro, e só um deles sendo o Pix de verdade) faziam esse
// fallback falhar sempre -- jsQR só devolve UM resultado por chamada (o
// primeiro QR que o algoritmo dele encontra na imagem inteira, sem
// garantia nenhuma de que seja o Pix). O mesmo bug existe no Worker (ver
// worker.js: decodificarPixEmBlocos) -- corrigido aqui do mesmo jeito:
// se a imagem inteira não render um Pix válido, recorta em blocos
// sobrepostos e testa cada um. Ver QR_TILE_* abaixo.
const QR_TILE_COLS = 3;
const QR_TILE_ROWS = 4;
const QR_TILE_OVERLAP = 0.18; // 18% de sobreposição -- evita cortar um QR bem na borda de dois blocos
const QR_TILE_MIN_DIMENSAO = 500; // canvas menor que isso já é 1 QR só -- não vale a pena fatiar

// Recorta um retângulo do canvas já renderizado e roda jsQR nele. Reaproveita
// o canvas existente (sem re-renderizar o PDF) -- só um getImageData a mais
// por bloco, bem mais barato que renderizar de novo.
function tentarQrNoRetangulo(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): string | null {
  if (w < 20 || h < 20) return null;
  let payload: string | undefined;
  try {
    const imageData = ctx.getImageData(x0, y0, w, h);
    const resultado = jsQR(imageData.data, imageData.width, imageData.height);
    payload = resultado?.data?.trim();
  } catch (err) {
    console.warn("[pixWorkerClient] jsQR falhou num bloco:", (err as Error).message);
    return null;
  }
  return isValidPixPayload(payload) ? payload : null;
}

// Ordem de varredura: última linha de blocos (fundo da página, onde a
// linha digitável/Pix normalmente fica) primeiro -- resolve rápido no caso
// comum, sem deixar de cobrir a página inteira no pior caso.
function ordemDosBlocos(linhas: number, colunas: number): Array<[number, number]> {
  const ordemLinhas = [linhas - 1, ...Array.from({ length: linhas - 1 }, (_, i) => i)];
  const ordem: Array<[number, number]> = [];
  for (const linha of ordemLinhas) {
    for (let coluna = 0; coluna < colunas; coluna++) ordem.push([linha, coluna]);
  }
  return ordem;
}

// Varre o canvas inteiro em blocos sobrepostos, testando cada QR encontrado
// até achar um Pix válido. Só chamado quando o scan da página inteira (mais
// barato) não achou nada -- ver escanearPixNaPagina.
function escanearBlocos(ctx: CanvasRenderingContext2D, width: number, height: number): string | null {
  if (width < QR_TILE_MIN_DIMENSAO || height < QR_TILE_MIN_DIMENSAO) return null;

  const tileWBase = width / QR_TILE_COLS;
  const tileHBase = height / QR_TILE_ROWS;

  for (const [linha, coluna] of ordemDosBlocos(QR_TILE_ROWS, QR_TILE_COLS)) {
    const x0 = Math.max(0, Math.floor(coluna * tileWBase - tileWBase * QR_TILE_OVERLAP));
    const y0 = Math.max(0, Math.floor(linha * tileHBase - tileHBase * QR_TILE_OVERLAP));
    const x1 = Math.min(width, Math.ceil((coluna + 1) * tileWBase + tileWBase * QR_TILE_OVERLAP));
    const y1 = Math.min(height, Math.ceil((linha + 1) * tileHBase + tileHBase * QR_TILE_OVERLAP));

    const pix = tentarQrNoRetangulo(ctx, x0, y0, x1 - x0, y1 - y0);
    if (pix) return pix;
  }

  return null;
}

// Escaneia o Pix diretamente no navegador: renderiza a página inteira em
// bitmap (isso "achata" QR desenhado como vetor E imagem embutida da mesma
// forma) e roda jsQR em cima. SÓ é chamado como fallback, quando o Worker
// (que é essencialmente de graça pro seu navegador) não encontrou nada -- ver
// processarPagina. Resolução deliberadamente modesta (ver ALVO_PX_SCAN_QR):
// QR tolera bem menos DPI que OCR de texto, então não há motivo pra pagar o
// custo de RAM de renderizar em alta resolução igual ao rasterizarComoJpeg.
async function escanearPixNaPagina(paginaPdfBlob: Blob): Promise<string | null> {
  for (const maxDim of [ALVO_PX_SCAN_QR, ALVO_PX_SCAN_QR_FALLBACK]) {
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await renderizarPaginaEmCanvas(paginaPdfBlob, { maxDim });
    } catch (err) {
      console.warn(`[pixWorkerClient] falha ao renderizar página p/ scan de QR (${maxDim}px):`, (err as Error).message);
      continue;
    }
    if (!canvas) continue;

    const ctx = canvas.getContext("2d");
    let payload: string | null = null;
    if (ctx) {
      // Caminho rápido: página inteira de uma vez (cobre o caso comum -- 1
      // QR só na página, ou o Pix sendo o único "achável" pelo jsQR ali).
      payload = tentarQrNoRetangulo(ctx, 0, 0, canvas.width, canvas.height);
      // Só entra na varredura em blocos (mais cara) se isso não achou nada --
      // ver comentário grande acima de QR_TILE_COLS sobre por que isso é
      // necessário quando a página tem mais de um QR Code.
      if (!payload) {
        payload = escanearBlocos(ctx, canvas.width, canvas.height);
      }
    }

    // Libera o canvas imediatamente -- não espera o fim do escopo/GC natural,
    // importante quando processando muitos arquivos em sequência num import
    // em lote.
    canvas.width = 0;
    canvas.height = 0;

    if (isValidPixPayload(payload)) return payload;
  }
  return null;
}

// Chama o Worker pra OCR (valor, vencimento, linha digitável) e também
// aproveita o Pix que ele já tenta achar sozinho (via unpdf/extractImages --
// funciona quando o QR vem como imagem embutida no PDF, sem custo nenhum de
// CPU/RAM no navegador). Só quando o Worker NÃO acha o Pix é que caímos pro
// fallback local (escanearPixNaPagina) -- ver processarPagina. Isso mantém o
// caminho comum (arquivo que o Worker já resolve sozinho) exatamente tão
// leve quanto antes; o navegador só entra em ação pros PDFs problemáticos
// (QR desenhado como vetor).
async function consultarWorker(
  pagina: Blob,
  nomeArquivo: string,
  indice: number,
): Promise<{ pixCopiaCola: string | null } & Omit<DadosPix, "pixCopiaCola"> | null> {
  let corpo = pagina;
  let nome = nomeArquivo;

  if (corpo.size > LIMITE_BYTES_POR_PAGINA) {
    console.warn(
      `[pixWorkerClient] página ${indice + 1} ficou com ${(corpo.size / 1024 / 1024).toFixed(2)}MB ` +
        `(acima do limite de 1MB) -- rasterizando como JPEG comprimido antes de enviar.`,
    );
    const rasterizado = await rasterizarComoJpeg(corpo, LIMITE_BYTES_POR_PAGINA);
    if (!rasterizado) {
      console.error(`[pixWorkerClient] falha ao rasterizar página ${indice + 1}, pulando OCR.`);
      return null;
    }
    corpo = rasterizado;
    nome = nomeArquivo.replace(/\.pdf$/i, "") + ".jpg";
  }

  const formData = new FormData();
  formData.append("file", corpo, nome);

  const resposta = await fetch(WORKER_URL, { method: "POST", body: formData });
  if (!resposta.ok) {
    const corpoErro = await resposta.text().catch(() => "");
    console.error(`[pixWorkerClient] worker respondeu ${resposta.status} pra página ${indice + 1}:`, corpoErro);
    return null;
  }

  const json = (await resposta.json().catch(() => null)) as RespostaWorker | null;
  if (!json?.success) {
    if (json?.error) console.warn(`[pixWorkerClient] página ${indice + 1}:`, json.error);
    return null;
  }

  return {
    pixCopiaCola: json.data?.pixCopiaCola ?? null,
    valor: json.data?.valor ?? null,
    vencimento: json.data?.vencimento ?? null,
    linhaDigitavel: json.data?.linhaDigitavel ?? null,
  };
}

// Processa uma página: chama o Worker primeiro (barato, roda no servidor).
// Só se ele não trouxer um Pix válido é que escaneamos localmente no
// navegador como fallback -- ver comentário em consultarWorker sobre por que
// essa ordem importa pro custo de RAM/CPU no lado do cliente.
async function processarPagina(
  pagina: Blob,
  nomeArquivo: string,
  indice: number,
): Promise<DadosPix | null> {
  const resultadoWorker = await consultarWorker(pagina, nomeArquivo, indice);

  let pix = resultadoWorker?.pixCopiaCola ?? null;
  if (!pix) {
    pix = await escanearPixNaPagina(pagina).catch((err) => {
      console.warn(`[pixWorkerClient] falha ao escanear QR da página ${indice + 1}:`, (err as Error).message);
      return null;
    });
  }

  if (!pix) return null;

  return {
    pixCopiaCola: pix,
    valor: resultadoWorker?.valor ?? null,
    vencimento: resultadoWorker?.vencimento ?? null,
    linhaDigitavel: resultadoWorker?.linhaDigitavel ?? null,
  };
}

// Ponto de entrada: fatia o PDF e testa página por página no Worker até achar
// um Pix válido. Nunca lança -- um PDF problemático (corrompido, sem Pix,
// Worker fora do ar) só resulta em `null`, sem travar o resto da importação.
//
// Só deve rodar no navegador (usa File/Blob/canvas/pdfjs) -- se por algum
// motivo for chamado durante SSR, retorna null cedo em vez de quebrar a rota.
export async function extrairDadosPixViaWorker(
  arquivo: File | Blob,
  nomeArquivo = "boleto.pdf",
): Promise<DadosPix | null> {
  if (typeof document === "undefined") {
    console.warn("[pixWorkerClient] chamado fora do navegador (SSR?) -- ignorando.");
    return null;
  }

  try {
    const paginas = await fatiarPdfEmPaginas(arquivo);

    for (let i = 0; i < paginas.length; i++) {
      const pagina = paginas[i];

      const nomePagina = nomeArquivo.replace(/\.pdf$/i, "") + `-pagina-${i + 1}.pdf`;
      const dados = await comTimeout(
        processarPagina(pagina, nomePagina, i),
        TIMEOUT_POR_PAGINA_MS,
        null,
      );
      if (dados) return dados;
    }
    return null;
  } catch (err) {
    console.error("[pixWorkerClient] erro ao extrair dados do pdf:", (err as Error).message);
    return null;
  }
}
