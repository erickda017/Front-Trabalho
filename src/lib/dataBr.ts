// Helpers de data compartilhados -- resolve a ambiguidade que causava o bug
// crítico de "vencimento invertido" (10/08 exibido como 08/10).
//
// Causa raiz: `clientes.vencimento` é texto livre no formato brasileiro
// ("DD/MM/AAAA", ver backend/src/lib/faturaPropagacao.js e
// migration-19-safras-faturas.sql), mas `new Date("10/08/2026")` no
// JavaScript interpreta strings com "/" como formato AMERICANO
// (MM/DD/AAAA) -- "10/08" (10 de agosto) virava outubro/08. `data_prazo`,
// por outro lado, já vem sempre em ISO ("AAAA-MM-DD", coluna `date` real do
// Postgres), sem essa ambiguidade.
//
// `parseDataFlexivel` aceita as DUAS formas que já aparecem hoje no campo
// `vencimento` (ISO, quando editado pelo `<input type="date">` nativo, que
// só entende ISO; BR, quando veio da extração de PDF/OCR) e sempre
// interpreta corretamente, sem depender do parser ambíguo do `Date`.

const REGEX_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const REGEX_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

/** Converte "10/08/2026" ou "2026-08-10" num Date local (meio-dia, evita
 *  qualquer corte de fuso horário perto da meia-noite). Retorna null se o
 *  texto não for reconhecido ou a data não existir. */
export function parseDataFlexivel(texto: string | null | undefined): Date | null {
  if (!texto) return null;
  const s = texto.trim();
  if (!s) return null;

  const iso = s.match(REGEX_ISO);
  if (iso) {
    const [, anoStr, mesStr, diaStr] = iso;
    return montarData(Number(anoStr), Number(mesStr), Number(diaStr));
  }

  const br = s.match(REGEX_BR);
  if (br) {
    const [, diaStr, mesStr, anoStrBr] = br;
    let ano = Number(anoStrBr);
    if ((anoStrBr ?? "").length === 2) ano += 2000;
    return montarData(ano, Number(mesStr), Number(diaStr));
  }

  return null;
}

function montarData(ano: number, mes: number, dia: number): Date | null {
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || !Number.isFinite(dia)) return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(ano, mes - 1, dia, 12, 0, 0);
  // Confirma que o dia não "estourou" pro mês seguinte (ex: 31/02).
  if (d.getMonth() !== mes - 1) return null;
  return d;
}

/** "10/08/2026" ou "2026-08-10" -> "2026-08-10" (ISO), pra uso em
 *  `<input type="date">` e em comparações/ordenação seguras. Retorna "" se
 *  não reconhecer o texto (input nativo trata "" como vazio). */
export function paraIso(texto: string | null | undefined): string {
  const d = parseDataFlexivel(texto);
  if (!d) return "";
  const ano = String(d.getFullYear()).padStart(4, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** "2026-08-10" ou "10/08/2026" -> "10/08/2026" (BR), formato usado na
 *  exibição e na variável {{vencimento}} da mensagem. */
export function paraBr(texto: string | null | undefined): string {
  const d = parseDataFlexivel(texto);
  if (!d) return "";
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const ano = String(d.getFullYear()).padStart(4, "0");
  return `${dia}/${mes}/${ano}`;
}
