// [2026-10] OCR LOCAL do cabeçalho do boleto (Tesseract.js, no navegador) --
// FALLBACK do Worker `processo-de-pdf`: só roda quando o Worker falhou ou não
// achou o Código (ver extrairCamposDoBoleto em pixWorkerClient.ts). O Worker
// continua sendo o caminho principal.
//
// Por quê: os boletos reais da Claro (95 PDFs de novembro/2026 no
// REPO-DE-TESTES) são IMAGEM pura -- não têm camada de texto, então a leitura
// de texto (textoCabecalhoPdf.ts) não acha nada neles, e quando o Worker caía
// nenhum PDF ganhava Código.
//
// Algoritmo (validado nos 95: 95 códigos certos, 0 errados):
//  1. Renderiza o topo (15%) da página e roda OCR geral só pra ACHAR o
//     rótulo "Código" (posição na imagem). Se não achar, tenta de novo no
//     modo "texto esparso". Páginas 1..3 (a 1ª às vezes é propaganda).
//  2. RE-RENDERIZA só a caixa logo abaixo do rótulo, direto do PDF, com a
//     letra em ~45px (ampliar o recorte já reduzido não recupera detalhe --
//     era o que fazia "747" virar "417"/"141"). Limite direito = rótulo
//     "Vencimento" ao lado (senão pega o "10" da data).
//  3. Lê essa caixa 3x (3 ampliações), aceitando só dígitos e "/", modo
//     linha única. Só aceita o código se >= 2 leituras derem EXATAMENTE o
//     mesmo valor e ele for o mais votado sem empate. Na dúvida, null --
//     código errado casa o Pix com a pessoa errada, é pior que nenhum.
//  Vencimento: mesmo método, embaixo do rótulo "Vencimento" (até "Valor").
//  Nome: texto antes de "Código" na mesma linha (best-effort).

export type CanvasLike = {
  width: number;
  height: number;
  getContext(tipo: "2d"): any;
};
export type AmbienteOcr = {
  criarCanvas: (largura: number, altura: number) => CanvasLike;
  // Converte o canvas no que o Tesseract aceita (navegador: o próprio canvas).
  paraImagem: (canvas: CanvasLike) => any;
  criarWorkerTesseract: () => Promise<any>; // worker "por" já carregado
  PSM: { AUTO: string; SPARSE_TEXT: string; SINGLE_LINE: string };
};

export type CamposOcrLocal = {
  codigo: string | null;
  vencimento: string | null;
  nome: string | null;
};

const LARGURA_RENDER = 2000;
const FRACAO_TOPO = 0.15;
const ALTURA_LETRA_ALVO = 45;
const MAX_PAGINAS = 3;

type Palavra = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };

function palavrasDe(data: any): Palavra[] {
  return (data?.blocks ?? []).flatMap((b: any) =>
    (b.paragraphs ?? []).flatMap((p: any) => (p.lines ?? []).flatMap((l: any) => l.words ?? [])),
  );
}

function paraCinza(ctx: any, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data as Uint8ClampedArray;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
}

// Voto: vence quem tiver >= 2 leituras iguais e mais votos que o 2º.
export function consenso(leituras: (string | null)[]): string | null {
  const votos = new Map<string, number>();
  for (const v of leituras) if (v) votos.set(v, (votos.get(v) ?? 0) + 1);
  const ordem = [...votos.entries()].sort((a, b) => b[1] - a[1]);
  const [primeiro, segundo] = ordem;
  if (!primeiro || primeiro[1] < 2) return null;
  if (segundo && segundo[1] === primeiro[1]) return null;
  return primeiro[0];
}

function dataValidaOcr(t: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return d >= 1 && d <= 31 && mes >= 1 && mes <= 12 && a >= 2000 && a <= 2100 ? t : null;
}

let workersPromise: Promise<{ geral: any; digitos: any }> | null = null;

async function obterWorkers(amb: AmbienteOcr) {
  workersPromise ??= (async () => {
    const [geral, digitos] = await Promise.all([
      amb.criarWorkerTesseract(),
      amb.criarWorkerTesseract(),
    ]);
    // Sem "aprendizado" entre imagens: com ele, o resultado de um PDF
    // dependia dos PDFs lidos antes (o mesmo boleto lia certo sozinho e
    // errado no meio do lote).
    for (const w of [geral, digitos])
      await w.setParameters({
        classify_enable_learning: "0",
        classify_enable_adaptive_matcher: "0",
      });
    await digitos.setParameters({
      tessedit_char_whitelist: "0123456789/",
      tessedit_pageseg_mode: amb.PSM.SINGLE_LINE,
    });
    return { geral, digitos };
  })().catch((err) => {
    workersPromise = null; // deixa tentar de novo no próximo PDF
    throw err;
  });
  return workersPromise;
}

