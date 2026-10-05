// [2026-10] Escreve células num .xlsx SEM reescrever o arquivo.
//
// Por quê: a lib `xlsx` (SheetJS community, 0.18.x) não grava estilo. Ler
// com `XLSX.read` e salvar com `XLSX.writeFile` jogava fora TODA a
// formatação da planilha do supervisor (cores de fundo, bordas, negrito,
// fontes). A cor da linha é o status do cliente nessa planilha, então o
// resultado parecia ter "apagado os clientes". Relatado com as planilhas
// reais "com coluna pix PARA PAGAR(.xlsx / -com-pix.xlsx)": Setembro tinha
// 831 células com cor e 1519 com borda, o resultado tinha zero.
//
// Como funciona: .xlsx é um zip de XMLs. Abre o zip original, acha o XML de
// cada aba, e insere/troca SÓ as células pedidas, mantendo o resto do XML
// (e todos os outros arquivos do zip: styles.xml, temas, fórmulas, filtros,
// abas ocultas, validações) exatamente como veio.
import JSZip from "jszip";

export type EscritaCelula = {
  aba: string;
  r: number; // 0-based (mesma convenção do XLSX.utils.encode_cell)
  c: number;
  valor: string;
  // Copia o estilo (atributo s) desta célula quando a célula de destino
  // ainda não existe -- ex.: cabeçalho "COD PIX" novo herda o visual do
  // cabeçalho vizinho.
  estiloDe?: { r: number; c: number };
};

