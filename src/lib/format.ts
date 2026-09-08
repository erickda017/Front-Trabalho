// [2026-09] Extraídas de routes/index.tsx, conexoes.tsx, historico.tsx,
// pix.tsx e supervisor.tsx, onde cada uma existia duplicada (2-3 cópias
// idênticas ou quase-idênticas) -- ver auditoria técnica em CONTEXTO.md.
// Só o que de fato repetia; formatarValor de clientes.tsx (mais elaborada,
// tenta 2 estratégias de parse) e a versão simples de supervisor.tsx
// continuam onde estavam, cada uma usada só 1 vez.
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

/** "12/09/2026, 14:30" -- data+hora absoluta, pt-BR. `iso` inválido/vazio
 *  devolve "—" (vazio) ou o próprio texto cru (erro de parse), nunca quebra. */
export function formatarDataHoraAbsoluta(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** "há 2 horas" -- data relativa a agora, pt-BR. */
export function formatarDataRelativa(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "—";
  }
}

/** "YYYY-MM-DD" -> "DD/MM" (rótulo curto pra eixo de gráfico). */
export function formatarDiaCurto(data: string): string {
  const [, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}
