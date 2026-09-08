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

// Acha TODOS os clientes cujo nome bate (exato tem prioridade sobre parcial
// -- se há qualquer exato, só eles contam) com `alvoNormalizado`. [2026-09]
// Devolve a lista inteira (pode ter mais de 1 -- duas pessoas diferentes com
// o mesmo nome é uma situação real, não bug) em vez de já escolher uma;
// `casarClientePorNome`/`casarClientePorArquivo` abaixo é quem decide, e
// agora tratam mais de 1 candidato como "não dá pra saber qual" em vez de
// pegar o primeiro do array -- pegar o primeiro arbitrariamente era o bug
// real (risco de casar o Pix/PDF com o cliente errado quando 2 tinham nome
// igual/parecido).
function encontrarClientesPorNome<C extends { nome: string }>(alvoNormalizado: string, clientes: C[]): C[] {
  if (!alvoNormalizado) return [];

  const exatos = clientes.filter((c) => normalizarTexto(c.nome) === alvoNormalizado);
  if (exatos.length) return exatos;

  return clientes.filter((c) => {
    const nomeCliente = normalizarTexto(c.nome);
    return nomeCliente.length >= 3 && (alvoNormalizado.includes(nomeCliente) || nomeCliente.includes(alvoNormalizado));
  });
}

// Mesma ideia de `casarClientePorArquivo`, mas comparando direto um nome de
// texto (ex.: célula "CLIENTE" de uma planilha) em vez de um nome de
// arquivo -- usado pela função de planilha de PIX do Supervisor.
export function casarClientePorNome<C extends { nome: string }>(nome: string, clientes: C[]): C | null {
  const alvo = normalizarTexto(nome).replace(/\s+/g, " ").trim();
  const candidatos = encontrarClientesPorNome(alvo, clientes);
  return candidatos.length === 1 ? candidatos[0]! : null;
}

// Estratégia: 1) nome do arquivo bate exatamente com o nome do cliente;
// 2) por fallback, um "contém" o outro (cobre arquivo com sufixo/prefixo
// extra, tipo "joao_silva_fatura_agosto.pdf" ou nome de cliente abreviado).
// Mesmo critério usado no backend (lib/nomeMatch.js, `casarCliente`), só que
// aqui roda no navegador com a lista de clientes já em memória -- evita
// depender de round-trip ao servidor pra cada arquivo do lote.
export function casarClientePorArquivo(nomeArquivo: string, clientes: Cliente[]): Cliente | null {
  const alvo = normalizarNomeArquivo(nomeArquivo);
  const candidatos = encontrarClientesPorNome(alvo, clientes);
  return candidatos.length === 1 ? candidatos[0]! : null;
}
