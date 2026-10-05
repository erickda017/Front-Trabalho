// [2026-10] "Colar números" na tela de Disparos -- mesma regra de
// backend/src/lib/telefonesAvulsos.js (o backend revalida; isto aqui é só a
// prévia na tela antes de criar o lote). Um número por linha, ou separados
// por vírgula / ponto e vírgula / tab, com qualquer formatação.
export function normalizarTelefoneBr(numero: string): string {
  const limpo = numero.replace(/\D/g, "");
  if (!limpo) return "";
  return limpo.length <= 11 ? `55${limpo}` : limpo;
}

export function normalizarListaTelefones(texto: string): {
  validos: string[];
  invalidos: string[];
  repetidos: number;
} {
  const validos: string[] = [];
  const invalidos: string[] = [];
  const vistos = new Set<string>();
  let repetidos = 0;
  for (const bruto of texto.split(/[\n\r,;\t]+/)) {
    const t = bruto.trim();
    if (!t) continue;
    const tel = normalizarTelefoneBr(t);
    const ok =
      /^\d{12,15}$/.test(tel) &&
      (!tel.startsWith("55") || tel.length <= 13) &&
      !/^55(0|1[^1-9])/.test(tel);
    if (!ok) {
      invalidos.push(t);
      continue;
    }
    if (vistos.has(tel)) {
      repetidos++;
      continue;
    }
    vistos.add(tel);
    validos.push(tel);
  }
  return { validos, invalidos, repetidos };
}

// "5511999999999" -> "(11) 99999-9999" (só exibição).
export function formatarTelefone(tel: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(tel);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${tel}`;
}
