// Self-check do script da planilha (sem Google): node integracoes/google-sheets/PixPlanilha.check.mjs
// Carrega o PixPlanilha.gs num contexto isolado com SpreadsheetApp/etc. falsos.
// A paridade com o upload manual do site (src/lib/casarPlanilhaPix.ts) foi
// validada com a planilha real do supervisor (2048 linhas, 0 diferenças) --
// ver CONTEXTO.md.
import vm from "node:vm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function abaFalsa(nome, grade) {
  return {
    grade,
    formatos: [],
    getName: () => nome,
    getLastRow() { return grade.length; },
    getDataRange: () => ({ getValues: () => grade.map((l) => l.map((v) => (v === undefined ? "" : v))) }),
    getRange(r, c, nr = 1, nc = 1) {
      const aba = this;
      return {
        setValues: (vals) => vals.forEach((l, i) => { if (nc === 1 && l.length === 1) (grade[r - 1 + i] ??= [])[c - 1] = l[0]; else grade[r - 1 + i] = l.slice(); }),
        copyTo: (alvo) => aba.formatos.push(alvo),
      };
    },
    appendRow: (l) => grade.push(l),
  };
}

function carregar(abas, { chave = "chave-de-teste-com-mais-de-20", fusoPlanilha = "" } = {}) {
  const sheets = Object.entries(abas).map(([n, g]) => abaFalsa(n, g));
  const ss = {
    sheets,
    getName: () => "Planilha oficial",
    getId: () => "ID1",
    // [2026-10] erro real: no App da Web o fuso veio vazio.
    getSpreadsheetTimeZone: () => fusoPlanilha,
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) ?? null,
    insertSheet: (n) => { const s = abaFalsa(n, []); sheets.push(s); return s; },
  };
  const props = { CHAVE: chave, PLANILHA_ID: "ID1" };
  const fusosUsados = [];
  const ctx = {
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => null, flush() {}, CopyPasteType: { PASTE_FORMAT: "f" } },
    Session: { getScriptTimeZone: () => "" },
    Utilities: {
      formatDate: (d, fuso) => {
        if (typeof fuso !== "string" || !fuso) throw new Error("Invalid argument: timeZone. Should be of type: String");
        fusosUsados.push(fuso);
        return d.toISOString().slice(0, 10);
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }), MimeType: { JSON: "j" } },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("./PixPlanilha.gs", import.meta.url), "utf8"), ctx);
  return { ss, ctx, fusosUsados };
}

const CH = "chave-de-teste-com-mais-de-20";
const post = (ctx, corpo) => ctx.doPost({ postData: { contents: JSON.stringify({ chave: CH, ...corpo }) } });

// Chave errada / ausente -> recusa.
{
  const { ctx } = carregar({ A: [] });
  assert.deepEqual(ctx.doPost({ postData: { contents: JSON.stringify({ chave: "x", acao: "abas" }) } }), { ok: false, erro: "chave inválida" });
  const sem = carregar({ A: [] }, { chave: null });
  assert.match(post(sem.ctx, { acao: "abas" }).erro, /chave não configurada/);
}

// Lista de abas (sem a Log Pix).
{
  const { ctx } = carregar({ Agosto: [["OS"]], PROC: [["X"]], "Log Pix": [] });
  const r = post(ctx, { acao: "abas" });
  assert.deepEqual(r.abas.map((a) => a.nome), ["Agosto", "PROC"]);
}

