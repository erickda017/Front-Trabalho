import type { Cliente } from "@/lib/types";

/**
 * Um cliente com 2+ números de WhatsApp (ver migration-15 no backend) vira
 * várias linhas em `clientes` -- uma por telefone, todas com o mesmo nome e a
 * mesma fatura (PDF/PIX/valor/vencimento são espelhados entre elas). Essa
 * função agrupa essas linhas de volta em uma só por cliente, juntando os
 * telefones num array -- pra telas de listagem mostrarem 1 linha por pessoa.
 */
export type ClienteAgrupado = Cliente & { telefones: string[] };

export function agruparClientesPorNumero(lista: Cliente[]): ClienteAgrupado[] {
  const porId = new Map(lista.map((c) => [c.id, c]));
  const grupos = new Map<string, Cliente[]>();

  for (const c of lista) {
    // Raiz do grupo: se `cliente_principal_id` aponta pra alguém que está
    // nesta mesma lista, agrupa por ele; senão (não vinculado, ou a
    // principal ficou de fora por causa de algum filtro) o próprio id vira
    // a raiz.
    const raiz = c.cliente_principal_id && porId.has(c.cliente_principal_id) ? c.cliente_principal_id : c.id;
    const grupo = grupos.get(raiz);
    if (grupo) grupo.push(c);
    else grupos.set(raiz, [c]);
  }

  return Array.from(grupos.entries()).map(([raiz, membros]) => {
    // Representante: a linha principal (cliente_principal_id nulo) quando
    // presente -- é ela quem carrega a fatura "oficial" do grupo. Sem
    // principal no grupo (raro), usa a primeira linha mesmo. `membros` nunca
    // é vazio (cada grupo nasce com pelo menos 1 elemento no loop acima).
    const representante: Cliente = membros.find((m) => !m.cliente_principal_id) ?? porId.get(raiz) ?? membros[0]!;
    const telefones = Array.from(new Set(membros.map((m) => m.telefone).filter(Boolean)));
    // Disparos recebidos: soma do grupo (cada número é um destino de envio
    // próprio, então "quantos disparos esse cliente já recebeu" é o total
    // somado entre os números, não só o da linha principal).
    const disparos_recebidos = membros.reduce((soma, m) => soma + (m.disparos_recebidos ?? 0), 0);
    // Mesmo raciocínio do total acima: "último envio" do cliente é o mais
    // recente entre TODOS os números do grupo, não só o da linha principal
    // -- um número vinculado pode ter recebido um disparo mais recente do
    // que o principal.
    const ultimoMembro = membros.reduce<typeof representante | null>((maisRecente, m) => {
      if (!m.ultimo_envio_em) return maisRecente;
      if (!maisRecente?.ultimo_envio_em || m.ultimo_envio_em > maisRecente.ultimo_envio_em) return m;
      return maisRecente;
    }, null);
    return {
      ...representante,
      telefones,
      disparos_recebidos,
      ultimo_envio_em: ultimoMembro?.ultimo_envio_em ?? representante.ultimo_envio_em ?? null,
      ultimo_envio_status: ultimoMembro?.ultimo_envio_status ?? representante.ultimo_envio_status ?? null,
    };
  });
}
