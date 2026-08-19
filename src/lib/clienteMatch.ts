// Casa um arquivo PDF (pelo nome) com um cliente já existente no banco --
// usado pelo Extrator de PIX (/pix) pra associar automaticamente o Pix E o
// PDF ao cliente certo, sem exigir vínculo manual quando o nome do arquivo já
// identifica quem é. 100% no navegador (só compara texto contra a lista de
// clientes já carregada em memória) -- não bate no backend pra isso.
import type { Cliente } from "@/lib/types";

function normalizarTexto(str: string | null | undefined): string {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizarNomeArquivo(nomeArquivo: string): string {
  return normalizarTexto(nomeArquivo)
    .replace(/\.pdf$/i, "")
    // hífen/underscore tratados como espaço -- "joao_silva.pdf" deve casar
    // com o cliente "João Silva" mesmo com separador diferente.
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Estratégia: 1) nome do arquivo bate exatamente com o nome do cliente;
// 2) por fallback, um "contém" o outro (cobre arquivo com sufixo/prefixo
// extra, tipo "joao_silva_fatura_agosto.pdf" ou nome de cliente abreviado).
// Mesmo critério usado no backend (boletos.routes.js/resolverCliente), só
// que aqui roda no navegador com a lista de clientes já em memória -- evita
// depender de round-trip ao servidor pra cada arquivo do lote.
export function casarClientePorArquivo(nomeArquivo: string, clientes: Cliente[]): Cliente | null {
  const alvo = normalizarNomeArquivo(nomeArquivo);
  if (!alvo) return null;

  const exato = clientes.find((c) => normalizarTexto(c.nome) === alvo);
  if (exato) return exato;

  const parcial = clientes.find((c) => {
    const nomeCliente = normalizarTexto(c.nome);
    return nomeCliente.length >= 3 && (alvo.includes(nomeCliente) || nomeCliente.includes(alvo));
  });
  return parcial ?? null;
}
