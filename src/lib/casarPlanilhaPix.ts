// Planilha do supervisor -> mesma planilha com o Pix preenchido.
//
// Uma linha recebe Pix quando bate com uma extração (pix_extracoes, de
// qualquer operador, com ou sem cliente cadastrado), por prioridade:
//   1. OS + VENCIMENTO + CLIENTE (nome do PDF ou do arquivo)
//   2. OS + VENCIMENTO (nome diferente/não lido) -- desde que não haja 2
//      PDFs com essa OS + vencimento e Pix diferentes.
// OS = "Código" do cabeçalho do PDF ("22067040" == "010/022067040").
// OS sozinha não basta: o mesmo cliente tem uma fatura por mês, e Pix de
// outro vencimento é cobrança errada. Na dúvida, deixa vazio.
//
// Mexe direto nas células do workbook (não remonta via aoa) pra preservar
// todas as abas, colunas extras e valores originais. Pra .xlsx, o arquivo
// final NÃO sai do workbook do SheetJS (perde estilo) -- sai do arquivo
// original com `resumo.escritas` aplicadas (lib/xlsxPatch.ts).
import * as XLSX from "xlsx";
import { paraIso } from "./dataBr.ts";
import type { EscritaCelula } from "./xlsxPatch.ts";

export type ExtracaoPix = {
  arquivo: string | null;
  nome: string | null;
  codigo: string | null;
  vencimento: string | null;
  pix_code: string;
};

export type StatusLinha = "preenchida" | "ja_tinha_pix" | "ocupada" | "sem_extracao" | "divergente";
export type DetalheLinha = {
  aba: string;
  linha: number; // como o Excel mostra (1-based)
  os: string;
  cliente: string;
  vencimento: string; // ISO, como lido da planilha
  status: StatusLinha;
  motivo: string;
};

export type ResumoPlanilhaPix = {
  abas: string[]; // abas processadas (tinham OS + CLIENTE + VENCIMENTO)
  puladas: { aba: string; motivo: string }[]; // abas ignoradas e por quê
  linhas: number;
  preenchidas: number;
  jaTinhamPix: number;
  semExtracao: number; // nenhuma extração com essa OS
  divergentes: number; // OS bateu, mas nome ou vencimento não
  ocupadas: number; // célula da coluna Pix já tinha OUTRO texto (não é Pix) -- não sobrescreve
  extracoesRecebidas: number; // total vindo do servidor
  extracoesComOs: number; // dessas, quantas têm OS + Pix (as únicas que podem casar)
  // [2026-10] Uma entrada por linha com OS -- vira o relatório CSV e a
  // tabela de divergências na tela. "Por que essa linha não recebeu Pix?"
  detalhes: DetalheLinha[];
  // Abas onde a coluna com nome de Pix tinha outro conteúdo (ex.: "PAGO
  // 14-08") e o Pix foi pra uma coluna "COD PIX" nova.
  colunasRedirecionadas: { aba: string; de: string; para: string }[];
  // [2026-10] Células escritas, pra aplicar no ARQUIVO ORIGINAL via
  // lib/xlsxPatch.ts sem perder formatação (ver comentário lá).
  escritas: EscritaCelula[];
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
  if (typeof cel.v === "number")
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(cel.v) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  return paraIso(String(cel.v));
}

// Apelidos aceitos (cabeçalho já normalizado: minúsculo, sem acento,
// pontuação vira espaço -- "Nº OS" vira "n os", "DT. VENC." vira "dt venc").
const COL_OS = [
  /^os$/,
  /^o s$/,
  /^n os$/,
  /^num(ero)? (da )?os$/,
  /^cod(igo)? os$/,
  /ordem( de)? servico/,
];
const COL_NOME = [/^cliente$/, /^nome$/, /^nome (do )?cliente$/, /^titular$/, /razao social/];
const COL_VENC = [/^vencimento$/, /^venc$/, /^dt venc/, /^data (de )?venc/, /^vencto$/];
const COL_PIX = [/^cod pix$/, /^pix$/, /codigo.*pix/, /chave.*pix/, /pix.*copia/];
// Cabeçalho nem sempre está na 1ª linha (planilha com título em cima).
const LINHAS_PROCURA_CABECALHO = 15;

// Pix copia-e-cola (BR Code EMV) sempre começa com "000201".
export function pareceCodigoPix(t: string): boolean {
  return /^000201/.test(t.replace(/\s/g, ""));
}

