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
import { PDFDocument } from "pdf-lib";

const WORKER_URL =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ||
  "https://processo-de-pdf.erickramiro2010.workers.dev";

// Limite alvo por requisição ao Worker. Mesmo fatiando página a página, um PDF
// com imagens de altíssima resolução numa página só pode passar disso -- nesse
// caso ainda mandamos (não dá pra "comprimir" mais sem reprocessar a imagem),
// mas paramos de tentar reduzir mais que isso.
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

// Se, mesmo com 1 página só, o arquivo ainda passar do limite (ex: imagem de
// altíssima resolução embutida), tenta salvar de novo removendo metadados/
// streams não usados -- pdf-lib já faz isso por padrão em save(), então na
// prática isso só serve de log/aviso; não há muito mais o que cortar no
// navegador sem re-rasterizar a página (o que perderia qualidade do QR).
function avisarSeGrande(blob: Blob, indice: number) {
  if (blob.size > LIMITE_BYTES_POR_PAGINA) {
    console.warn(
      `[pixWorkerClient] página ${indice + 1} ficou com ${(blob.size / 1024 / 1024).toFixed(2)}MB ` +
        `(acima do alvo de 1MB) -- enviando assim mesmo, não há como reduzir mais sem perder qualidade.`,
    );
  }
}

async function enviarPaginaParaWorker(pagina: Blob, nomeArquivo: string): Promise<DadosPix | null> {
  const formData = new FormData();
  formData.append("file", pagina, nomeArquivo);

  const resposta = await fetch(WORKER_URL, { method: "POST", body: formData });
  if (!resposta.ok) return null;

  const json = (await resposta.json().catch(() => null)) as RespostaWorker | null;
  if (!json?.success || !json.data?.pixCopiaCola) return null;

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
export async function extrairDadosPixViaWorker(
  arquivo: File | Blob,
  nomeArquivo = "boleto.pdf",
): Promise<DadosPix | null> {
  try {
    const paginas = await fatiarPdfEmPaginas(arquivo);

    for (let i = 0; i < paginas.length; i++) {
      const pagina = paginas[i];
      avisarSeGrande(pagina, i);

      const nomePagina = nomeArquivo.replace(/\.pdf$/i, "") + `-pagina-${i + 1}.pdf`;
      const dados = await comTimeout(
        enviarPaginaParaWorker(pagina, nomePagina),
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
