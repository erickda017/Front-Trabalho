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
  Wallet,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ptBR } from "date-fns/locale";
import { formatDistanceToNow } from "date-fns";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell, statusConexao } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { MetricCard } from "@/components/shared/MetricCard";
import { StatusPill } from "@/components/shared/StatusPill";
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
        content: "Visão geral da conexão e dos indicadores de disparo de faturas.",
      },
      { property: "og:title", content: "Painel — Veloce Faturas" },
      { property: "og:description", content: "Indicadores de disparo e status da conexão do WhatsApp." },
    ],
  }),
  component: Dashboard,
});

function formatarData(iso: string | null) {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "—";
  }
}

const formatoMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatarDiaCurto(data: string) {
  // "data" vem como YYYY-MM-DD (ver backend/src/routes/dashboard.routes.js)
  const [, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

function Dashboard() {
  const { conexao } = useAppState();
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

        {/* [2026-08] "Dashboard: média dos valores das faturas e dados mais
            dinâmicos" -- valor médio/total (calculado no backend, ver
            dashboard.routes.js:resumoValores) + gráfico de disparos por dia. */}
        <SectionCard titulo="Faturas em valor" eyebrow="Financeiro">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard
              label="Valor médio por fatura"
              valor={erro ? null : carregando ? null : resumo?.valor_medio !== undefined ? formatoMoeda.format(resumo.valor_medio) : "—"}
              carregando={carregando}
              icon={Wallet}
              destaque
            />
            <MetricCard
              label="Valor total das faturas"
              valor={erro ? null : carregando ? null : resumo?.valor_total !== undefined ? formatoMoeda.format(resumo.valor_total) : "—"}
              carregando={carregando}
              icon={Wallet}
            />
            <MetricCard
              label="Faturas com valor cadastrado"
              valor={erro ? null : resumo?.faturas_com_valor}
              carregando={carregando}
              icon={Gauge}
            />
          </div>
        </SectionCard>

        <SectionCard titulo="Disparos por dia" eyebrow="Últimos 7 dias">
          {carregando ? (
            <div className="bg-surface-sunken h-48 w-full animate-pulse rounded-md" />
          ) : resumo?.serie_disparos_7dias?.length ? (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={resumo.serie_disparos_7dias}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis
                    dataKey="data"
                    tickFormatter={formatarDiaCurto}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip
                    labelFormatter={(v) => formatarDiaCurto(String(v))}
                    formatter={(v: number) => [v, "Disparos"]}
                    cursor={{ fill: "var(--color-muted)" }}
                    contentStyle={{
                      backgroundColor: "var(--color-popover)",
                      color: "var(--color-popover-foreground)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      boxShadow: "var(--shadow-raised)",
                      fontSize: "0.75rem",
                    }}
                    labelStyle={{ color: "var(--color-muted-foreground)" }}
                    itemStyle={{ color: "var(--color-popover-foreground)" }}
                  />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]} fill="var(--color-primary)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-subtle py-8 text-center text-xs">Nenhum disparo enviado nos últimos 7 dias.</p>
          )}
        </SectionCard>

        <SectionCard
          titulo="Status do WhatsApp"
          eyebrow="Conexão"
          acoes={
            <Link to="/conexoes" className="text-xs font-medium text-primary hover:underline">
              Gerenciar conexão
            </Link>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!conexao.configurada ? (
              <div className="panel-sunken flex flex-col items-center justify-center gap-2 rounded-md p-6 text-center">
                <Smartphone className="text-subtle size-5" />
                <p className="text-sm font-medium text-foreground">WhatsApp não configurado</p>
                <Link to="/conexoes" className="text-xs font-medium text-primary hover:underline">
                  Configurar agora
                </Link>
              </div>
            ) : (
              (() => {
                const info = statusConexao[conexao.status] ?? statusConexao['disconnected']!;
                return (
                  <div className="panel flex flex-col gap-2 rounded-md p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">WhatsApp</p>
                      <StatusPill tone={info.tone} dot pulse={conexao.status === "connected"}>
                        {info.label}
                      </StatusPill>
                    </div>
                    <div className="text-muted-foreground grid gap-1 text-xs">
                      <span>Número: {conexao.telefone ?? "—"}</span>
                      <span>Nome: {conexao.nome ?? "—"}</span>
                      <span>Última conexão: {formatarData(conexao.ultima_conexao)}</span>
                      <span>Mensagens enviadas: {conexao.mensagens_enviadas ?? "—"}</span>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
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
