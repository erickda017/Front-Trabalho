// [2026-09] GET /chat/conversas é paginado (mesmo motivo/padrão de
// lib/clientesPaginados.ts) -- pagina por baixo dos panos até coletar a
// carteira inteira de conversas, em vez de a tela do Chat assumir que tudo
// cabe numa página só (que caía no default do backend, cortando em silêncio
// quem tivesse mais de 1000 conversas).
import { api } from "@/api";
import type { Conversa } from "@/lib/types";

const PER_PAGE = 5000;

export async function listarTodasConversas(): Promise<Conversa[]> {
  let pagina = 1;
  let coletadas: Conversa[] = [];

  while (true) {
    const { itens, total } = await api.chat.listarConversas({ page: pagina, per_page: PER_PAGE });
    coletadas = coletadas.concat(itens);
    if (coletadas.length >= total || itens.length === 0) break;
    pagina += 1;
  }

  return coletadas;
}
