// Self-check do casamento da planilha do supervisor (sem framework):
//   node --experimental-strip-types src/lib/casarPlanilhaPix.check.ts
import * as XLSX from "xlsx";
import assert from "node:assert/strict";
import { chaveOs, nomeBate, preencherPixNoWorkbook } from "./casarPlanilhaPix.ts";

assert.equal(chaveOs("010/022067040"), "22067040");
assert.equal(chaveOs("22067040"), "22067040");
assert.equal(chaveOs(22067040), "22067040");
assert.ok(nomeBate("Danubia Petronilio da Silva", { nome: null, arquivo: "DANUBIA PETRONILIO.pdf" }));
assert.ok(!nomeBate("LUCAS ALISON DA SILVA", { nome: "JOSE CARLOS PEREIRA", arquivo: "JOSE CARLOS PEREIRA.pdf" }));

const ws = XLSX.utils.aoa_to_sheet([
  ["OS", "CLIENTE", "VENCIMENTO", "OBS"],
  ["22067040", "MARIA SOUZA", "10/08/2026", "casa"],
  ["22067040", "MARIA SOUZA", "10/09/2026", "vencimento diferente"],
  ["111", "JOAO", "10/08/2026", "sem extração"],
  ["333", "PEDRO LIMA", 46244, "data serial do Excel (10/08/2026)"],
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Setembro");

const r = preencherPixNoWorkbook(wb, [
  { arquivo: "x.pdf", nome: "MARIA SOUZA", codigo: "010/022067040", vencimento: "10/08/2026", pix_code: "PIX-MARIA" },
  { arquivo: "PEDRO LIMA.pdf", nome: null, codigo: "722/000000333", vencimento: "10/08/2026", pix_code: "PIX-PEDRO" },
]);
const col = (c: string) => XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }).map((l) => l[4] ?? "")[Number(c)];

assert.equal(col("0"), "COD PIX");
assert.equal(col("1"), "PIX-MARIA");
assert.equal(col("2"), "");
assert.equal(col("3"), "");
assert.equal(col("4"), "PIX-PEDRO");
assert.deepEqual(r, { abas: ["Setembro"], puladas: [], linhas: 4, preenchidas: 2, jaTinhamPix: 0, semExtracao: 1, divergentes: 1 });

// Cabeçalho na linha 3 (título em cima), apelidos ("Nº OS", "Nome do Cliente",
// "Dt. Venc.") e aba sem OS (tipo a PROC da planilha real) -> pulada com motivo.
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([
  ["RELATÓRIO DE PAGOS"],
  [],
  ["Nº OS", "Nome do Cliente", "Dt. Venc.", "Chave Pix"],
  ["010/022067040", "Maria Souza", "10/08/2026", ""],
]), "Com titulo");
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([["VENDEDOR", "SUPERVISOR"], ["A", "B"]]), "PROC");
const r2 = preencherPixNoWorkbook(wb2, [
  { arquivo: "x.pdf", nome: "MARIA SOUZA", codigo: "22067040", vencimento: "10/08/2026", pix_code: "PIX-MARIA" },
]);
assert.equal(wb2.Sheets["Com titulo"]!["D4"]?.v, "PIX-MARIA");
assert.deepEqual(r2.abas, ["Com titulo"]);
assert.deepEqual(r2.puladas, [{ aba: "PROC", motivo: "sem coluna OS, CLIENTE, VENCIMENTO" }]);
console.log("casarPlanilhaPix: ok");
