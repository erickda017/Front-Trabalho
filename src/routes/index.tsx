import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCheck,
  Eye,
  Gauge,
  History,
  KeyRound,
  Layers,
  PiggyBank,
  Send,
  Smartphone,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell, statusConexao } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { MetricCard } from "@/components/shared/MetricCard";
import { StatusPill } from "@/components/shared/StatusPill";
import { Aviso, Botao } from "@/components/shared/Controls";
import { useAppState } from "@/lib/app-state";
import { api } from "@/api";
import { formatoMoeda } from "@/lib/utils";
import { formatarDataRelativa, formatarDiaCurto } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Painel — Voxcel Faturas" },
      {
        name: "description",
        content: "Visão geral da conexão e dos indicadores de disparo de faturas.",
      },
      { property: "og:title", content: "Painel — Voxcel Faturas" },
      {
        property: "og:description",
        content: "Indicadores de disparo e status da conexão do WhatsApp.",
      },
    ],
  }),
  component: Dashboard,
});

const formatarData = formatarDataRelativa;

const formatoPercentual = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** "2026-09" -> "Set/2026" (rótulo curto, cabe no eixo do gráfico). */
function rotuloSafraCurto(safra: string) {
  const [ano, mes] = safra.split("-").map(Number);
  const MESES = [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ];
  return `${MESES[(mes ?? 1) - 1] ?? mes}/${ano}`;
}