function acharColuna(cabecalho: string[], regexes: RegExp[]): number {
  for (const r of regexes) {
    const i = cabecalho.findIndex((c) => r.test(c));
    if (i !== -1) return i;
  }
  return -1;
}

export function preencherPixNoWorkbook(
  wb: XLSX.WorkBook,
  extracoes: ExtracaoPix[],
): ResumoPlanilhaPix {
  const resumo: ResumoPlanilhaPix = {
    abas: [],
    puladas: [],
    linhas: 0,
    preenchidas: 0,
    jaTinhamPix: 0,
    semExtracao: 0,
    divergentes: 0,
    ocupadas: 0,
    extracoesRecebidas: extracoes.length,
    extracoesComOs: 0,
    detalhes: [],
    colunasRedirecionadas: [],
    escritas: [],
  };

  // OS -> extrações (na ordem recebida: mais recente primeiro).
  const porOs = new Map<string, ExtracaoPix[]>();
  for (const e of extracoes) {
    const k = chaveOs(e.codigo);
    if (!k || !e.pix_code) continue;
    porOs.set(k, [...(porOs.get(k) ?? []), e]);
    resumo.extracoesComOs++;
  }

  for (const nomeAba of wb.SheetNames) {
    const ws = wb.Sheets[nomeAba];
    if (!ws?.["!ref"]) {
      resumo.puladas.push({ aba: nomeAba, motivo: "aba vazia" });
      continue;
    }
    const range = XLSX.utils.decode_range(ws["!ref"]);

    // Primeira linha (entre as 15 de cima) que tenha OS + CLIENTE + VENCIMENTO.
    let r0 = -1,
      cabecalho: string[] = [],
      colOs = -1,
      colNome = -1,
      colVenc = -1;
    let faltando: string[] = ["OS", "CLIENTE", "VENCIMENTO"];
    for (
      let r = range.s.r;
      r <= Math.min(range.e.r, range.s.r + LINHAS_PROCURA_CABECALHO - 1);
      r++
    ) {
      const linha: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++)
        linha[c] = normalizar(ws[XLSX.utils.encode_cell({ r, c })]?.v);
      const [o, n, v] = [
        acharColuna(linha, COL_OS),
        acharColuna(linha, COL_NOME),
        acharColuna(linha, COL_VENC),
      ];
      const falta = [o === -1 && "OS", n === -1 && "CLIENTE", v === -1 && "VENCIMENTO"].filter(
        Boolean,
      ) as string[];
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

    const celAba = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })];
    const textoDe = (r: number, c: number) => String(celAba(r, c)?.v ?? "").trim();

    let colPix = acharColuna(cabecalho, COL_PIX);
    // [2026-10] Cabeçalho com nome de Pix não garante que a coluna é de Pix:
    // na planilha real, Agosto tem "COD PIX" com "PAGO 14-08" nas 289
    // linhas (é a coluna de OBS renomeada). Antes isso contava tudo como
    // "já tinham PIX" e nada era preenchido. Se a coluna tem texto que não
    // é Pix, ela é tratada como coluna de outra coisa (não é sobrescrita)
    // e o Pix vai pra uma "COD PIX" nova.
    if (colPix !== -1) {
      let outroTexto = 0;
      for (let r = r0 + 1; r <= range.e.r; r++) {
        const t = textoDe(r, colPix);
        if (t && !pareceCodigoPix(t)) outroTexto++;
      }
      if (outroTexto > 0) {
        const de = XLSX.utils.encode_col(colPix);
        colPix = -1;
        resumo.colunasRedirecionadas.push({ aba: nomeAba, de, para: "" });
      }
    }
    const colunaNova = colPix === -1;
    if (colunaNova) {
      // Primeira coluna depois do último cabeçalho preenchido que esteja
      // VAZIA em todas as linhas de dados (o !ref pode incluir colunas só
      // formatadas; e nunca escreve por cima de dado sem cabeçalho).
      colPix = cabecalho.reduce((ultimo, c, i) => (c ? i : ultimo), range.s.c) + 1;
      const colunaVazia = (c: number) => {
        for (let r = r0 + 1; r <= range.e.r; r++) if (textoDe(r, c)) return false;
        return true;
      };
      while (!colunaVazia(colPix)) colPix++;
      XLSX.utils.sheet_add_aoa(ws, [["COD PIX"]], { origin: { r: r0, c: colPix } });
      resumo.escritas.push({
        aba: nomeAba,
        r: r0,
        c: colPix,
        valor: "COD PIX",
        estiloDe: { r: r0, c: colPix - 1 },
      });
      const red = resumo.colunasRedirecionadas.find((x) => x.aba === nomeAba && !x.para);
      if (red) red.para = XLSX.utils.encode_col(colPix);
    }
    resumo.abas.push(nomeAba);

    for (let r = r0 + 1; r <= range.e.r; r++) {
      const cel = (c: number) => celAba(r, c);
      const os = chaveOs(cel(colOs)?.v);
      if (!os) continue;
      resumo.linhas++;
      const venc = vencimentoDaCelula(cel(colVenc));
      const nome = cel(colNome)?.v;
      const detalhe = (status: StatusLinha, motivo: string) =>
        resumo.detalhes.push({
          aba: nomeAba,
          linha: r + 1,
          os,
          cliente: String(nome ?? ""),
          vencimento: venc,
          status,
          motivo,
        });

      const atual = textoDe(r, colPix);
      if (atual) {
        if (pareceCodigoPix(atual)) {
          resumo.jaTinhamPix++;
          detalhe("ja_tinha_pix", "célula Pix já preenchida -- não sobrescreve");
        } else {
          resumo.ocupadas++;
          detalhe(
            "ocupada",
            `célula Pix tem outro texto ("${atual.slice(0, 40)}") -- não sobrescreve`,
          );
        }
        continue;
      }

      const candidatas = porOs.get(os);
      if (!candidatas) {
        resumo.semExtracao++;
        detalhe("sem_extracao", 'nenhum PDF extraído com essa OS no "Código"');
        continue;
      }

      // [2026-10] Prioridades (pedido do supervisor):
      //   1. OS + vencimento + nome batem -> preenche;
      //   2. OS + vencimento batem (nome diferente ou não lido no PDF) ->
      //      preenche também: OS + vencimento já identificam a fatura.
      //      Só não preenche se houver PDFs com OS + vencimento iguais e Pix
      //      DIFERENTES (aí não dá pra saber qual é o certo).
      // OS sozinha continua não bastando (Pix de outro mês = cobrança errada).
      const mesmoVenc = venc ? candidatas.filter((e) => paraIso(e.vencimento) === venc) : [];
      const porNome = mesmoVenc.find((e) => nomeBate(nome, e));
      const pixDistintos = new Set(mesmoVenc.map((e) => e.pix_code));
      const certa = porNome ?? (pixDistintos.size === 1 ? mesmoVenc[0] : undefined);
      const criterio = porNome ? "OS + vencimento + nome" : "OS + vencimento";
      if (!certa && pixDistintos.size > 1) {
        resumo.divergentes++;
        detalhe(
          "divergente",
          `OS + vencimento batem com ${pixDistintos.size} PDFs de Pix diferentes e nenhum com o nome da planilha -- ambíguo`,
        );
        continue;
      }
      if (!certa) {
        resumo.divergentes++;
        const porque = candidatas.slice(0, 3).map((e) => {
          const problemas = [
            !venc
              ? "vencimento vazio/ilegível na planilha"
              : paraIso(e.vencimento) !== venc
                ? `vencimento do PDF ${paraIso(e.vencimento) || "não lido"}`
                : "",
            !nomeBate(nome, e) ? `nome no PDF "${e.nome || e.arquivo || "?"}"` : "",
          ].filter(Boolean);
          return problemas.join(" e ");
        });
        detalhe(
          "divergente",
          `OS achada em ${candidatas.length} PDF(s), mas: ${porque.join(" | ")}`,
        );
        continue;
      }

      XLSX.utils.sheet_add_aoa(ws, [[certa.pix_code]], { origin: { r, c: colPix } });
      // Coluna criada agora: herda o estilo (borda/cor da linha) da vizinha.
      resumo.escritas.push({
        aba: nomeAba,
        r,
        c: colPix,
        valor: certa.pix_code,
        ...(colunaNova ? { estiloDe: { r, c: colPix - 1 } } : {}),
      });
      resumo.preenchidas++;
      detalhe("preenchida", `${criterio} -- PDF "${certa.arquivo || certa.nome || "?"}"`);
    }
  }

  return resumo;
}