export async function encerrarOcrLocal() {
  const p = workersPromise;
  workersPromise = null;
  if (!p) return;
  const { geral, digitos } = await p.catch(() => ({ geral: null, digitos: null }));
  await Promise.all([geral?.terminate?.(), digitos?.terminate?.()]);
}

// Lê 3x (3 ampliações) a região [x0,y0,largura,altura] (coordenadas do
// render base) re-renderizada direto do PDF; devolve as leituras que
// casaram `formato` (1º token da linha).
async function lerRegiao(
  amb: AmbienteOcr,
  digitos: any,
  pagina: any,
  escalaBase: number,
  regiao: { x0: number; y0: number; w: number; h: number },
  alturaLetra: number,
  formato: RegExp,
): Promise<(string | null)[]> {
  const k0 = Math.min(5, Math.max(1, ALTURA_LETRA_ALVO / alturaLetra));
  const leituras: (string | null)[] = [];
  for (const k of [k0, k0 * 1.4, k0 * 1.8]) {
    const W = Math.round(regiao.w * k);
    const H = Math.round(regiao.h * k);
    const canvas = amb.criarCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    const viewport = pagina.getViewport({
      scale: escalaBase * k,
      offsetX: -regiao.x0 * k,
      offsetY: -regiao.y0 * k,
    });
    await pagina.render({ canvasContext: ctx, viewport }).promise;
    paraCinza(ctx, W, H);
    const { data } = await digitos.recognize(amb.paraImagem(canvas));
    const texto = String(data?.text ?? "");
    leituras.push(texto.split(/\s+/).find((t: string) => formato.test(t)) ?? null);
    canvas.width = 0;
    canvas.height = 0;
  }
  return leituras;
}