// Erro real: data da célula = meia-noite em São Paulo (03:00 UTC). Com o fuso
// da planilha vazio e o do script nos EUA, virava o dia anterior. Tem que ler 10/10.
{
  const { ss, ctx } = carregar({
    ERICK: [
      ["OS", "CLIENTE", "VENCIMENTO"],
      ["16341128", "FELIPE MATHEUS MENDES DE SOUZA", new Date("2026-10-10T03:00:00Z")],
      ["99", "FUSO LESTE", new Date("2026-10-09T14:00:00Z")], // meia-noite de 10/10 em UTC+10
      ["98", "FUSO OESTE", new Date("2026-10-10T10:00:00Z")], // meia-noite de 10/10 em UTC-10
    ],
  });
  const ext = [
    { codigo: "011/016341128", vencimento: "10/10/2026", nome: "FELIPE MATHEUS MENDES DE SOUZA", arquivo: "", pix_code: "000201FELIPE" },
    { codigo: "99", vencimento: "10/10/2026", nome: "FUSO LESTE", arquivo: "", pix_code: "000201L" },
    { codigo: "98", vencimento: "10/10/2026", nome: "FUSO OESTE", arquivo: "", pix_code: "000201O" },
  ];
  const r = post(ctx, { acao: "aba", nome: "ERICK", extracoes: ext });
  assert.equal(r.resumo.preenchidas, 3, JSON.stringify(r.resumo.detalhes));
  assert.equal(ss.sheets[0].grade[1][3], "000201FELIPE");
}

// Caso real (Agosto) com FUSO VAZIO + data como Date: usa o fallback, preenche e confere.
{
  const { ss, ctx } = carregar({
    Agosto: [
      ["OS", "CLIENTE", "VENCIMENTO", "COD PIX"],
      [4202130, "ANA TALITA GARCIA DA SILVA", new Date("2026-07-15T03:00:00Z"), "PAGO 14-08"], // meia-noite em SP,
      ["999", "JOAO", "10/08/2026", ""],
    ],
  });
  const ext = [
    { codigo: "010/004202130", vencimento: "15/07/2026", nome: "ANA TALITA GARCIA DA SILVA", arquivo: "a.pdf", pix_code: "000201PIX-ANA" },
    { codigo: "999", vencimento: "10/09/2026", nome: "JOAO", arquivo: "j.pdf", pix_code: "000201PIX-ERRADO" },
  ];
  const r = post(ctx, { acao: "aba", nome: "Agosto", extracoes: ext });
  assert.equal(r.ok, true, r.erro);
  const g = ss.sheets[0].grade;
  assert.equal(g[1][3], "PAGO 14-08", "nunca sobrescreve texto do usuário");
  assert.equal(g[0][4], "COD PIX");
  assert.equal(g[1][4], "000201PIX-ANA");
  assert.equal(g[2][4] ?? "", "", "vencimento diferente -> vazio");
  assert.equal(r.resumo.preenchidas, 1);
  assert.equal(r.resumo.escritas, 1);
  assert.equal(r.resumo.verificadas, 1, "releu a célula e confirmou");
  assert.equal(r.resumo.divergentes, 1);
  assert.equal(ss.sheets[0].formatos.length, 1, "copia o formato da coluna vizinha numa chamada só");
  const log = ss.getSheetByName("Log Pix");
  assert.equal(log.grade.length, 2);

  // 2ª execução: reaproveita a coluna, nada novo.
  const r2 = post(ctx, { acao: "aba", nome: "Agosto", extracoes: ext });
  assert.equal(r2.resumo.preenchidas, 0);
  assert.equal(r2.resumo.jaTinhamPix, 1);
  assert.equal(g[0].length, 5, "não cria outra coluna COD PIX");

  assert.match(post(ctx, { acao: "aba", nome: "Sumiu", extracoes: [] }).erro, /não existe/);
  assert.match(post(ctx, { extracoes: [] }).erro, /acao desconhecida/);
}
// Segurança: valor que não é Pix (ex.: fórmula) nunca é gravado.
{
  const { ss, ctx } = carregar({ X: [["OS", "CLIENTE", "VENCIMENTO"], ["555", "ANA", "10/10/2026"]] });
  const r = post(ctx, { acao: "aba", nome: "X", extracoes: [{ codigo: "555", vencimento: "10/10/2026", nome: "ANA", arquivo: "", pix_code: '=HYPERLINK("http://x")' }] });
  assert.equal(r.resumo.preenchidas, 0);
  assert.equal(ss.sheets[0].grade[1][3] ?? "", "");
}
console.log("PixPlanilha: ok");
