// [2026-10] Leitura LOCAL do cabeçalho do boleto pela camada de texto do PDF
// (pdfjs getTextContent) -- sem OCR, sem rede, sem limite de requisição.
//
// Por quê: o Worker `processo-de-pdf` (OCR.space, plano gratuito) é chamado
// 1x por PDF e começa a falhar depois de ~100 seguidos (limite de taxa do
// OCR.space), voltando a funcionar um tempo depois. Só que a maioria dos
// boletos é PDF DIGITAL: o texto ("Código 010/022067040", "Vencimento
// 10/08/2026"...) já está dentro do arquivo, não precisa de OCR pra ler.
// Agora isto roda PRIMEIRO; o Worker só é chamado quando o PDF é imagem
// escaneada (sem texto) ou quando aqui não achou Código + Vencimento -- e,
// se o Worker falhar, o que foi lido aqui é usado do mesmo jeito.
//
// Precisão acima de cobertura: só aceita Código/Vencimento vindos de um
// RÓTULO ("Código", "Vencimento") -- nunca "a primeira data/número que
// aparecer". Campo não achado fica null (o Worker ou a revisão manual
// cobrem), em vez de chutar um valor que case a fatura errada.

export type CamposTexto = {
  codigo: string | null;
  vencimento: string | null; // "DD/MM/AAAA", igual ao Worker
  valor: string | null; // "123,45"
  nome: string | null;
  linhaDigitavel: string | null; // só dígitos
  pixCopiaColaTexto: string | null; // Pix impresso como texto (raro)
};

// Palavras que são RÓTULO, nunca parte de nome (onde o nome para).
const RE_ROTULO =
  /^(?:c[óo]d(?:igo)?\.?|cliente|venc(?:imento|to)?\.?|valor|total|cpf|cnpj|emiss[ãa]o|data|n[ºo°]\.?|contrato|plano|refer[êe]ncia|m[êe]s|fatura|endere[çc]o)[:.]?$/i;

const DATA = String.raw`(\d{2})\s*[/.-]\s*(\d{2})\s*[/.-]\s*(\d{4})`;

function dataValida(d: string, m: string, a: string): string | null {
  const [dia, mes, ano] = [Number(d), Number(m), Number(a)];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 2000 || ano > 2100) return null;
  return `${d}/${m}/${a}`;
}

