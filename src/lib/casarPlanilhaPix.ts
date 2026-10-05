// Planilha do supervisor -> mesma planilha com o Pix preenchido.
//
// Uma linha só recebe Pix quando os TRÊS batem com uma extração
// (pix_extracoes, de qualquer operador, com ou sem cliente cadastrado):
//   1. OS da planilha  == "Código" do cabeçalho do PDF ("22067040" == "010/022067040")
//   2. CLIENTE         ~= nome lido no PDF ou nome do arquivo
//   3. VENCIMENTO      == vencimento lido no PDF
// OS sozinha não basta: o mesmo cliente tem uma fatura por mês, e Pix de
// outro vencimento é cobrança errada. Na dúvida, deixa vazio.
//
// Mexe direto nas células do workbook (não remonta via aoa) pra preservar
// todas as abas, colunas extras e valores originais.
import * as XLSX from "xlsx";
import { paraIso } from "./dataBr.ts";

export type ExtracaoPix = {
  arquivo: string | null;
  nome: string | null;
  codigo: string | null;
  vencimento: string | null;
  pix_code: string;
};

export type ResumoPlanilhaPix = {
  abas: string[]; // abas processadas (tinham OS + CLIENTE + VENCIMENTO)
  puladas: { aba: string; motivo: string }[]; // abas ignoradas e por quê
  linhas: number;
  preenchidas: number;
  jaTinhamPix: number;
  semExtracao: number; // nenhuma extração com essa OS
  divergentes: number; // OS bateu, mas nome ou vencimento não
};

function normalizar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.pdf$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "010/022067040" -> "22067040"; "22067040" -> "22067040".
export function chaveOs(v: unknown): string {
  const s = String(v ?? "");
  const depoisDaBarra = s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s;
  return depoisDaBarra.replace(/\D/g, "").replace(/^0+/, "");
}

// Palavras inteiras: todas as palavras do nome mais curto (mín. 2) têm que
// estar no mais longo -- "DANUBIA PETRONILIO" casa "DANUBIA PETRONILIO DA
// SILVA", mas "PAULO" sozinho não casa nada.
export function nomeBate(nomePlanilha: unknown, e: Pick<ExtracaoPix, "nome" | "arquivo">): boolean {
  const alvo = normalizar(nomePlanilha).split(" ").filter(Boolean);
  return [e.nome, e.arquivo].some((fonte) => {
    const n = normalizar(fonte).split(" ").filter(Boolean);
    const [curto, longo] = n.length < alvo.length ? [n, alvo] : [alvo, n];
    return curto.length >= 2 && curto.every((p) => longo.includes(p));
  });
}

// Célula de data pode vir como serial do Excel (número), Date ou texto BR/ISO.
function vencimentoDaCelula(cel: XLSX.CellObject | undefined): string {
  if (!cel || cel.v == null || cel.v === "") return "";
  if (cel.v instanceof Date) return paraIso(cel.v.toISOString().slice(0, 10));
  // Serial do Excel: dias desde 30/12/1899.
  if (typeof cel.v === "number") return new Date(Date.UTC(1899, 11, 30) + Math.floor(cel.v) * 86_400_000).toISOString().slice(0, 10);
  return paraIso(String(cel.v));
}

// Apelidos aceitos (cabeçalho já normalizado: minúsculo, sem acento,
// pontuação vira espaço -- "Nº OS" vira "n os", "DT. VENC." vira "dt venc").
const COL_OS = [/^os$/, /^o s$/, /^n os$/, /^num(ero)? (da )?os$/, /^cod(igo)? os$/, /ordem( de)? servico/];
const COL_NOME = [/^cliente$/, /^nome$/, /^nome (do )?cliente$/, /^titular$/, /razao social/];
const COL_VENC = [/^vencimento$/, /^venc$/, /^dt venc/, /^data (de )?venc/, /^vencto$/];
const COL_PIX = [/^cod pix$/, /^pix$/, /codigo.*pix/, /chave.*pix/, /pix.*copia/];
// Cabeçalho nem sempre está na 1ª linha (planilha com título em cima).
const LINHAS_PROCURA_CABECALHO = 15;

