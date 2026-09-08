// [2026-09] GET /clientes é paginado (ver api.d.ts) -- essa função existe
// porque a maior parte do app (tela Clientes, busca do Extrator de PIX,
// carga inicial em app-state.tsx) segue a filosofia documentada no
// CONTEXTO.md de carregar a carteira INTEIRA e filtrar em memória, não de
// paginar de verdade na tela. Antes, um `api.clientes.listar()` sem paginar
// caía no default do backend (1000) e cortava a lista em silêncio pra quem
// tivesse mais clientes que isso -- sem nenhum sinal do corte, afetando
// filtro/contagem/"selecionar todos"/dashboard. Aqui pagina por baixo dos
// panos, usando o `per_page` máximo do backend (5000), até coletar tudo.
import { api } from "@/api";
import type { Cliente } from "@/lib/types";

const PER_PAGE = 5000;

export async function listarTodosClientes(
  params?: Parameters<typeof api.clientes.listar>[0],
): Promise<Cliente[]> {
  let pagina = 1;
  let coletados: Cliente[] = [];

  while (true) {
    const { itens, total } = await api.clientes.listar({ ...params, page: pagina, per_page: PER_PAGE });
    coletados = coletados.concat(itens);
    // `itens.length === 0` corta um loop infinito se `total` vier
    // inconsistente por qualquer motivo (defensivo, não deveria acontecer).
    if (coletados.length >= total || itens.length === 0) break;
    pagina += 1;
  }

  return coletados;
}