// Texto já em linhas (ordem de leitura). Linhas são juntadas com " | " pra
// rótulo e valor em linhas vizinhas ("Vencimento" / "10/08/2026") ainda
// casarem, sem deixar o regex atravessar o documento inteiro.
export function extrairCamposDoTexto(linhas: string[]): CamposTexto {
  const texto = linhas
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ");

  // "Código: 010/022067040", "Cód. Cliente 22067040", "CODIGO DO CLIENTE: ..."
  // Exige rótulo e ≥ 6 dígitos (OS real); não confunde com "Código de barras".
  const mCodigo =
    /c[óo]d(?:igo)?\.?(?!\s*(?:de\s+)?barras)(?:\s+(?:do\s+)?(?:cliente|assinante|contrato))?\s*[:\-–]?\s*(?:\|\s*)?(\d{1,4}\s*\/\s*\d{4,}|\d{6,})/i.exec(
      texto,
    );
  const codigo = mCodigo ? mCodigo[1]!.replace(/\s+/g, "") : null;

  // Vencimento: data logo depois do rótulo (até ~40 caracteres, pode pular
  // pra linha seguinte). "Vencimento", "Venc.", "Vencto", "Data de vencimento".
  let vencimento: string | null = null;
  const reVenc = new RegExp(
    String.raw`venc(?:imento|to)?\.?[^\d|]{0,25}(?:\|[^\d|]{0,25})?` + DATA,
    "gi",
  );
  for (const m of texto.matchAll(reVenc)) {
    vencimento = dataValida(m[1]!, m[2]!, m[3]!);
    if (vencimento) break;
  }

  // Valor: "Valor", "Valor do documento", "Total a pagar" seguido de R$ x,xx.
  const mValor =
    /(?:valor(?:\s+(?:do\s+documento|cobrado|a\s+pagar|total))?|total\s+a\s+pagar)[^\d|]{0,25}(?:\|[^\d|]{0,10})?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})\b/i.exec(
      texto,
    );
  const valor = mValor ? mValor[1]! : null;

  // Nome: depois de "Cliente"/"Nome"/"Titular"/"Pagador", mínimo 2
  // palavras, parando no próximo rótulo ("... SILVA Cód. Cliente" -> "...
  // SILVA"). Best-effort: o casamento da planilha não depende do nome.
  let nome: string | null = null;
  const mNome =
    /(?:nome\s+do\s+(?:cliente|titular|assinante)|cliente|nome|titular|pagador|assinante)\s*[:\-–]?\s*(?:\|\s*)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){1,9})/i.exec(
      texto,
    );
  if (mNome) {
    const palavras: string[] = [];
    for (const p of mNome[1]!.split(/\s+/)) {
      if (RE_ROTULO.test(p)) break;
      palavras.push(p);
    }
    if (palavras.length >= 2) nome = palavras.join(" ");
  }

  // Linha digitável: boleto bancário (47) ou concessionária (48 dígitos),
  // impressa com pontos/espaços.
  let linhaDigitavel: string | null = null;
  for (const m of texto.matchAll(/(?:\d[\d.\s]{44,60}\d)/g)) {
    const digitos = m[0].replace(/\D/g, "");
    if (digitos.length === 47 || digitos.length === 48) {
      linhaDigitavel = digitos;
      break;
    }
  }

  const mPix = /000201[0-9A-Za-z .:/@*\-_+]{40,}?6304[0-9A-Fa-f]{4}/.exec(
    texto.replace(/\s*\|\s*/g, ""),
  );
  return {
    codigo,
    vencimento,
    valor,
    nome,
    linhaDigitavel,
    pixCopiaColaTexto: mPix ? mPix[0].replace(/\s/g, "") : null,
  };
}

type ItemTexto = { str: string; transform: number[]; width?: number };
type Segmento = { texto: string; x0: number; x1: number; y: number };

// Rótulos que, em fatura em TABELA, ficam numa linha com o valor embaixo:
//   Cliente            Código          Vencimento
//   ANA T. G. DA SILVA 010/004202130   15/07/2026
const RE_ROTULO_TABELA =
  /^(?:c[óo]d(?:igo)?\.?(?:\s+(?:do\s+)?(?:cliente|assinante|contrato))?|venc(?:imento|to)?\.?|data\s+de\s+vencimento|valor(?:\s+a\s+pagar|\s+do\s+documento|\s+total)?|total\s+a\s+pagar|cliente|nome(?:\s+do\s+cliente)?|titular|pagador)\s*:?$/i;

// Itens de texto -> segmentos (itens vizinhos na mesma linha, com espaço
// pequeno entre eles, viram um pedaço só: "Código" "do" "Cliente").
function segmentos(itens: ItemTexto[]): Segmento[][] {
  const ordenados = [...itens].sort(
    (a, b) => b.transform[5]! - a.transform[5]! || a.transform[4]! - b.transform[4]!,
  );
  const linhas: Segmento[][] = [];
  let yAtual = Number.NaN;
  for (const i of ordenados) {
    const y = i.transform[5]!;
    const x0 = i.transform[4]!;
    const tamanhoFonte = Math.abs(i.transform[0]!) || 10;
    const x1 = x0 + (i.width ?? i.str.length * tamanhoFonte * 0.5);
    if (!(Math.abs(y - yAtual) <= 3)) {
      linhas.push([]);
      yAtual = y;
    }
    const linha = linhas[linhas.length - 1]!;
    const ultimo = linha[linha.length - 1];
    // Espaço maior que ~1,5 caractere separa colunas.
    if (ultimo && x0 - ultimo.x1 <= tamanhoFonte * 1.5) {
      ultimo.texto += (x0 - ultimo.x1 > tamanhoFonte * 0.15 ? " " : "") + i.str;
      ultimo.x1 = x1;
    } else {
      linha.push({ texto: i.str, x0, x1, y });
    }
  }
  return linhas.map((l) =>
    l
      .map((sg) => ({ ...sg, texto: sg.texto.replace(/\s+/g, " ").trim() }))
      .filter((sg) => sg.texto),
  );
}