export function nomeColuna(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function indiceColuna(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(tag: string, nome: string): string | null {
  const m = new RegExp(`\\s${nome}="([^"]*)"`).exec(tag);
  return m?.[1] ?? null;
}

const RE_CELULA = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
const RE_LINHA = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;

function celulaXml(ref: string, valor: string, estilo: string | null): string {
  const s = estilo != null ? ` s="${estilo}"` : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
}

// Estilo (s) de uma célula já existente no XML da aba, se houver.
function estiloDaCelula(xml: string, ref: string): string | null {
  const m = new RegExp(`<c\\b[^>]*\\sr="${ref}"[^>]*>`).exec(xml);
  return m ? attr(m[0], "s") : null;
}

// Aplica as escritas de UMA aba no XML dela.
export function aplicarNoXmlDaAba(xml: string, escritas: EscritaCelula[]): string {
  const inicio = xml.indexOf("<sheetData");
  if (inicio === -1) throw new Error("XML de aba sem <sheetData>");
  const fimAbertura = xml.indexOf(">", inicio);
  const autoFechada = xml[fimAbertura - 1] === "/";
  const fim = autoFechada ? fimAbertura + 1 : xml.indexOf("</sheetData>", fimAbertura);
  const antes = xml.slice(0, inicio);
  const depois = autoFechada ? xml.slice(fim) : xml.slice(fim + "</sheetData>".length);
  const corpo = autoFechada ? "" : xml.slice(fimAbertura + 1, fim);
  const aberturaSheetData = autoFechada
    ? xml.slice(inicio, fimAbertura - 1) + ">"
    : xml.slice(inicio, fimAbertura + 1);

  // Estilos de origem resolvidos ANTES de mexer (contra o XML original).
  const estiloOrigem = new Map<EscritaCelula, string | null>();
  for (const e of escritas) {
    if (e.estiloDe)
      estiloOrigem.set(e, estiloDaCelula(corpo, nomeColuna(e.estiloDe.c) + (e.estiloDe.r + 1)));
  }

  const porLinha = new Map<number, EscritaCelula[]>();
  for (const e of escritas) porLinha.set(e.r + 1, [...(porLinha.get(e.r + 1) ?? []), e]);

  const linhas = corpo.match(RE_LINHA) ?? [];
  // Sobras entre <row> (raras: comentários/espaços) são preservadas no fim de cada linha.
  const saida: string[] = [];
  const pendentes = new Set(porLinha.keys());

  const montarLinha = (abertura: string, celulas: string[], escritasLinha: EscritaCelula[]) => {
    const lista = celulas.map((x) => ({
      col: indiceColuna(attr(x.slice(0, x.indexOf(">") + 1), "r") ?? ""),
      xml: x,
    }));
    for (const e of escritasLinha) {
      const ref = nomeColuna(e.c) + (e.r + 1);
      const i = lista.findIndex((x) => x.col === e.c);
      const atual = i !== -1 ? lista[i] : undefined;
      if (atual) {
        const tag = atual.xml.slice(0, atual.xml.indexOf(">") + 1);
        // Nunca sobrescreve fórmula (a chamada já pula célula com valor;
        // isso é só rede de segurança).
        if (/<f[\s>]/.test(atual.xml)) continue;
        lista[i] = {
          col: e.c,
          xml: celulaXml(ref, e.valor, attr(tag, "s") ?? estiloOrigem.get(e) ?? null),
        };
      } else {
        lista.push({ col: e.c, xml: celulaXml(ref, e.valor, estiloOrigem.get(e) ?? null) });
      }
    }
    lista.sort((a, b) => a.col - b.col);
    // `spans` é só dica de otimização; tira pra não ficar inconsistente.
    const abre = abertura.replace(/\sspans="[^"]*"/, "").replace(/\/>$/, ">");
    return `${abre}${lista.map((x) => x.xml).join("")}</row>`;
  };

  for (const linha of linhas) {
    const abertura = linha.slice(0, linha.indexOf(">") + 1);
    const num = Number(attr(abertura, "r"));
    // Linhas que ainda não existem e vêm ANTES desta.
    for (const n of [...pendentes].sort((a, b) => a - b)) {
      if (n >= num) break;
      saida.push(montarLinha(`<row r="${n}">`, [], porLinha.get(n)!));
      pendentes.delete(n);
    }
    if (pendentes.has(num)) {
      const celulas = abertura.endsWith("/>") ? [] : (linha.match(RE_CELULA) ?? []);
      saida.push(montarLinha(abertura, celulas, porLinha.get(num)!));
      pendentes.delete(num);
    } else {
      saida.push(linha);
    }
  }
  for (const n of [...pendentes].sort((a, b) => a - b))
    saida.push(montarLinha(`<row r="${n}">`, [], porLinha.get(n)!));

  let novo = `${antes}${aberturaSheetData}${saida.join("")}</sheetData>${depois}`;

  // Amplia <dimension ref> se escrevemos fora dela (ex.: coluna COD PIX nova).
  const maxCol = Math.max(...escritas.map((e) => e.c));
  const maxLin = Math.max(...escritas.map((e) => e.r + 1));
  novo = novo.replace(
    /<dimension ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"\s*\/>/,
    (m, c1, r1, c2, r2) => {
      const colFim = Math.max(indiceColuna(c2 ?? c1), maxCol);
      const linFim = Math.max(Number(r2 ?? r1), maxLin);
      return `<dimension ref="${c1}${r1}:${nomeColuna(colFim)}${linFim}"/>`;
    },
  );
  return novo;
}

function resolverCaminho(base: string, alvo: string): string {
  if (alvo.startsWith("/")) return alvo.slice(1);
  const partes = base.split("/").slice(0, -1);
  for (const p of alvo.split("/")) {
    if (p === "..") partes.pop();
    else if (p !== ".") partes.push(p);
  }
  return partes.join("/");
}

// Nome da aba -> caminho do XML dela dentro do zip.
async function mapaDeAbas(zip: JSZip): Promise<Map<string, string>> {
  const wbXml = await zip.file("xl/workbook.xml")?.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wbXml || !relsXml) throw new Error("Arquivo .xlsx sem workbook.xml");
  const alvos = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) alvos.set(id, resolverCaminho("xl/workbook.xml", target));
  }
  const abas = new Map<string, string>();
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const nome = attr(m[0], "name");
    const rid = attr(m[0], "r:id");
    if (nome && rid && alvos.has(rid)) abas.set(decodificarXml(nome), alvos.get(rid)!);
  }
  return abas;
}

function decodificarXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function aplicarEscritasNoXlsx(
  original: ArrayBuffer | Uint8Array,
  escritas: EscritaCelula[],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(original);
  if (!escritas.length)
    return new Uint8Array(original instanceof Uint8Array ? original : new Uint8Array(original));
  const abas = await mapaDeAbas(zip);
  const porAba = new Map<string, EscritaCelula[]>();
  for (const e of escritas) porAba.set(e.aba, [...(porAba.get(e.aba) ?? []), e]);
  for (const [aba, lista] of porAba) {
    const caminho = abas.get(aba);
    const arquivo = caminho ? zip.file(caminho) : null;
    if (!arquivo) throw new Error(`Aba "${aba}" não encontrada no arquivo`);
    zip.file(caminho!, aplicarNoXmlDaAba(await arquivo.async("string"), lista));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
