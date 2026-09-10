// [2026-09] GET /chat/conversas é paginado (mesmo motivo/padrão de
// lib/clientesPaginados.ts) -- pagina por baixo dos panos até coletar a
// carteira inteira de conversas, em vez de a tela do Chat assumir que tudo
// cabe numa página só (que caía no default do backend, cortando em silêncio
// quem tivesse mais de 1000 conversas).
import { api } from "@/api";
import type { Campanha, Conversa } from "@/lib/types";

const PER_PAGE = 5000;

/** `campanha` omitida = 'cobranca' (comportamento de sempre). Ver
 *  CONTEXTO.md ("Ativação Chip") -- a aba de chat de chip chama isto com
 *  campanha: 'chip_ativacao'. */
export async function listarTodasConversas(campanha?: Campanha): Promise<Conversa[]> {
  let pagina = 1;
  let coletadas: Conversa[] = [];

  while (true) {
    const { itens, total } = await api.chat.listarConversas({
      page: pagina,
      per_page: PER_PAGE,
      ...(campanha ? { campanha } : {}),
    });
    coletadas = coletadas.concat(itens);
    if (coletadas.length >= total || itens.length === 0) break;
    pagina += 1;
  }

  return coletadas;
}
