import { createFileRoute, redirect } from "@tanstack/react-router";

// [layout] "Faturas" foi unificada em /clientes -- mesma base de clientes,
// agora com filtro de data/valor+ordenação e upload de PDF avulso que só
// existiam nesta tela (ver src/routes/clientes.tsx e o AppShell, que já não
// lista mais "Faturas" no menu). Mantido como redirect, não removido, pra
// não quebrar um link/favorito antigo de quem tinha essa URL salva.
export const Route = createFileRoute("/faturas")({
  beforeLoad: () => {
    throw redirect({ to: "/clientes" });
  },
});
