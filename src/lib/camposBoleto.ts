// [2026-10] Orquestra a leitura dos campos do cabeçalho do boleto (Código,
// vencimento, nome, valor, linha digitável). Ordem, a pedido do operador:
//
//   1. WORKER `processo-de-pdf` (OCR.space) -- SEMPRE primeiro, é o principal.
//      Até 3 tentativas (espera 2s e 5s) em falha de rede / 429 / 5xx /
//      timeout. Página 1 e, se não achar o Código, página 2 (a 1ª às vezes é
//      propaganda).
//   2. Só se o Worker falhou ou não achou o Código:
//      a. texto embutido no PDF (PDF digital; instantâneo) -- textoCabecalhoPdf.ts
//      b. OCR local no navegador (PDF imagem, ex. todos os da Claro) -- ocrLocal.ts
//   O que o Worker leu tem prioridade; o fallback só preenche o que faltou.
//
// [2026-10] Antes desta versão a ordem estava invertida (texto local
// primeiro) e havia uma "pausa de 60s" do Worker após 3 falhas: num lote
// grande, 3 demoras seguidas do OCR.space desligavam o Worker e TODOS os
// PDFs seguintes ficavam sem Código (relatado: "no F12 o worker não tá
// sendo usado"). A pausa foi removida.
//
// Separado de pixWorkerClient.ts (que só liga isto ao navegador) pra poder
// ser testado em Node com os PDFs reais e o Worker real -- ver
// camposBoleto.check.ts.
import { extrairCamposPorTexto } from "./textoCabecalhoPdf.ts";
import { lerCabecalhoPorOcr, type AmbienteOcr } from "./ocrLocal.ts";

export type CamposBoleto = {
  pixCopiaColaTexto: string | null;
  valor: string | null;
  vencimento: string | null;
  linhaDigitavel: string | null;
  codigo: string | null;
  nome: string | null;
};

export type RespostaWorkerBruta = { status: number | "rede" | "timeout"; json: any };

export type DepsCamposBoleto = {
  // Faz o POST pro Worker com o recorte da página `p` e devolve status + JSON.
  chamarWorker: (doc: any, p: number) => Promise<RespostaWorkerBruta | null>;
  ambienteOcr: () => Promise<AmbienteOcr>;
  esperar?: (ms: number) => Promise<void>;
  log?: (nivel: "info" | "warn", msg: string) => void;
};

export const ESPERAS_RETENTATIVA_MS = [2000, 5000];
const MAX_PAGINAS_WORKER = 2;

const vazio = (): CamposBoleto => ({
  pixCopiaColaTexto: null,
  valor: null,
  vencimento: null,
  linhaDigitavel: null,
  codigo: null,
  nome: null,
});

function completar(
  base: CamposBoleto,
  extra: Partial<CamposBoleto> | null | undefined,
): CamposBoleto {
  if (!extra) return base;
  const out = { ...base };
  for (const k of Object.keys(out) as (keyof CamposBoleto)[]) out[k] ??= extra[k] ?? null;
  return out;
}

function transitorio(r: RespostaWorkerBruta | null): boolean {
  if (!r) return true;
  if (r.status === "rede" || r.status === "timeout") return true;
  if (r.status === 429 || (typeof r.status === "number" && r.status >= 500)) return true;
  return r.status === 200 && !r.json; // 200 sem JSON = resposta quebrada
}

function camposDaResposta(r: RespostaWorkerBruta | null): CamposBoleto | null {
  if (!r || r.status !== 200 || !r.json?.success) return null;
  const d = r.json.data ?? {};
  return {
    pixCopiaColaTexto: d.pixCopiaCola ?? null,
    valor: d.valor ?? null,
    vencimento: d.vencimento ?? null,
    linhaDigitavel: d.linhaDigitavel ?? null,
    codigo: d.codigo ?? null,
    nome: d.nome ?? null,
  };
}

// Resultado + de onde veio cada coisa (pra log/diagnóstico).
export type ResultadoCampos = {
  campos: CamposBoleto | null;
  fonteCodigo: "worker" | "texto" | "ocr_local" | null;
  workerFalhou: boolean;
};

export async function extrairCamposDoBoleto(
  doc: any,
  nomeArquivo: string,
  deps: DepsCamposBoleto,
): Promise<ResultadoCampos> {
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const log = deps.log ?? (() => {});
  let campos = vazio();
  let workerFalhou = false;

  // 1. Worker.
  for (let p = 1; p <= Math.min(MAX_PAGINAS_WORKER, doc.numPages); p++) {
    let resposta: RespostaWorkerBruta | null = null;
    for (let tentativa = 0; tentativa <= ESPERAS_RETENTATIVA_MS.length; tentativa++) {
      resposta = await deps.chamarWorker(doc, p).catch(() => null);
      if (!transitorio(resposta)) break;
      if (tentativa < ESPERAS_RETENTATIVA_MS.length) {
        log(
          "warn",
          `[boleto] Worker falhou (${resposta?.status ?? "erro"}) em ${nomeArquivo} pág. ${p} -- nova tentativa ${tentativa + 2}/${ESPERAS_RETENTATIVA_MS.length + 1}`,
        );
        await esperar(ESPERAS_RETENTATIVA_MS[tentativa]!);
      }
    }
    if (transitorio(resposta)) workerFalhou = true;
    const lidos = camposDaResposta(resposta);
    if (lidos?.codigo)
      return { campos: completar(lidos, campos), fonteCodigo: "worker", workerFalhou };
    campos = completar(campos, lidos);
  }

  log(
    "info",
    `[boleto] ${workerFalhou ? "Worker falhou" : "Worker não achou o Código"} em ${nomeArquivo} -- usando leitura local`,
  );

  // 2a. Texto embutido (PDF digital).
  try {
    const { semTexto, ...lidos } = await extrairCamposPorTexto(doc);
    if (lidos.codigo) {
      return {
        campos: completar(completar(campos, { codigo: lidos.codigo }), lidos),
        fonteCodigo: "texto",
        workerFalhou,
      };
    }
    if (!semTexto) campos = completar(campos, lidos);
  } catch (err) {
    log("warn", `[boleto] leitura de texto falhou em ${nomeArquivo}: ${(err as Error).message}`);
  }

  // 2b. OCR local (PDF imagem).
  try {
    const ocr = await lerCabecalhoPorOcr(doc, await deps.ambienteOcr());
    if (ocr?.codigo) {
      log("info", `[boleto] OCR local achou o Código de ${nomeArquivo}: ${ocr.codigo}`);
      return { campos: completar(campos, ocr), fonteCodigo: "ocr_local", workerFalhou };
    }
    campos = completar(campos, ocr);
  } catch (err) {
    log("warn", `[boleto] OCR local falhou em ${nomeArquivo}: ${(err as Error).message}`);
  }

  return {
    campos: Object.values(campos).some(Boolean) ? campos : null,
    fonteCodigo: null,
    workerFalhou,
  };
}
