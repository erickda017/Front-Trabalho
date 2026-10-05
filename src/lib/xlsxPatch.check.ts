// Self-check (sem framework): node --experimental-strip-types src/lib/xlsxPatch.check.ts
import assert from "node:assert/strict";
import { aplicarNoXmlDaAba, nomeColuna } from "./xlsxPatch.ts";

assert.equal(nomeColuna(0), "A");
assert.equal(nomeColuna(25), "Z");
assert.equal(nomeColuna(26), "AA");

const xml =
  '<worksheet><dimension ref="A1:B3"/><sheetData>' +
  '<row r="1" spans="1:2"><c r="A1" s="5" t="s"><v>0</v></c><c r="B1" s="6" t="s"><v>1</v></c></row>' +
  '<row r="2"><c r="A2" s="7"><v>1</v></c><c r="C2" s="9"/><c r="D2" s="8"><f>A2+1</f><v>2</v></c></row>' +
  "</sheetData></worksheet>";

const out = aplicarNoXmlDaAba(xml, [
  { aba: "x", r: 0, c: 2, valor: "COD PIX", estiloDe: { r: 0, c: 1 } }, // célula nova herda s=6
  { aba: "x", r: 1, c: 2, valor: "PIX&<1>" }, // célula vazia existente mantém s=9
  { aba: "x", r: 1, c: 3, valor: "NAO" }, // fórmula nunca é sobrescrita
  { aba: "x", r: 3, c: 0, valor: "linha nova" }, // linha que não existia
]);

assert.match(out, /<c r="B1" s="6" t="s"><v>1<\/v><\/c><c r="C1" s="6" t="inlineStr">/); // ordem + estilo herdado
assert.match(
  out,
  /<c r="C2" s="9" t="inlineStr"><is><t xml:space="preserve">PIX&amp;&lt;1&gt;<\/t>/,
);
assert.match(out, /<c r="D2" s="8"><f>A2\+1<\/f>/);
assert.ok(!out.includes("NAO"));
assert.match(out, /<\/row><row r="4"><c r="A4" t="inlineStr">/);
assert.match(out, /<dimension ref="A1:D4"\/>/);
assert.match(out, /<c r="A1" s="5" t="s"><v>0<\/v><\/c>/); // resto intacto
console.log("xlsxPatch.check: ok");
