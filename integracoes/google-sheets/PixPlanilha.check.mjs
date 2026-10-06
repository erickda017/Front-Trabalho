// Self-check do script da planilha (sem Google): node integracoes/google-sheets/PixPlanilha.check.mjs
// Carrega o PixPlanilha.gs num contexto isolado com SpreadsheetApp/etc. falsos.
// A paridade com o upload manual do site (src/lib/casarPlanilhaPix.ts) foi
// validada com a planilha real do supervisor (2048 linhas, 0 diferenças) --
// ver CONTEXTO.md.
import vm from "node:vm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function planilhaFalsa(abas) {
  const sheets = Object.entries(abas).map(([nome, grade]) => {
    const formatos = [];
    const aba = {
      grade,
      getName: () => nome,
      getDataRange: () => ({ getValues: () => grade.map((l) => l.map((v) => (v === undefined ? "" : v))) }),
      getRange: (r, c, nr, nc) => ({
        getValue: () => (grade[r - 1] ?? [])[c - 1] ?? "",
        setValue: (v) => { (grade[r - 1] ??= [])[c - 1] = v; },
        setValues: (vals) => vals.forEach((l, i) => { if (nc === 1 && l.length === 1) (grade[r - 1 + i] ??= [])[c - 1] = l[0]; else grade[r - 1 + i] = l.slice(); }),
        copyTo: (alvo) => formatos.push(alvo),
      }),
      getLastRow: () => grade.length,
      appendRow: (l) => grade.push(l),
      formatos,
    };
    return aba;
  });
  return {
    sheets,
    getSpreadsheetTimeZone: () => "America/Sao_Paulo",
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) ?? null,
    insertSheet: (n) => { const s = planilhaFalsa({ [n]: [] }).sheets[0]; sheets.push(s); return s; },
  };
}

function carregar(abas, chave = "chave-de-teste-com-mais-de-20") {
  const ss = planilhaFalsa(abas);
  const props = { CHAVE: chave };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, CopyPasteType: { PASTE_FORMAT: "f" } },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return JSON.parse(t); } }), MimeType: { JSON: "j" } },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("./PixPlanilha.gs", import.meta.url), "utf8"), ctx);
  return { ss, ctx };
}

const post = (ctx, corpo) => ctx.doPost({ postData: { contents: JSON.stringify(corpo) } });
const CH = "chave-de-teste-com-mais-de-20";

// Chave errada / ausente -> recusa sem tocar em nada.
{
  const { ss, ctx } = carregar({ Set: [["OS", "CLIENTE", "VENCIMENTO"], ["500", "MARIA", "10/08/2026"]] });
  assert.deepEqual(post(ctx, { chave: "errada", extracoes: [] }), { ok: false, erro: "chave inválida" });
  assert.equal(ss.sheets[0].grade[0].length, 3);
  const sem = carregar({ A: [] }, null);
  assert.match(post(sem.ctx, { chave: CH, extracoes: [] }).erro, /chave não configurada/);
}

// Caso real (Agosto): "COD PIX" com "PAGO 14-08" -> coluna nova; texto do usuário intacto;
// célula já preenchida nunca é sobrescrita; data como Date; log criado.
{
  const { ss, ctx } = carregar({
    Agosto: [
      ["OS", "CLIENTE", "VENCIMENTO", "COD PIX"],
      [4202130, "ANA TALITA GARCIA DA SILVA", new Date("2026-07-15T12:00:00Z"), "PAGO 14-08"],
      ["999", "JOAO", "10/08/2026", ""],
    ],
    PROC: [["VENDEDOR", "SUPERVISOR"]],
  });
  const r = post(ctx, {
    chave: CH,
    extracoes: [
      { codigo: "010/004202130", vencimento: "15/07/2026", nome: "ANA TALITA GARCIA DA SILVA", arquivo: "a.pdf", pix_code: "000201PIX-ANA" },
      { codigo: "999", vencimento: "10/09/2026", nome: "JOAO", arquivo: "j.pdf", pix_code: "000201PIX-ERRADO" },
    ],
  });
  assert.equal(r.ok, true);
  const g = ss.sheets[0].grade;
  assert.equal(g[1][3], "PAGO 14-08", "nunca sobrescreve texto do usuário");
  assert.equal(g[0][4], "COD PIX");
  assert.equal(g[1][4], "000201PIX-ANA");
  assert.equal(g[2][4] ?? "", "", "vencimento diferente -> vazio");
  assert.equal(r.resumo.preenchidas, 1);
  assert.equal(r.resumo.divergentes, 1);
  assert.deepEqual(r.resumo.puladas, [{ aba: "PROC", motivo: "sem coluna OS, CLIENTE, VENCIMENTO" }]);
  assert.equal(ss.sheets[0].formatos.length, 1, "copia o formato da coluna vizinha numa chamada só");
  const log = ss.getSheetByName("Log Pix");
  assert.ok(log, "aba Log Pix criada");
  assert.equal(log.grade.length, 2); // cabeçalho + 1 preenchida
  assert.equal(log.grade[1][3], "4202130");

  // 2ª execução: nada novo pra preencher, nada muda.
  const r2 = post(ctx, { chave: CH, extracoes: [{ codigo: "4202130", vencimento: "15/07/2026", nome: "X", arquivo: "", pix_code: "000201OUTRO" }] });
  assert.equal(r2.resumo.preenchidas, 0);
  assert.equal(r2.resumo.jaTinhamPix, 1);
  assert.equal(g[1][4], "000201PIX-ANA");
}
console.log("PixPlanilha: ok");