function acharColuna(cabecalho: string[], regexes: RegExp[]): number {
  for (const r of regexes) {
    const i = cabecalho.findIndex((c) => r.test(c));
    if (i !== -1) return i;
  }
  return -1;
}

export function preencherPixNoWorkbook(wb: XLSX.WorkBook, extracoes: ExtracaoPix[]): ResumoPlanilhaPix {
  const resumo: ResumoPlanilhaPix = { abas: [], puladas: [], linhas: 0, preenchidas: 0, jaTinhamPix: 0, semExtracao: 0, divergentes: 0 };

  // OS -> extrações (na ordem recebida: mais recente primeiro).
  const porOs = new Map<string, ExtracaoPix[]>();
  for (const e of extracoes) {
    const k = chaveOs(e.codigo);
    if (!k || !e.pix_code) continue;
    porOs.set(k, [...(porOs.get(k) ?? []), e]);
  }

  for (const nomeAba of wb.SheetNames) {
    const ws = wb.Sheets[nomeAba];
    if (!ws?.["!ref"]) {
      resumo.puladas.push({ aba: nomeAba, motivo: "aba vazia" });
      continue;
    }
    const range = XLSX.utils.decode_range(ws["!ref"]);

    // Primeira linha (entre as 15 de cima) que tenha OS + CLIENTE + VENCIMENTO.
    let r0 = -1, cabecalho: string[] = [], colOs = -1, colNome = -1, colVenc = -1;
    let faltando: string[] = ["OS", "CLIENTE", "VENCIMENTO"];
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + LINHAS_PROCURA_CABECALHO - 1); r++) {
      const linha: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) linha[c] = normalizar(ws[XLSX.utils.encode_cell({ r, c })]?.v);
      const [o, n, v] = [acharColuna(linha, COL_OS), acharColuna(linha, COL_NOME), acharColuna(linha, COL_VENC)];
      const falta = [o === -1 && "OS", n === -1 && "CLIENTE", v === -1 && "VENCIMENTO"].filter(Boolean) as string[];
      if (!falta.length) {
        [r0, cabecalho, colOs, colNome, colVenc] = [r, linha, o, n, v];
        break;
      }
      if (falta.length < faltando.length) faltando = falta; // melhor palpite pro aviso
    }
    if (r0 === -1) {
      resumo.puladas.push({ aba: nomeAba, motivo: `sem coluna ${faltando.join(", ")}` });
      continue;
    }

    let colPix = acharColuna(cabecalho, COL_PIX);
    if (colPix === -1) {
      // Logo depois do último cabeçalho preenchido (o !ref pode incluir
      // colunas vazias só formatadas).
      colPix = cabecalho.reduce((ultimo, c, i) => (c ? i : ultimo), range.s.c) + 1;
      XLSX.utils.sheet_add_aoa(ws, [["COD PIX"]], { origin: { r: r0, c: colPix } });
    }
    resumo.abas.push(nomeAba);

    for (let r = r0 + 1; r <= range.e.r; r++) {
      const cel = (c: number) => ws[XLSX.utils.encode_cell({ r, c })];
      const os = chaveOs(cel(colOs)?.v);
      if (!os) continue;
      resumo.linhas++;

      if (String(cel(colPix)?.v ?? "").trim()) {
        resumo.jaTinhamPix++;
        continue;
      }

      const candidatas = porOs.get(os);
      if (!candidatas) {
        resumo.semExtracao++;
        continue;
      }

      const venc = vencimentoDaCelula(cel(colVenc));
      const nome = cel(colNome)?.v;
      const certa = candidatas.find((e) => venc && paraIso(e.vencimento) === venc && nomeBate(nome, e));
      if (!certa) {
        resumo.divergentes++;
        continue;
      }

      XLSX.utils.sheet_add_aoa(ws, [[certa.pix_code]], { origin: { r, c: colPix } });
      resumo.preenchidas++;
    }
  }

  return resumo;
}