async function lerPagina(amb: AmbienteOcr, pagina: any): Promise<CamposOcrLocal | null> {
  const { geral, digitos } = await obterWorkers(amb);
  const escalaBase = LARGURA_RENDER / pagina.getViewport({ scale: 1 }).width;
  const vp = pagina.getViewport({ scale: escalaBase });
  const W = Math.ceil(vp.width);
  const H = Math.ceil(vp.height * FRACAO_TOPO);
  const topo = amb.criarCanvas(W, H);
  const ctx = topo.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  await pagina.render({ canvasContext: ctx, viewport: vp }).promise; // canvas só tem o topo: o resto é cortado
  paraCinza(ctx, W, H);

  try {
    let { data } = await geral.recognize(amb.paraImagem(topo), {}, { blocks: true, text: true });
    let palavras = palavrasDe(data);
    const ehRotuloCodigo = (p: Palavra) => /^c[óo6]d(igo)?:?$/i.test(p.text);
    if (!palavras.some(ehRotuloCodigo)) {
      await geral.setParameters({ tessedit_pageseg_mode: amb.PSM.SPARSE_TEXT });
      try {
        ({ data } = await geral.recognize(amb.paraImagem(topo), {}, { blocks: true, text: true }));
        palavras = palavrasDe(data);
      } finally {
        await geral.setParameters({ tessedit_pageseg_mode: amb.PSM.AUTO });
      }
    }
    const rotulo = palavras.find(ehRotuloCodigo);
    if (!rotulo) return null;

    const b = rotulo.bbox;
    const hR = b.y1 - b.y0;
    const wR = b.x1 - b.x0;
    const naMesmaFaixa = (p: Palavra) => Math.abs(p.bbox.y0 - b.y0) < hR * 1.5;
    const rotVenc = palavras.find(
      (p) => /^venc/i.test(p.text) && p.bbox.x0 > b.x1 && naMesmaFaixa(p),
    );
    const rotValor = rotVenc
      ? palavras.find(
          (p) => /^valor/i.test(p.text) && p.bbox.x0 > rotVenc.bbox.x1 && naMesmaFaixa(p),
        )
      : undefined;

    const y0 = Math.max(0, Math.round(b.y1 - hR * 0.25));
    const altura = Math.round(hR * 2.6);
    const x0 = Math.max(0, b.x0 - hR);
    const larguraCodigo = rotVenc
      ? Math.max(wR * 2, rotVenc.bbox.x0 - x0 - hR * 0.3)
      : Math.min(W - x0, wR * 5);
    const codigo = consenso(
      await lerRegiao(
        amb,
        digitos,
        pagina,
        escalaBase,
        { x0, y0, w: larguraCodigo, h: altura },
        hR,
        /^\d{2,4}\/\d{6,12}$/,
      ),
    );

    // Vencimento: logo abaixo do rótulo "Vencimento" (a data é maior que o
    // rótulo, ~2x a largura dele). Sem o rótulo (OCR embaralhou), a data fica
    // na mesma faixa, logo depois do código (~2,3 larguras de "Código").
    // A leitura procura o padrão dd/mm/aaaa DENTRO do texto, então sobra de
    // código ou de valor nas bordas do recorte não atrapalha.
    let vencimento: string | null = null;
    const regiaoVenc = rotVenc
      ? {
          x0: Math.max(0, rotVenc.bbox.x0 - hR * 0.3),
          // Base = a menor das duas (Código / Vencimento): a caixa do rótulo
          // varia de altura entre boletos e cortava o topo da data.
          y0: Math.max(0, Math.round(Math.min(rotVenc.bbox.y1, b.y1) - hR * 0.15)),
          w: Math.min(
            (rotVenc.bbox.x1 - rotVenc.bbox.x0) * 2.2,
            rotValor ? rotValor.bbox.x0 - rotVenc.bbox.x0 : Number.POSITIVE_INFINITY,
          ),
          h: Math.round(hR * 2.8),
        }
      : {
          x0: b.x0 + wR * 2.3,
          y0: Math.max(0, Math.round(b.y1 - hR * 0.15)),
          w: Math.min(W - b.x0 - wR * 2.3, wR * 5),
          h: Math.round(hR * 2.8),
        };
    if (regiaoVenc.w > hR) {
      const leituras = await lerRegiao(
        amb,
        digitos,
        pagina,
        escalaBase,
        regiaoVenc,
        hR * 1.8,
        /\d{2}\/\d{2}\/\d{4}/,
      );
      // Data errada é perigosa (casaria com a linha de OUTRO mês do mesmo
      // cliente na planilha) -- regra mais dura que a do código: as 3
      // leituras iguais, OU 2 iguais e a mesma data aparecendo também no OCR
      // geral do cabeçalho (fonte independente). Visto nos testes: 2 de 3
      // leituras deram "25/02/2026" num boleto de 25/09/2026.
      const datas = leituras.map((l) => /\d{2}\/\d{2}\/\d{4}/.exec(l ?? "")?.[0] ?? null);
      const escolhida = consenso(datas);
      const votos = datas.filter((d) => d === escolhida).length;
      const datasGerais = new Set(
        [...String(data?.text ?? "").matchAll(/(\d\s?\d)\s?\/\s?(\d\s?\d)\s?\/\s?(\d{4})/g)].map(
          (m) => `${m[1]!.replace(/\s/g, "")}/${m[2]!.replace(/\s/g, "")}/${m[3]}`,
        ),
      );
      if (escolhida && (votos === 3 || datasGerais.has(escolhida)))
        vencimento = dataValidaOcr(escolhida);
    }

    const linha =
      String(data?.text ?? "")
        .split("\n")
        .find((l: string) => /c[óo]d/i.test(l)) ?? "";
    const antes = linha
      .split(/c[óo]d(?:igo)?/i)[0]!
      .replace(/\s+/g, " ")
      .trim();
    const nome = /^[A-Za-zÀ-ÿ'. ]{5,}$/.test(antes) && antes.split(" ").length >= 2 ? antes : null;

    return { codigo, vencimento, nome };
  } finally {
    topo.width = 0;
    topo.height = 0;
  }
}

// Um PDF por vez: a extração roda 3 PDFs em paralelo, e o worker "geral"
// troca de modo (AUTO <-> SPARSE_TEXT) no meio de um PDF -- em paralelo, a
// troca vazaria pra leitura de outro PDF.
let fila: Promise<unknown> = Promise.resolve();

// Páginas 1..3 até achar o Código. Nunca lança: erro vira null (é fallback).
export function lerCabecalhoPorOcr(doc: any, amb: AmbienteOcr): Promise<CamposOcrLocal | null> {
  const vez = fila.then(() => lerCabecalhoPorOcrAgora(doc, amb));
  fila = vez.catch(() => null);
  return vez;
}

async function lerCabecalhoPorOcrAgora(doc: any, amb: AmbienteOcr): Promise<CamposOcrLocal | null> {
  let melhor: CamposOcrLocal | null = null;
  for (let p = 1; p <= Math.min(MAX_PAGINAS, doc.numPages); p++) {
    try {
      const r = await lerPagina(amb, await doc.getPage(p));
      if (r?.codigo) return r;
      if (r && !melhor && (r.vencimento || r.nome)) melhor = r;
    } catch (err) {
      console.warn(`[ocrLocal] página ${p} falhou:`, (err as Error).message);
    }
  }
  return melhor;
}
