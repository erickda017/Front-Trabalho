import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCheck,
  Eye,
  Gauge,
  History,
  KeyRound,
  Send,
  Smartphone,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ptBR } from "date-fns/locale";
import { formatDistanceToNow } from "date-fns";

import { AppShell, statusConexao } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { MetricCard } from "@/components/shared/MetricCard";
import { StatusPill } from "@/components/shared/StatusPill";
import { EmptyState } from "@/components/shared/EmptyState";
import { Aviso, Botao } from "@/components/shared/Controls";
import { useAppState } from "@/lib/app-state";
import { api } from "@/api";
import type { DashboardResumo } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Painel — Veloce Faturas" },
      {
        name: "description",
        content: "Visão geral das conexões, estratégia de envio e indicadores de disparo de faturas.",
      },
      { property: "og:title", content: "Painel — Veloce Faturas" },
      { property: "og:description", content: "Indicadores de disparo, status das conexões e estratégia de envio." },
    ],
  }),
  component: Dashboard,
});

const ESTRATEGIA_LABEL: Record<string, string> = {
  slot_1: "WhatsApp 1 fixo",
  slot_2: "WhatsApp 2 fixo",
  round_robin: "Alternância automática",
  qualquer: "Qualquer conexão disponível",
};

function formatarData(iso: string | null) {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "—";
  }
}

function Dashboard() {
  const { conexoes, estrategia, estrategiaCarregando } = useAppState();
  const [resumo, setResumo] = useState<DashboardResumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const data = await api.dashboard.resumo();
      setResumo(data);
    } catch (e) {
      setResumo(null);
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const metrics: { label: string; valor: number | null | undefined; icon: any }[] = [
    { label: "Clientes", valor: resumo?.clientes, icon: Users },
    { label: "Faturas", valor: resumo?.faturas, icon: Gauge },
    { label: "Disparos hoje", valor: resumo?.disparos_hoje, icon: Send },
    { label: "Enviados", valor: resumo?.enviados, icon: CheckCheck },
    { label: "Entregues", valor: resumo?.entregues, icon: CheckCheck },
    { label: "Lidos", valor: resumo?.lidos, icon: Eye },
    { label: "Falhas", valor: resumo?.falhas, icon: XCircle },
    { label: "Números inválidos", valor: resumo?.numeros_invalidos, icon: AlertTriangle },
    { label: "Pendentes", valor: resumo?.pendentes, icon: History },
  ];

  return (
    <AppShell title="Painel" subtitle="Visão geral da operação de disparo">
      <div className="flex flex-col gap-6">
        {erro && (
          <Aviso tone="danger" className="flex flex-wrap items-center justify-between gap-2">
            <span>Não foi possível carregar os indicadores: {erro}</span>
            <Botao tamanho="sm" variante="outline" onClick={carregar}>
              Tentar novamente
            </Botao>
          </Aviso>
        )}

        <SectionCard titulo="Indicadores" eyebrow="Hoje">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map((m) => (
              <MetricCard
                key={m.label}
                label={m.label}
                valor={erro ? null : m.valor ?? null}
                carregando={carregando}
                icon={m.icon}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard
          titulo="Status dos WhatsApps"
          eyebrow="Conexões"
          acoes={
            <Link to="/conexoes" className="text-xs font-medium text-primary hover:underline">
              Gerenciar conexões
            </Link>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {conexoes.map((c) => {
              if (!c.configurada) {
                return (
                  <div key={c.slot} className="panel-sunken flex flex-col items-center justify-center gap-2 rounded-md p-6 text-center">
                    <Smartphone className="text-subtle size-5" />
                    <p className="text-sm font-medium text-foreground">WhatsApp {c.slot} não configurado</p>
                    <Link to="/conexoes" className="text-xs font-medium text-primary hover:underline">
                      Configurar agora
                    </Link>
                  </div>
                );
              }
              const info = statusConexao[c.status] ?? statusConexao['disconnected']!;
              return (
                <div key={c.slot} className="panel flex flex-col gap-2 rounded-md p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">WhatsApp {c.slot}</p>
                    <StatusPill tone={info.tone} dot pulse={c.status === "connected"}>
                      {info.label}
                    </StatusPill>
                  </div>
                  <div className="text-muted-foreground grid gap-1 text-xs">
                    <span>Número: {c.telefone ?? "—"}</span>
                    <span>Nome: {c.nome ?? "—"}</span>
                    <span>Última conexão: {formatarData(c.ultima_conexao)}</span>
                    <span>Mensagens enviadas: {c.mensagens_enviadas ?? "—"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          titulo="Estratégia de envio"
          eyebrow="Configuração"
          acoes={
            <Link to="/configuracoes" className="text-xs font-medium text-primary hover:underline">
              Ajustar estratégia
            </Link>
          }
        >
          {estrategiaCarregando ? (
            <div className="bg-surface-sunken h-10 w-64 animate-pulse rounded" />
          ) : estrategia ? (
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone="brand">{ESTRATEGIA_LABEL[estrategia.estrategia] ?? estrategia.estrategia}</StatusPill>
              {estrategia.estrategia === "round_robin" && estrategia.next_slot && (
                <span className="text-muted-foreground text-xs">
                  Próximo envio: WhatsApp {estrategia.next_slot}
                </span>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Gauge}
              titulo="Aguardando integração"
              descricao="Ainda não foi possível carregar a estratégia de envio configurada."
              compacto
            />
          )}
        </SectionCard>

        <SectionCard titulo="Atalhos" eyebrow="Navegação">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { to: "/disparos", label: "Disparos", icon: Send },
              { to: "/importar", label: "Importar", icon: Upload },
              { to: "/pix", label: "Extrator de PIX", icon: KeyRound },
              { to: "/historico", label: "Histórico", icon: History },
            ].map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="border-border hover:bg-surface-raised flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors"
              >
                <span className="flex items-center gap-2">
                  <a.icon className="text-subtle size-4" />
                  {a.label}
                </span>
                <ArrowRight className="text-subtle size-3.5" />
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
