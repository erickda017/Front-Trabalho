// Self-check (sem framework): node --experimental-strip-types src/lib/textoCabecalhoPdf.check.ts
import assert from "node:assert/strict";
import { extrairCamposDoTexto } from "./textoCabecalhoPdf.ts";

// Rótulo e valor na mesma linha.
let c = extrairCamposDoTexto([
  "CLARO S.A. - FATURA",
  "Cliente: MARIA LINDALVA DA SILVA OLIVEIRA",
  "Código: 010/022067040   Vencimento: 10/08/2026",
  "Valor a pagar R$ 89,90",
]);
assert.equal(c.codigo, "010/022067040");
assert.equal(c.vencimento, "10/08/2026");
assert.equal(c.valor, "89,90");
assert.equal(c.nome, "MARIA LINDALVA DA SILVA OLIVEIRA");

// Rótulo numa linha, valor na de baixo; caixa alta; "Vencto".
c = extrairCamposDoTexto([
  "NOME DO CLIENTE",
  "JOSE CARLOS PEREIRA",
  "CÓDIGO DO CLIENTE",
  "722/000000333",
  "VENCTO",
  "05/09/2026",
]);
assert.equal(c.codigo, "722/000000333");
assert.equal(c.vencimento, "05/09/2026");

// Não chuta: sem rótulo, data de emissão e números soltos NÃO viram vencimento/código.
c = extrairCamposDoTexto([
  "Emissão: 01/08/2026",
  "Protocolo 123456789",
  "Código de barras 8469000000 1",
]);
assert.equal(c.vencimento, null);
assert.equal(c.codigo, null);

// Data impossível não é aceita.
assert.equal(extrairCamposDoTexto(["Vencimento: 45/13/2026"]).vencimento, null);

// Linha digitável (47 dígitos com pontos/espaços).
c = extrairCamposDoTexto(["23793.38128 60082.677139 66000.063307 9 84340000008990"]);
assert.equal(c.linhaDigitavel, "23793381286008267713966000063307984340000008990");
// Rótulo composto não vira nome; nome para no próximo rótulo.
assert.equal(
  extrairCamposDoTexto(["Nome do Cliente: Sergio Leme da Silva Junior"]).nome,
  "Sergio Leme da Silva Junior",
);
assert.equal(
  extrairCamposDoTexto(["Nome: NILCE DA SILVA   Cód. Cliente: 1047995"]).nome,
  "NILCE DA SILVA",
);
console.log("textoCabecalhoPdf: ok");
