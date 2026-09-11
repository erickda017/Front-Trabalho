import { createFileRoute, Outlet } from "@tanstack/react-router";

// [2026-09] BUGFIX: layout puro (só <Outlet/>), sem conteúdo próprio.
//
// Antes, este arquivo continha a página inteira da lista de clientes (agora
// em ativacao-chip.index.tsx). Só que o Router de arquivos do TanStack trata
// qualquer rota que comece com "ativacao-chip." como FILHA desta -- incluindo
// ativacao-chip.chat.tsx -- e sem <Outlet/> aqui, a rota filha nunca chega a
// renderizar: o Router monta o componente desta rota (a lista de clientes)
// pra QUALQUER caminho abaixo de /ativacao-chip, inclusive /ativacao-chip/chat.
// Era exatamente esse o bug relatado: abrir o "Chat" do chip mostrava a lista
// de clientes em vez do chat dedicado.
export const Route = createFileRoute("/ativacao-chip")({
  component: () => <Outlet />,
});
