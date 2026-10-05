// Self-check (sem framework): node --experimental-strip-types src/lib/camposBoleto.check.ts
// Ordem Worker -> fallback e política de nova tentativa, com dependências falsas.
// A validação com os 95 PDFs reais (Worker real e OCR local) está descrita no
// CONTEXTO.md ("Extração do Código: Worker primeiro, OCR local de fallback").
import assert from "node:assert/strict";
import { extrairCamposDoBoleto, type RespostaWorkerBruta } from "./camposBoleto.ts";

const docFalso = (numPages: number) => ({
  numPages,
  // PDF "imagem": sem texto embutido (força o OCR local no fallback).
  getPage: async () => ({
    getViewport: () => ({ width: 600, height: 800 }),
    getTextContent: async () => ({ items: [] }),
    cleanup() {},
  }),
});
const ok = (codigo: string | null): RespostaWorkerBruta => ({
  status: 200,
  json: { success: true, data: { codigo, vencimento: "10/10/2026", nome: "FULANO" } },
});

// 1. Worker acha na 1ª -> não chama fallback.
{
  let ocrUsado = false;
  const r = await extrairCamposDoBoleto(docFalso(1), "a.pdf", {
    chamarWorker: async () => ok("003/422726135"),
    ambienteOcr: async () => {
      ocrUsado = true;
      throw new Error("não devia");
    },
    esperar: async () => {},
  });
  assert.equal(r.fonteCodigo, "worker");
  assert.equal(r.campos?.codigo, "003/422726135");
  assert.equal(ocrUsado, false);
}

// 2. Rede cai 2x e volta -> 3 tentativas, sem fallback.
{
  let n = 0;
  const r = await extrairCamposDoBoleto(docFalso(1), "b.pdf", {
    chamarWorker: async () => (++n < 3 ? { status: "rede", json: null } : ok("010/022067040")),
    ambienteOcr: async () => {
      throw new Error("não devia");
    },
    esperar: async () => {},
  });
  assert.equal(n, 3);
  assert.equal(r.fonteCodigo, "worker");
}

// 3. 429 sempre -> 3 tentativas por página, depois fallback (OCR local).
{
  let n = 0;
  let ocrUsado = false;
  const r = await extrairCamposDoBoleto(docFalso(2), "c.pdf", {
    chamarWorker: async () => (n++, { status: 429, json: { success: false } }),
    ambienteOcr: async () => {
      ocrUsado = true;
      throw new Error("sem tesseract no teste");
    },
    esperar: async () => {},
  });
  assert.equal(n, 6); // 2 páginas x 3 tentativas
  assert.equal(ocrUsado, true);
  assert.equal(r.workerFalhou, true);
  assert.equal(r.campos, null);
}

// 4. Worker responde mas sem Código na pág. 1 e acha na 2 -> fica com a 2.
{
  const r = await extrairCamposDoBoleto(docFalso(2), "d.pdf", {
    chamarWorker: async (_d, p) => (p === 1 ? ok(null) : ok("747/001107370")),
    ambienteOcr: async () => {
      throw new Error("não devia");
    },
    esperar: async () => {},
  });
  assert.equal(r.campos?.codigo, "747/001107370");
}
console.log("camposBoleto: ok");
