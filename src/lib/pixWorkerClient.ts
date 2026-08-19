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
// Página de PDF que passar disso é rasterizada e comprimida como JPEG (ver
// rasterizarComoJpeg) em vez de enviada crua e estourar 413.
const LIMITE_BYTES_POR_PAGINA = 1 * 1024 * 1024; // 1MB

// Só faz sentido procurar os campos textuais nas primeiras páginas -- na
// prática o resumo (valor/vencimento/linha digitável) está sempre na
// capa/1ª via do boleto.
const MAX_PAGINAS_POR_PDF = 4;

const TIMEOUT_POR_PAGINA_MS = 20_000;

export type DadosPix = {
  pixCopiaCola: string;
  valor: string | null;
  vencimento: string | null;
  linhaDigitavel: string | null;
};

type CamposOcr = {
  pixCopiaColaTexto: string | null; // último recurso: Pix como texto impresso, achado pelo OCR (raro)
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
  const { PDFDocument } = await import("pdf-lib");
  const buffer = await arquivo.arrayBuffer();
  const origem = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPaginas = origem.getPageCount();
  const paginasParaChecar = Math.min(totalPaginas, MAX_PAGINAS_POR_PDF);

  const fatias: Blob[] = [];
  for (let indice = 0; indice < paginasParaChecar; indice++) {
    const novo = await PDFDocument.create();
    const [pagina] = await novo.copyPages(origem, [indice]);
    novo.addPage(pagina);
    const bytes = await novo.save({ useObjectStreams: false });
    fatias.push(new Blob([bytes], { type: "application/pdf" }));
  }
  return fatias;
}

async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return pdfjsLib;
}

// Renderiza a 1ª página de um PDF (já fatiado) num <canvas>, numa escala
// fixa -- usado só pra rasterizar como JPEG quando a página passa do limite
// de tamanho do Worker (ver rasterizarComoJpeg). A leitura de QR do Pix não
// passa mais por aqui -- ver pixExtractor.ts.
async function renderizarPaginaEmCanvas(paginaPdfBlob: Blob, scale: number): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;

  const pdfjsLib = await carregarPdfjs();
  const buffer = await paginaPdfBlob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;

  let pagina: any = null;
  try {
    pagina = await doc.getPage(1);
    const viewport = pagina.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await pagina.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } finally {
    if (pagina && typeof pagina.cleanup === "function") {
      try { pagina.cleanup(); } catch (_) { /* noop */ }
    }
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

// Renderiza a página em JPEG comprimido, reduzindo escala/qualidade em
// passos até caber no limite do Worker.
async function rasterizarComoJpeg(paginaPdfBlob: Blob, limiteBytes: number): Promise<Blob | null> {
  const tentativas: Array<{ scale: number; quality: number }> = [
    { scale: 2.5, quality: 0.85 },
    { scale: 2.0, quality: 0.8 },
    { scale: 1.5, quality: 0.75 },
    { scale: 1.2, quality: 0.6 },
    { scale: 1.0, quality: 0.5 },
  ];

  for (const { scale, quality } of tentativas) {
    const canvas = await renderizarPaginaEmCanvas(paginaPdfBlob, scale);
    if (!canvas) continue;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    canvas.width = 0;
    canvas.height = 0;

    if (blob && blob.size <= limiteBytes) return blob;
    if (blob && scale === tentativas[tentativas.length - 1].scale) return blob;
  }
  return null;
}

// Chama o Worker pra OCR (valor, vencimento, linha digitável). O campo
// `pixCopiaCola` que o Worker eventualmente devolver é só o fallback de
// texto impresso (ver worker.js: extractPixCandidatesFromText) -- guardado
// aqui como último recurso, não é a fonte principal do Pix.
async function consultarWorker(pagina: Blob, nomeArquivo: string, indice: number): Promise<CamposOcr | null> {
  let corpo = pagina;
  let nome = nomeArquivo;

  if (corpo.size > LIMITE_BYTES_POR_PAGINA) {
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
    pixCopiaColaTexto: json.data?.pixCopiaCola ?? null,
    valor: json.data?.valor ?? null,
    vencimento: json.data?.vencimento ?? null,
    linhaDigitavel: json.data?.linhaDigitavel ?? null,
  };
}

// Percorre as páginas até achar a primeira com algum campo textual
// preenchido (valor, vencimento ou linha digitável).
async function extrairCamposOcr(arquivo: File | Blob, nomeArquivo: string): Promise<CamposOcr | null> {
  try {
    const paginas = await fatiarPdfEmPaginas(arquivo);

    for (let i = 0; i < paginas.length; i++) {
      const nomePagina = nomeArquivo.replace(/\.pdf$/i, "") + `-pagina-${i + 1}.pdf`;
      const campos = await comTimeout(consultarWorker(paginas[i], nomePagina, i), TIMEOUT_POR_PAGINA_MS, null);
      if (campos && (campos.valor || campos.vencimento || campos.linhaDigitavel || campos.pixCopiaColaTexto)) {
        return campos;
      }
    }
    return null;
  } catch (err) {
    console.error("[pixWorkerClient] erro ao extrair campos via OCR:", (err as Error).message);
    return null;
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
  };
}

// Mantido por compatibilidade com código/telemetria antigo que ainda possa
// importar pelo nome anterior -- prefira `extrairDadosPix` em código novo.
export const extrairDadosPixViaWorker = extrairDadosPix;