// Pares "Rótulo: valor" de tabela: pra cada segmento que é só um rótulo,
// o segmento da linha de baixo (até 3 linhas) que mais se sobrepõe na
// horizontal. Vira uma linha sintética "Código: 010/004202130".
function paresDeTabela(linhas: Segmento[][]): string[] {
  const pares: string[] = [];
  linhas.forEach((linha, li) => {
    for (const rotulo of linha) {
      if (!RE_ROTULO_TABELA.test(rotulo.texto)) continue;
      for (const abaixo of linhas.slice(li + 1, li + 4)) {
        let melhor: Segmento | null = null;
        let melhorSobreposicao = 0;
        for (const sg of abaixo) {
          const sobreposicao = Math.min(rotulo.x1, sg.x1) - Math.max(rotulo.x0, sg.x0);
          // Alinhado pela esquerda também conta (valor mais largo que o rótulo).
          const alinhado = Math.abs(sg.x0 - rotulo.x0) <= 12;
          const pontos = sobreposicao > 0 ? sobreposicao : alinhado ? 1 : 0;
          if (pontos > melhorSobreposicao && !RE_ROTULO_TABELA.test(sg.texto)) {
            melhor = sg;
            melhorSobreposicao = pontos;
          }
        }
        if (melhor) {
          pares.push(`${rotulo.texto.replace(/:$/, "")}: ${melhor.texto}`);
          break;
        }
      }
    }
  });
  return pares;
}

// Linhas de texto (ordem de leitura) da faixa de cima da página: `fracao`
// = quanto da altura, a partir do topo (0.25 = quarto de cima). Os pares
// de tabela vêm PRIMEIRO (mais precisos: rótulo e valor já associados pela
// posição), seguidos das linhas normais.
export async function linhasDoTopo(pagina: any, fracao: number): Promise<string[]> {
  const altura = pagina.getViewport({ scale: 1 }).height as number;
  const conteudo = await pagina.getTextContent();
  const limiteY = altura * (1 - fracao); // y do PDF cresce de baixo pra cima
  const itens = (conteudo.items as ItemTexto[]).filter(
    (i) => typeof i.str === "string" && i.str.trim() && i.transform[5]! >= limiteY,
  );
  const linhas = segmentos(itens);
  return [...paresDeTabela(linhas), ...linhas.map((l) => l.map((sg) => sg.texto).join("   "))];
}

// Quantos caracteres de texto a página tem -- ~0 = PDF escaneado (só imagem),
// aí não adianta procurar mais e o Worker (OCR) é o único caminho.
export async function temCamadaDeTexto(pagina: any): Promise<boolean> {
  const conteudo = await pagina.getTextContent();
  const total = (conteudo.items as ItemTexto[]).reduce(
    (s, i) => s + (i.str?.trim().length ?? 0),
    0,
  );
  return total >= 20;
}

// Faixas tentadas, da menor pra maior: para assim que achar Código +
// Vencimento (cabeçalho quase sempre no topo; algumas faturas põem o
// quadro de vencimento mais abaixo).
const FRACOES = [0.25, 0.5, 1];

