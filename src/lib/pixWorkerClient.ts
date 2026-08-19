// Extração de dados do boleto (Pix copia-e-cola, valor, vencimento, linha
// digitável) delegada ao Cloudflare Worker `processo-de-pdf` -- ele faz o OCR
// e valida o Pix via Regex. Isso SUBSTITUI o fluxo antigo, que renderizava o
// PDF em <canvas> e escaneava QR com jsQR direto no navegador
// (ver pixFromPdfBrowser.ts, removido).
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

const WORKER_URL =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ||
  "https://processo-de-pdf.erickramiro2010.workers.dev";

// Limite real do Worker/OCR.space (ver worker.js: OCR_SPACE_LIMIT_BYTES).
// Página de PDF que passar disso agora é rasterizada e comprimida como JPEG
// (ver rasterizarComoJpeg) em vez de enviada crua e estourar 413.
const LIMITE_BYTES_POR_PAGINA = 1 * 1024 * 1024; // 1MB

// Só faz sentido procurar o Pix nas primeiras páginas -- na prática ele está
// sempre na capa/1ª via do boleto. Limita o número de páginas fatiadas e
// enviadas ao Worker por documento, pra não gastar tempo/rede em carnês de
// 20+ páginas atrás de algo que não está lá.
const MAX_PAGINAS_POR_PDF = 6;

const TIMEOUT_POR_PAGINA_MS = 20_000;

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

// Renderiza a 1ª página do PDF (já fatiado) num <canvas> e reencoda como JPEG,
// reduzindo escala/qualidade em passos até caber no limite do Worker. Isso
// substitui o antigo "manda cru e torce" -- que estourava 413 em boletos com
// imagem de alta resolução (scan) numa página só.
//
// `pdfjsLib` é importado dinamicamente aqui dentro -- nunca no topo do
// módulo -- pra não rodar em SSR (ver comentário no topo do arquivo).
async function rasterizarComoJpeg(paginaPdfBlob: Blob, limiteBytes: number): Promise<Blob | null> {
  if (typeof document === "undefined") {
    // Estamos em SSR/Node (sem DOM/canvas) -- não há como rasterizar aqui.
    // Isso não deveria acontecer na prática (extrairDadosPixViaWorker já
    // garante que só roda no navegador), mas é uma proteção extra.
    return null;
  }

  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;

  const buffer = await paginaPdfBlob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pagina = await doc.getPage(1);

  // Tenta em passos decrescentes de escala/qualidade até caber no limite.
  // Escala alta primeiro (melhor OCR), cai pra garantir que sempre manda algo.
  const tentativas: Array<{ scale: number; quality: number }> = [
    { scale: 2.5, quality: 0.85 },
    { scale: 2.0, quality: 0.8 },
    { scale: 1.5, quality: 0.75 },
    { scale: 1.2, quality: 0.6 },
    { scale: 1.0, quality: 0.5 },
  ];

  for (const { scale, quality } of tentativas) {
    const viewport = pagina.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    // Fundo branco -- PDFs com fundo transparente viram JPEG preto sem isso.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await pagina.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );

    if (blob && blob.size <= limiteBytes) return blob;
    // Guarda o menor obtido até agora caso nenhuma tentativa entre no limite.
    if (blob && scale === tentativas[tentativas.length - 1].scale) return blob;
  }
  return null;
}

async function enviarPaginaParaWorker(
  pagina: Blob,
  nomeArquivo: string,
  indice: number,
): Promise<DadosPix | null> {
  let corpo = pagina;
  let nome = nomeArquivo;

  if (corpo.size > LIMITE_BYTES_POR_PAGINA) {
    console.warn(
      `[pixWorkerClient] página ${indice + 1} ficou com ${(corpo.size / 1024 / 1024).toFixed(2)}MB ` +
        `(acima do limite de 1MB) -- rasterizando como JPEG comprimido antes de enviar.`,
    );
    const rasterizado = await rasterizarComoJpeg(corpo, LIMITE_BYTES_POR_PAGINA);
    if (!rasterizado) {
      console.error(`[pixWorkerClient] falha ao rasterizar página ${indice + 1}, pulando.`);
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
  if (!json?.success || !json.data?.pixCopiaCola) {
    if (json?.error) console.warn(`[pixWorkerClient] página ${indice + 1} sem Pix:`, json.error);
    return null;
  }

  return {
    pixCopiaCola: json.data.pixCopiaCola,
    valor: json.data.valor ?? null,
    vencimento: json.data.vencimento ?? null,
    linhaDigitavel: json.data.linhaDigitavel ?? null,
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
        enviarPaginaParaWorker(pagina, nomePagina, i),
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