function Dashboard() {
  const { conexao } = useAppState();

  // [perf] useQuery (react-query) em vez de useEffect+useState manual -- o
  // resultado fica em cache por `queryKey`, então trocar de aba e voltar pra
  // cá mostra os dados na hora (sem loading) em vez de refazer o fetch do
  // zero toda vez. `staleTime` evita refetch imediato ao revisitar a tela
  // dentro da janela; passado isso, refaz em segundo plano sem esconder o
  // dado já exibido (`isLoading` só é true na 1ª carga, sem cache nenhum).
  const {
    data: resumo,
    isLoading: carregando,
    error: erroResumo,
    refetch: carregar,
  } = useQuery({
    queryKey: ["dashboard-resumo"],
    queryFn: () => api.dashboard.resumo(),
    staleTime: 30_000,
  });
  const erro = erroResumo ? (erroResumo as Error).message : null;

  // [2026-08] Painel de safras no dashboard -- reusa o mesmo endpoint da
  // tela /safras (GET /api/safras), sem duplicar lógica de cálculo no
  // backend. Erro aqui não bloqueia o resto do painel (fetch independente).
  const {
    data: safras,
    isLoading: safrasCarregando,
    error: erroSafras,
    refetch: carregarSafras,
  } = useQuery({
    queryKey: ["safras-lista"],
    queryFn: async () => {
      const data = await api.safras.listar();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 30_000,
  });
  const safrasErro = erroSafras ? (erroSafras as Error).message : null;

  // Só as safras ainda AO VIVO (arquivada=false) entram no painel do
  // dashboard -- é o acompanhamento "do momento"; o histórico consolidado já
  // tem tela própria (/safras). Ordenada do mais antigo pro mais recente
  // (esquerda->direita no gráfico lê como linha do tempo), até 6 pra não
  // espremer o eixo.
  const safrasAtivas = useMemo(() => {
    if (!safras) return [];
    return safras
      .filter((s) => !s.arquivada)
      .sort((a, b) => (a.safra < b.safra ? -1 : 1))
      .slice(-6);
  }, [safras]);

  const safrasResumo = useMemo(() => {
    const totalClientes = safrasAtivas.reduce((soma, s) => soma + s.total_clientes, 0);
    const totalPagos = safrasAtivas.reduce((soma, s) => soma + s.pagos, 0);
    const valorEmAberto = safrasAtivas.reduce((soma, s) => soma + (s.valor_em_aberto ?? 0), 0);
    const valorTotal = safrasAtivas.reduce((soma, s) => soma + s.valor_total, 0);
    return {
      totalSafras: safrasAtivas.length,
      totalClientes,
      totalPagos,
      taxaPagamento: totalClientes > 0 ? (totalPagos / totalClientes) * 100 : null,
      valorEmAberto,
      valorTotal,
    };
  }, [safrasAtivas]);

  // "Médias úteis" de desempenho de entrega -- calculadas em cima dos mesmos
  // contadores que já vêm em `resumo` (nenhuma chamada nova), só como
  // proporção em vez de total bruto. `enviados` é a base (quem foi
  // efetivamente enviado), não `disparos_hoje` nem o total de itens --
  // entregues/lidos já são subconjuntos de enviados no backend (ver
  // dashboard.routes.js).
  const taxas = useMemo(() => {
    const enviados = resumo?.enviados ?? 0;
    if (!enviados) return { entrega: null, leitura: null, falha: null };
    const falhas = resumo?.falhas ?? 0;
    return {
      entrega: ((resumo?.entregues ?? 0) / enviados) * 100,
      leitura: ((resumo?.lidos ?? 0) / enviados) * 100,
      falha: (falhas / (enviados + falhas)) * 100,
    };
  }, [resumo]);

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
            <Botao tamanho="sm" variante="outline" onClick={() => carregar()}>
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
                valor={erro ? null : (m.valor ?? null)}
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
              valor={
                erro
                  ? null
                  : carregando
                    ? null
                    : resumo?.valor_medio !== undefined
                      ? formatoMoeda.format(resumo.valor_medio)
                      : "—"
              }
              carregando={carregando}
              icon={Wallet}
              destaque
            />
            <MetricCard
              label="Valor total das faturas"
              valor={
                erro
                  ? null
                  : carregando
                    ? null
                    : resumo?.valor_total !== undefined
                      ? formatoMoeda.format(resumo.valor_total)
                      : "—"
              }
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

        {/* [2026-08] "Médias úteis" pedidas pro dashboard -- taxas de
            entrega/leitura/falha, derivadas dos mesmos contadores de
            `resumo` (sem chamada nova ao backend). */}
        <SectionCard titulo="Desempenho de entrega" eyebrow="Taxas">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard
              label="Taxa de entrega"
              valor={
                erro
                  ? null
                  : carregando
                    ? null
                    : taxas.entrega !== null
                      ? `${formatoPercentual.format(taxas.entrega)}%`
                      : "—"
              }
              carregando={carregando}
              icon={CheckCheck}
              hint={
                !carregando && resumo?.enviados
                  ? `${resumo.entregues} de ${resumo.enviados} enviados`
                  : undefined
              }
              destaque
            />
            <MetricCard
              label="Taxa de leitura"
              valor={
                erro
                  ? null
                  : carregando
                    ? null
                    : taxas.leitura !== null
                      ? `${formatoPercentual.format(taxas.leitura)}%`
                      : "—"
              }
              carregando={carregando}
              icon={Eye}
              hint={
                !carregando && resumo?.enviados
                  ? `${resumo.lidos} de ${resumo.enviados} enviados`
                  : undefined
              }
            />
            <MetricCard
              label="Taxa de falha"
              valor={
                erro
                  ? null
                  : carregando
                    ? null
                    : taxas.falha !== null
                      ? `${formatoPercentual.format(taxas.falha)}%`
                      : "—"
              }
              carregando={carregando}
              icon={AlertTriangle}
              hint={!carregando && resumo?.falhas ? `${resumo.falhas} falha(s)` : undefined}
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
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
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
            <p className="text-subtle py-8 text-center text-xs">
              Nenhum disparo enviado nos últimos 7 dias.
            </p>
          )}
        </SectionCard>

        {/* [2026-08] Painel de safras no dashboard -- distribuição FPD/SPD,
            taxa de recuperação (pagos/total) e valor em aberto por safra
            ativa. Mesmo dado de /safras (GET /api/safras), resumido aqui. */}
        <SectionCard
          titulo="Safras"
          eyebrow="Acompanhamento"
          acoes={
            <Link to="/safras" className="text-xs font-medium text-primary hover:underline">
              Ver todas as safras
            </Link>
          }
        >
          {safrasErro ? (
            <Aviso tone="danger" className="flex flex-wrap items-center justify-between gap-2">
              <span>Não foi possível carregar as safras: {safrasErro}</span>
              <Botao tamanho="sm" variante="outline" onClick={() => carregarSafras()}>
                Tentar novamente
              </Botao>
            </Aviso>
          ) : !safrasCarregando && safrasAtivas.length === 0 ? (
            <p className="text-subtle py-8 text-center text-xs">
              Nenhuma safra ativa no momento — importe clientes pela lista crua (Fatura 1/2 + prazo)
              em Importar.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard
                  label="Safras ativas"
                  valor={safrasCarregando ? null : safrasResumo.totalSafras}
                  carregando={safrasCarregando}
                  icon={Layers}
                />
                <MetricCard
                  label="Clientes em acompanhamento"
                  valor={safrasCarregando ? null : safrasResumo.totalClientes}
                  carregando={safrasCarregando}
                  icon={Users}
                />
                <MetricCard
                  label="Taxa de pagamento"
                  valor={
                    safrasCarregando
                      ? null
                      : safrasResumo.taxaPagamento !== null
                        ? `${formatoPercentual.format(safrasResumo.taxaPagamento)}%`
                        : "—"
                  }
                  carregando={safrasCarregando}
                  icon={TrendingUp}
                  hint={
                    !safrasCarregando
                      ? `${safrasResumo.totalPagos} de ${safrasResumo.totalClientes} pagos`
                      : undefined
                  }
                  destaque
                />
                <MetricCard
                  label="Valor em aberto"
                  valor={safrasCarregando ? null : formatoMoeda.format(safrasResumo.valorEmAberto)}
                  carregando={safrasCarregando}
                  icon={PiggyBank}
                  hint={
                    !safrasCarregando
                      ? `de ${formatoMoeda.format(safrasResumo.valorTotal)} no total`
                      : undefined
                  }
                />
              </div>

              {safrasCarregando ? (
                <div className="bg-surface-sunken h-48 w-full animate-pulse rounded-md" />
              ) : (
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={safrasAtivas.map((s) => ({
                        ...s,
                        rotuloCurto: rotuloSafraCurto(s.safra),
                      }))}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        className="stroke-border"
                      />
                      <XAxis
                        dataKey="rotuloCurto"
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={28}
                      />
                      <Tooltip
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
                      <Legend
                        wrapperStyle={{ fontSize: "0.75rem" }}
                        formatter={(value) => (value === "pagos" ? "Pagos" : "Não pagos")}
                      />
                      <Bar
                        dataKey="pagos"
                        stackId="safra"
                        fill="var(--color-success)"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="nao_pagos"
                        stackId="safra"
                        fill="var(--color-warning)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="divide-border divide-y">
                {safrasAtivas
                  .slice()
                  .reverse()
                  .map((s) => {
                    const taxa = s.total_clientes > 0 ? (s.pagos / s.total_clientes) * 100 : 0;
                    return (
                      <Link
                        key={s.safra}
                        to="/clientes"
                        search={{ safra: s.safra }}
                        className="hover:bg-surface-raised/60 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-md px-1 py-2.5 text-sm transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{s.rotulo}</p>
                          <p className="text-subtle text-xs">
                            {s.total_fpd} FPD · {s.total_spd} SPD
                            {s.sem_tipo_fatura > 0 && ` · ${s.sem_tipo_fatura} sem tipo`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-subtle text-xs tabular-nums">
                            {formatoMoeda.format(s.valor_total)}
                          </span>
                          <StatusPill
                            tone={taxa >= 50 ? "success" : taxa > 0 ? "warning" : "muted"}
                            dot
                          >
                            {formatoPercentual.format(taxa)}% pago
                          </StatusPill>
                        </div>
                      </Link>
                    );
                  })}
              </div>
            </div>
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
                const info = statusConexao[conexao.status] ?? statusConexao["disconnected"]!;
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
              { to: "/safras", label: "Safras", icon: Layers },
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