// Procura nas primeiras `maxPaginas` páginas (1ª pode ser propaganda).
// Combina campos de faixas/páginas diferentes, sem sobrescrever o que já
// foi achado (o primeiro achado, mais perto do topo, vale).
export async function extrairCamposPorTexto(
  doc: any,
  maxPaginas = 3,
): Promise<CamposTexto & { semTexto: boolean }> {
  const acumulado: CamposTexto = {
    codigo: null,
    vencimento: null,
    valor: null,
    nome: null,
    linhaDigitavel: null,
    pixCopiaColaTexto: null,
  };
  let algumaComTexto = false;
  const paginas = Math.min(doc.numPages, maxPaginas);
  for (let p = 1; p <= paginas; p++) {
    const pagina = await doc.getPage(p);
    try {
      if (!(await temCamadaDeTexto(pagina))) continue;
      algumaComTexto = true;
      for (const fracao of FRACOES) {
        const campos = extrairCamposDoTexto(await linhasDoTopo(pagina, fracao));
        for (const k of Object.keys(acumulado) as (keyof CamposTexto)[]) acumulado[k] ??= campos[k];
        if (acumulado.codigo && acumulado.vencimento) {
          // Linha digitável/Pix impresso ficam no rodapé: varre a página
          // inteira só pra esses dois (nome/valor/data do rodapé não entram).
          if (fracao < 1 && (!acumulado.linhaDigitavel || !acumulado.pixCopiaColaTexto)) {
            const inteira = extrairCamposDoTexto(await linhasDoTopo(pagina, 1));
            acumulado.linhaDigitavel ??= inteira.linhaDigitavel;
            acumulado.pixCopiaColaTexto ??= inteira.pixCopiaColaTexto;
          }
          return { ...acumulado, semTexto: false };
        }
      }
    } finally {
      try {
        pagina.cleanup();
      } catch {
        /* noop */
      }
    }
  }
  return { ...acumulado, semTexto: !algumaComTexto };
}

// [2026-10] Texto vindo de OCR (Tesseract, fallback quando o Worker falha
// -- ver lib/ocrLocal.ts). Diferente do texto embutido no PDF: tudo vem
// numa linha só por "faixa" ("ADRIANA LOPES Código Vencimento: Valor:" /
// "013/041178293 10/10/2026"), com ruído e dígitos às vezes separados
// ("1 0/1 0/2026"). Por isso a regra aqui é por FORMATO, validada nos 95
// PDFs reais (Claro, novembro/2026) do REPO-DE-TESTES:
//   - Código: "NNN/NNNNNNNNN" (2-4 dígitos, barra, 6-12 dígitos). Não
//     confunde com data (dd/mm/aaaa tem 2 dígitos depois da barra) nem com
//     "001/001" (paginação).
//   - Vencimento: 1ª data depois do rótulo "Vencimento" (ou a 1ª data do
//     cabeçalho, se o OCR comeu o rótulo).
//   - Nome: o que vem antes de "Código" na 1ª linha.
const RE_DATA_OCR = /(\d\s?\d)\s?[/.]\s?(\d\s?\d)\s?[/.]\s?(\d{4})/g;

export function extrairCamposDoOcr(texto: string): CamposTexto {
  const limpo = texto.replace(/[|]/g, " ");
  const mCodigo = /(?<![\d/])(\d{2,4})\s?\/\s?(\d{6,12})(?![\d/])/.exec(limpo);
  const codigo = mCodigo ? `${mCodigo[1]}/${mCodigo[2]}` : null;

  let vencimento: string | null = null;
  const posRotulo = limpo.search(/venc(?:imento|to)?/i);
  const datas = [...limpo.matchAll(RE_DATA_OCR)]
    .map((m) => ({
      pos: m.index ?? 0,
      data: dataValida(m[1]!.replace(/\s/g, ""), m[2]!.replace(/\s/g, ""), m[3]!),
    }))
    .filter((d): d is { pos: number; data: string } => Boolean(d.data));
  vencimento =
    (posRotulo >= 0 ? datas.find((d) => d.pos > posRotulo) : undefined)?.data ??
    datas[0]?.data ??
    null;

  const primeiraLinha = limpo.split("\n").find((l) => /c[óo]d/i.test(l)) ?? "";
  const antesDoCodigo = primeiraLinha.split(/c[óo]d(?:igo)?/i)[0]!.trim();
  const nome =
    /^[A-Za-zÀ-ÿ'. ]{5,}$/.test(antesDoCodigo) && antesDoCodigo.split(/\s+/).length >= 2
      ? antesDoCodigo.replace(/\s+/g, " ")
      : null;

  const valorM = /valor\s*:?\s*[\s\S]{0,80}?(\d{1,3}(?:\.\d{3})*\s?,\s?\d{2})\b/i.exec(limpo);
  const base = extrairCamposDoTexto(limpo.split("\n"));
  return {
    codigo,
    vencimento,
    nome,
    valor: valorM ? valorM[1]!.replace(/\s/g, "") : base.valor,
    linhaDigitavel: base.linhaDigitavel,
    pixCopiaColaTexto: null,
  };
}
