// Extração de código Pix a partir de PDF, rodando 100% no navegador (RAM/CPU do
// usuário, não do servidor). Portado de backend/src/lib/pixFromPdf.js -- mesma
// lógica de escaneamento em blocos e mesmo critério pra reconhecer um Pix,
// só trocando @napi-rs/canvas (Node) por <canvas> nativo do browser.
//
// Por que isso existe: processar dezenas/centenas de PDFs (renderizar em canvas
// de alta resolução + escanear QR) é pesado o bastante pra estourar a RAM de um
// servidor com pouca memória (ex: Render free, 512MB) quando várias importações
// concorrentes ou uma importação grande rodam ao mesmo tempo que a sessão do
// WhatsApp, que vive no mesmo processo. Fazendo esse trabalho no navegador de
// quem está importando, o servidor nunca vê um PDF sendo processado -- só
// recebe o resultado (texto) e o arquivo já pronto pra upload direto no Storage.
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import jsQR from "jsqr";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Um código Pix "copia e cola" (BR Code / EMV) sempre começa com esse payload
// fixo (id "00", tamanho "02", versão "01") e sempre contém o domínio do Banco
// Central. As duas condições juntas evitam confundir com QR de promoção/app.
function ehCodigoPix(texto: string | null | undefined): texto is string {
  return typeof texto === "string" && texto.startsWith("000201") && texto.includes("br.gov.bcb.pix");
}

// Mesma estratégia do backend: tenta grades 1x1 e 2x2 primeiro (cobre a
// esmagadora maioria dos boletos reais), só cai pra 3x3 se não achar nada.
function escanearBlocos(ctx: CanvasRenderingContext2D, largura: number, altura: number): Set<string> {
  const achados = new Set<string>();

  function tentarGrade(grade: number) {
    const sobreposicao = 0.2;
    const tileW = largura / grade;
    const tileH = altura / grade;

    for (let cy = 0; cy < grade; cy++) {
      for (let cx = 0; cx < grade; cx++) {
        const x0 = Math.max(0, Math.floor(cx * tileW - tileW * sobreposicao));
        const y0 = Math.max(0, Math.floor(cy * tileH - tileH * sobreposicao));
        const x1 = Math.min(largura, Math.ceil((cx + 1) * tileW + tileW * sobreposicao));
        const y1 = Math.min(altura, Math.ceil((cy + 1) * tileH + tileH * sobreposicao));

        const bloco = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        const resultado = jsQR(bloco.data, bloco.width, bloco.height);
        if (resultado) achados.add(resultado.data);
      }
    }
  }

  tentarGrade(1);
  tentarGrade(2);
  if (achados.size === 0) tentarGrade(3);

  return achados;
}

const TIMEOUT_POR_PDF_MS = 15_000;

function comTimeout<T>(promise: Promise<T>, ms: number, valorPadrao: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(valorPadrao), ms)),
  ]);
}

// Renderiza as primeiras páginas do PDF (no navegador) e tenta achar um código
// Pix entre possivelmente vários QRs na mesma página. Retorna o código Pix ou
// null se não achar. Nunca lança -- um PDF problemático só resulta em pix_code
// nulo pra aquele cliente, sem travar o resto da importação.
export async function extrairPixDoPdfNoBrowser(arquivo: File | Blob): Promise<string | null> {
  return comTimeout(extrairPixSemTimeout(arquivo), TIMEOUT_POR_PDF_MS, null);
}

async function extrairPixSemTimeout(arquivo: File | Blob): Promise<string | null> {
  try {
    const buffer = await arquivo.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true }).promise;

    // Só as primeiras 3 páginas -- na prática o QR do Pix está sempre bem no
    // início do boleto (capa/1ª via).
    const paginasParaChecar = Math.min(doc.numPages, 3);

    for (let i = 1; i <= paginasParaChecar; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      // pdfjs deixa áreas não pintadas como transparente (alpha 0). jsQR lê RGB
      // ignorando alpha, então "transparente" vira preto pra ele e corrompe a
      // leitura -- por isso pinta o fundo de branco ANTES de renderizar.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      const achados = escanearBlocos(ctx, canvas.width, canvas.height);
      const pix = [...achados].find(ehCodigoPix);
      if (pix) return pix;
    }
    return null;
  } catch (err) {
    console.error("[pixFromPdfBrowser] erro ao tentar extrair pix do pdf:", (err as Error).message);
    return null;
  }
}
