import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusPill } from "@/components/shared/StatusPill";
import { Aviso, Botao } from "@/components/shared/Controls";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAppState } from "@/lib/app-state";
import { api } from "@/api";
import type { EstrategiaEnvio } from "@/lib/types";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Veloce Faturas" },
      {
        name: "description",
        content: "Defina a estratégia de envio e acompanhe o ambiente de integração do painel.",
      },
      { property: "og:title", content: "Configurações — Veloce Faturas" },
      { property: "og:description", content: "Estratégia de envio, conexões ativas e ambiente da aplicação." },
    ],
  }),
  component: Configuracoes,
});

const OPCOES: { valor: EstrategiaEnvio; label: string; slot?: 1 | 2 }[] = [
  { valor: "slot_1", label: "WhatsApp 1", slot: 1 },
  { valor: "slot_2", label: "WhatsApp 2", slot: 2 },
  { valor: "round_robin", label: "Alternância automática" },
  { valor: "qualquer", label: "Qualquer conexão disponível" },
];

function Configuracoes() {
  const { estrategia, estrategiaCarregando, refreshEstrategia, conexoes, supabaseConfigurado } = useAppState();
  const [selecionada, setSelecionada] = useState<EstrategiaEnvio | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valorAtual = selecionada ?? estrategia?.estrategia ?? null;

  async function salvar() {
    if (!valorAtual) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.estrategia.salvar({ estrategia: valorAtual });
      await refreshEstrategia();
      toast.success("Estratégia de envio atualizada");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function slotConfigurado(slot?: 1 | 2) {
    if (!slot) return true;
    return conexoes.find((c) => c.slot === slot)?.configurada ?? false;
  }

  return (
    <AppShell title="Configurações" subtitle="Estratégia de envio e ambiente do painel">
      <div className="flex flex-col gap-6">
        <SectionCard
          titulo="Estratégia de envio"
          eyebrow="Disparo"
          descricao="Escolha como as mensagens devem ser distribuídas entre as conexões disponíveis."
          acoes={
            <Link to="/conexoes" className="text-xs font-medium text-primary hover:underline">
              Ver conexões
            </Link>
          }
        >
          {estrategiaCarregando ? (
            <div className="bg-surface-sunken h-24 animate-pulse rounded" />
          ) : (
            <div className="flex flex-col gap-4">
              <RadioGroup
                value={valorAtual}
                onValueChange={(v) => setSelecionada(v as EstrategiaEnvio)}
                className="gap-2.5"
              >
                {OPCOES.map((o) => {
                  const desabilitado = !slotConfigurado(o.slot);
                  return (
                    <label
                      key={o.valor}
                      className="border-border has-[[data-state=checked]]:border-primary flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm data-[disabled]:opacity-50"
                      data-disabled={desabilitado || undefined}
                    >
                      <RadioGroupItem value={o.valor} disabled={desabilitado} />
                      <span className="flex-1">{o.label}</span>
                      {desabilitado && <span className="text-subtle text-[11px]">não configurado</span>}
                    </label>
                  );
                })}
              </RadioGroup>

              {estrategia?.estrategia === "round_robin" && estrategia.next_slot && (
                <StatusPill tone="brand" className="w-fit">
                  Próximo envio: WhatsApp {estrategia.next_slot}
                </StatusPill>
              )}

              {erro && <Aviso tone="danger">{erro}</Aviso>}

              <div>
                <Botao variante="primary" onClick={salvar} disabled={salvando || !valorAtual}>
                  {salvando ? "Salvando..." : "Salvar estratégia"}
                </Botao>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard titulo="Conexões ativas" eyebrow="Resumo">
          {estrategia?.slots_ativos?.length ? (
            <div className="flex flex-wrap gap-2">
              {estrategia.slots_ativos.map((slot) => (
                <StatusPill key={slot} tone="success" dot>
                  WhatsApp {slot} ativo
                </StatusPill>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">Nenhuma conexão ativa no momento.</p>
          )}
        </SectionCard>

        <SectionCard titulo="Ambiente" eyebrow="Sistema" descricao="Variáveis de ambiente do frontend em uso (somente leitura).">
          <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="border-border rounded-md border px-3 py-2">
              <dt className="text-subtle label-eyebrow">VITE_API_URL</dt>
              <dd className="text-foreground mt-1 font-mono break-all">
                {import.meta.env['VITE_API_URL'] || "não definida (usando padrão local)"}
              </dd>
            </div>
            <div className="border-border rounded-md border px-3 py-2">
              <dt className="text-subtle label-eyebrow">Supabase</dt>
              <dd className="text-foreground mt-1">
                {supabaseConfigurado ? "Configurado" : "Não configurado"}
              </dd>
            </div>
          </dl>
        </SectionCard>
      </div>
    </AppShell>
  );
}
