import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { MetricCard } from "@/components/shared/MetricCard";
import {
  Aviso,
  Botao,
  Busca,
  LinhasEsqueleto,
  Paginacao,
  Seletor,
  TabelaWrap,
} from "@/components/shared/Controls";
import { StatusPill } from "@/components/shared/StatusPill";
import { api } from "@/api";
import { PainelExclusao } from "@/components/supervisor/PainelExclusao";
import { VisualizadorPdf } from "@/components/shared/VisualizadorPdf";
import { extrairPixLocal } from "@/lib/pixExtractor";
import { casarClientePorNome } from "@/lib/clienteMatch";
import {
  adicionarExtracaoPessoal,
  expiraEmMs,
  limparExtracoesPessoais,
  listarExtracoesPessoais,
  removerExtracaoPessoal,
  type ItemExtraidoPessoal,
} from "@/lib/extratorPessoal";
import { cn, formatoMoeda } from "@/lib/utils";
import { formatarDataHoraAbsoluta, formatarDiaCurto } from "@/lib/format";
import type {
  Operador,
  ClienteSup,
  FaturaSup,
  DisparoSup,
  ResumoOperador,
  SerieDia,
  DashboardSupervisor,
  IndicePixItem,
} from "@/lib/types";

export const Route = createFileRoute("/supervisor")({
  head: () => ({
    meta: [
      { title: "Supervisor — Voxcel Faturas" },
      {
        name: "description",
        content:
          "Visão geral de todos os operadores: clientes, faturas, disparos e ferramentas de PIX.",
      },
    ],
  }),
  component: Supervisor,
});

const ABAS = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "faturas", label: "Faturas", icon: FileText },
  { id: "disparos", label: "Disparos", icon: KeyRound },
  { id: "planilha", label: "Planilha de PIX", icon: FileSpreadsheet },
  { id: "extrator", label: "Extrator pessoal", icon: ShieldCheck },
  // [2026-09] Ver docs/superpowers/specs/2026-09-10-painel-exclusao-design.md
  { id: "exclusao", label: "Exclusão", icon: Trash2 },
] as const;
type AbaId = (typeof ABAS)[number]["id"];

function nomeOperador(op: Operador | null) {
  return op?.nome || op?.email || "—";
}

const formatarData = formatarDataHoraAbsoluta;

function formatarValor(v: string | null) {
  if (!v) return "—";
  const n = Number(v);
  return Number.isNaN(n) ? v : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Supervisor() {
  const [aba, setAba] = useState<AbaId>("dashboard");
  const [operadores, setOperadores] = useState<Operador[]>([]);

  useEffect(() => {
    api.supervisor
      .operadores()
      .then((data) =>
        setOperadores(
          Array.isArray(data)
            ? data.map((o: any) => ({ id: o.id, email: o.email, nome: o.nome }))
            : [],
        ),
      )
      .catch(() => {});
  }, []);

  return (
    <AppShell
      title="Supervisor"
      subtitle="Visão de todos os operadores: clientes, faturas, disparos e ferramentas de PIX"
    >
      <div className="border-border mb-6 flex gap-1 overflow-x-auto border-b">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={cn(
              "focus-ring flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              aba === a.id
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            <a.icon className="size-4" />
            {a.label}
          </button>
        ))}
      </div>

      {aba === "dashboard" && <AbaDashboard />}
      {aba === "clientes" && <AbaClientes operadores={operadores} />}
      {aba === "faturas" && <AbaFaturas operadores={operadores} />}
      {aba === "disparos" && <AbaDisparos operadores={operadores} />}
      {aba === "planilha" && <AbaPlanilha />}
      {aba === "extrator" && <AbaExtratorPessoal />}
      {aba === "exclusao" && <PainelExclusao />}
    </AppShell>
  );
}

// [2026-08] Erro de carregamento de uma tabela (Clientes/Faturas/Disparos do
// Supervisor) -- mesmo bloco "Aviso + Tentar novamente" era copy-paste
// idêntico nos 3 lugares.
function ErroCarregamento({ erro, onRetry }: { erro: string; onRetry: () => void }) {
  return (
    <div className="p-5">
      <Aviso tone="danger">
        {erro}
        <button onClick={onRetry} className="ml-3 font-medium underline">
          Tentar novamente
        </button>
      </Aviso>
    </div>
  );
}

function AbaDashboard() {
  // [perf] useQuery em vez de useEffect+useState -- cacheia entre trocas de
  // aba (voltar pro Supervisor não recarrega do zero).
  const {
    data: dados,
    isLoading: carregando,
    error: erroObj,
    refetch: carregar,
  } = useQuery({
    queryKey: ["supervisor-dashboard"],
    queryFn: () => api.supervisor.dashboard(),
    staleTime: 30_000,
  });
  const erro = erroObj ? (erroObj as Error).message : null;

  if (erro) {
    return (
      <Aviso tone="danger" className="flex flex-wrap items-center justify-between gap-2">
        <span>Não foi possível carregar os indicadores: {erro}</span>
        <Botao tamanho="sm" variante="outline" onClick={() => carregar()}>
          Tentar novamente
        </Botao>
      </Aviso>
    );
  }

  const totais = dados?.totais;
  const metrics: { label: string; valor: number | null | undefined; icon: LucideIcon }[] = [
    { label: "Operadores", valor: totais?.operadores, icon: Users },
    { label: "Clientes", valor: totais?.clientes, icon: Users },
    { label: "Com PIX", valor: totais?.com_pix, icon: KeyRound },
    { label: "Disparos em andamento", valor: totais?.disparos_em_andamento, icon: BarChart3 },
    { label: "Disparos concluídos", valor: totais?.disparos_concluidos, icon: Check },
    { label: "Enviados", valor: totais?.enviados, icon: Check },
    { label: "Falhas", valor: totais?.falhas, icon: XCircle },
    { label: "Pendentes", valor: totais?.pendentes, icon: Loader2 },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map((m) => (
          <MetricCard
            key={m.label}
            label={m.label}
            valor={carregando ? null : (m.valor ?? null)}
            carregando={carregando}
            icon={m.icon}
          />
        ))}
      </div>

      {/* Mesmo bloco "Faturas em valor" que já existe no Painel do operador
          (ver routes/index.tsx), agora agregado de todos os operadores. */}
      <SectionCard titulo="Faturas em valor" eyebrow="Financeiro (todos os operadores)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Valor médio por fatura"
            valor={
              carregando
                ? null
                : totais?.valor_medio !== undefined
                  ? formatoMoeda.format(totais.valor_medio)
                  : "—"
            }
            carregando={carregando}
            icon={Wallet}
            destaque
          />
          <MetricCard
            label="Valor total das faturas"
            valor={
              carregando
                ? null
                : totais?.valor_total !== undefined
                  ? formatoMoeda.format(totais.valor_total)
                  : "—"
            }
            carregando={carregando}
            icon={Wallet}
          />
          <MetricCard
            label="Faturas com valor cadastrado"
            valor={carregando ? null : totais?.faturas_com_valor}
            carregando={carregando}
            icon={FileText}
          />
        </div>
      </SectionCard>

      <SectionCard titulo="Disparos por dia" eyebrow="Últimos 7 dias · todos os operadores">
        {carregando ? (
          <div className="bg-surface-sunken h-48 w-full animate-pulse rounded-md" />
        ) : dados?.serie_disparos_7dias?.length ? (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dados.serie_disparos_7dias}>
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

      <SectionCard
        titulo="Por operador"
        descricao="Carteira e disparos de cada operador."
        flush
        bodyClassName="p-0"
      >
        {!carregando && !dados?.por_operador.length ? (
          <EmptyState icon={Users} titulo="Nenhum operador logou ainda" compacto />
        ) : (
          <TabelaWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-subtle border-b text-left text-xs uppercase">
                  <th className="px-4 py-2.5">Operador</th>
                  <th className="px-4 py-2.5">Clientes</th>
                  <th className="px-4 py-2.5">Com PDF</th>
                  <th className="px-4 py-2.5">Com PIX</th>
                  <th className="px-4 py-2.5">Em andamento</th>
                  <th className="px-4 py-2.5">Concluídos</th>
                  <th className="px-4 py-2.5">Entregues / lidos</th>
                  <th className="px-4 py-2.5">Falhas</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {carregando ? (
                  <LinhasEsqueleto colunas={8} linhas={4} />
                ) : (
                  (dados?.por_operador ?? []).map((op) => (
                    <tr key={op.operador.id}>
                      <td className="px-4 py-2.5 font-medium">{nomeOperador(op.operador)}</td>
                      <td className="px-4 py-2.5">{op.total_clientes}</td>
                      <td className="px-4 py-2.5">{op.com_pdf}</td>
                      <td className="px-4 py-2.5">{op.com_pix}</td>
                      <td className="px-4 py-2.5">{op.disparos_em_andamento}</td>
                      <td className="px-4 py-2.5">{op.disparos_concluidos}</td>
                      <td className="px-4 py-2.5">
                        {op.entregues} / {op.lidos}
                      </td>
                      <td className="px-4 py-2.5">
                        {op.falhas > 0 ? (
                          <span className="text-destructive">{op.falhas}</span>
                        ) : (
                          "0"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TabelaWrap>
        )}
      </SectionCard>
    </div>
  );
}

function SeletorOperador({
  operadores,
  valor,
  onChange,
}: {
  operadores: Operador[];
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <Seletor value={valor} onChange={(e) => onChange(e.target.value)} className="max-w-[220px]">
      <option value="">Todos os operadores</option>
      {operadores.map((o) => (
        <option key={o.id} value={o.id}>
          {nomeOperador(o)}
        </option>
      ))}
    </Seletor>
  );
}

// [2026-08] Mesmas opções de com_pdf/sem_pdf/com_pix/sem_pix que a tela de
// Clientes do Operador já tem (routes/clientes.tsx) -- faltavam aqui, agora
// que o backend (GET /api/supervisor/clientes) também aceita com_pdf/sem_pdf.
const FILTRO_PDF_PIX = [
  { value: "", label: "Todos" },
  { value: "com_pix", label: "Com PIX" },
  { value: "sem_pix", label: "Sem PIX" },
  { value: "com_pdf", label: "Com PDF" },
  { value: "sem_pdf", label: "Sem PDF" },
] as const;
type FiltroPdfPix = (typeof FILTRO_PDF_PIX)[number]["value"];

const TAMANHO_PAGINA_SUPERVISOR = 50;

function AbaClientes({ operadores }: { operadores: Operador[] }) {
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [operadorId, setOperadorId] = useState("");
  const [filtro, setFiltro] = useState<FiltroPdfPix>("");
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  // Qualquer mudança de filtro volta pra página 1 -- senão dá pra ficar
  // "preso" numa página vazia depois de filtrar pra um resultado menor
  // (mesma regra da tela de Clientes do operador).
  useEffect(() => {
    setPagina(1);
  }, [buscaDebounced, operadorId, filtro]);

  // [perf] useQuery em vez de useEffect+useState -- cacheia por combinação de
  // filtros/página, então trocar de sub-aba dentro do Supervisor e voltar pra
  // "Clientes" não recarrega do zero (era o sintoma reportado: reabrir a aba
  // sempre disparava a busca de novo, mesmo sem nada ter mudado).
  const {
    data,
    isLoading: carregando,
    error: erroObj,
    refetch: carregar,
  } = useQuery({
    queryKey: ["supervisor-clientes", buscaDebounced, operadorId, filtro, pagina],
    queryFn: () =>
      api.supervisor.clientes({
        busca: buscaDebounced || undefined,
        operador_id: operadorId || undefined,
        com_pix: filtro === "com_pix" ? "true" : undefined,
        sem_pix: filtro === "sem_pix" ? "true" : undefined,
        com_pdf: filtro === "com_pdf" ? "true" : undefined,
        sem_pdf: filtro === "sem_pdf" ? "true" : undefined,
        page: pagina,
        per_page: TAMANHO_PAGINA_SUPERVISOR,
      }),
    staleTime: 15_000,
  });
  const clientes: ClienteSup[] = Array.isArray(data?.itens) ? data.itens : [];
  const total = typeof data?.total === "number" ? data.total : 0;
  const erro = erroObj ? (erroObj as Error).message : null;

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA_SUPERVISOR));

  return (
    <SectionCard
      titulo="Clientes (todos os operadores)"
      descricao="A quem cada cliente está atribuído."
      acoes={
        <div className="flex flex-wrap gap-2">
          <Busca
            placeholder="Buscar por nome ou telefone…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="flex-none w-full sm:w-52"
          />
          <Seletor
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as FiltroPdfPix)}
            className="max-w-[160px]"
          >
            {FILTRO_PDF_PIX.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Seletor>
          <SeletorOperador operadores={operadores} valor={operadorId} onChange={setOperadorId} />
        </div>
      }
      flush
      bodyClassName="p-0"
    >
      {erro ? (
        <ErroCarregamento erro={erro} onRetry={() => carregar()} />
      ) : !carregando && clientes.length === 0 ? (
        <EmptyState
          icon={Users}
          titulo="Nenhum cliente encontrado"
          descricao="Ajuste a busca ou os filtros acima."
          compacto
        />
      ) : (
        <>
          <TabelaWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-subtle border-b text-left text-xs uppercase">
                  <th className="px-4 py-2.5">Cliente</th>
                  <th className="px-4 py-2.5">Telefone</th>
                  <th className="px-4 py-2.5">Valor</th>
                  <th className="px-4 py-2.5">PDF</th>
                  <th className="px-4 py-2.5">PIX</th>
                  <th className="px-4 py-2.5">Atribuído a</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {carregando ? (
                  <LinhasEsqueleto colunas={6} linhas={6} />
                ) : (
                  clientes.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5 font-medium">{c.nome}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{c.telefone}</td>
                      <td className="px-4 py-2.5">{formatarValor(c.valor)}</td>
                      <td className="px-4 py-2.5">
                        {c.pdf_path ? (
                          <StatusPill tone="success">Com PDF</StatusPill>
                        ) : (
                          <StatusPill tone="muted">Sem PDF</StatusPill>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {c.pix_code ? (
                          <StatusPill tone="success">Com PIX</StatusPill>
                        ) : (
                          <StatusPill tone="muted">Sem PIX</StatusPill>
                        )}
                      </td>
                      <td className="px-4 py-2.5">{nomeOperador(c.operador)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TabelaWrap>
          {!carregando && (
            <Paginacao
              paginaAtual={pagina}
              totalPaginas={totalPaginas}
              totalItens={total}
              tamanhoPagina={TAMANHO_PAGINA_SUPERVISOR}
              onMudarPagina={setPagina}
            />
          )}
        </>
      )}
    </SectionCard>
  );
}

function AbaFaturas({ operadores }: { operadores: Operador[] }) {
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [operadorId, setOperadorId] = useState("");
  const [pagina, setPagina] = useState(1);
  const [pdfAberto, setPdfAberto] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    setPagina(1);
  }, [buscaDebounced, operadorId]);

  // [perf] useQuery em vez de useEffect+useState -- ver comentário equivalente
  // em AbaClientes (mesmo sintoma: reabrir a sub-aba recarregava do zero).
  const {
    data,
    isLoading: carregando,
    error: erroObj,
    refetch: carregar,
  } = useQuery({
    queryKey: ["supervisor-faturas", buscaDebounced, operadorId, pagina],
    queryFn: () =>
      api.supervisor.faturas({
        busca: buscaDebounced || undefined,
        operador_id: operadorId || undefined,
        page: pagina,
        per_page: TAMANHO_PAGINA_SUPERVISOR,
      }),
    staleTime: 15_000,
  });
  const faturas: FaturaSup[] = Array.isArray(data?.itens) ? data.itens : [];
  const total = typeof data?.total === "number" ? data.total : 0;
  const erro = erroObj ? (erroObj as Error).message : null;

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA_SUPERVISOR));

  return (
    <>
      <SectionCard
        titulo="Faturas (todos os operadores)"
        descricao="PDF, valor, vencimento e a quem está atribuída cada fatura."
        acoes={
          <div className="flex flex-wrap gap-2">
            {/* [2026-08] Sem `flex-wrap` antes, esta barra não tinha pra onde
              quebrar -- Busca (`flex-1`) e o seletor de operador brigavam
              pelo mesmo espaço numa tela estreita. Mesmo ajuste de largura
              fixa da tela Clientes. */}
            <Busca
              placeholder="Buscar por nome ou telefone…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="flex-none w-full sm:w-52"
            />
            <SeletorOperador operadores={operadores} valor={operadorId} onChange={setOperadorId} />
          </div>
        }
        flush
        bodyClassName="p-0"
      >
        {erro ? (
          <ErroCarregamento erro={erro} onRetry={() => carregar()} />
        ) : !carregando && faturas.length === 0 ? (
          <EmptyState
            icon={FileText}
            titulo="Nenhuma fatura encontrada"
            descricao="Ajuste a busca ou o filtro de operador acima."
            compacto
          />
        ) : (
          <>
            <TabelaWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-subtle border-b text-left text-xs uppercase">
                    <th className="px-4 py-2.5">Cliente</th>
                    <th className="px-4 py-2.5">Valor</th>
                    <th className="px-4 py-2.5">Vencimento</th>
                    <th className="px-4 py-2.5">PDF</th>
                    <th className="px-4 py-2.5">Atribuído a</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {carregando ? (
                    <LinhasEsqueleto colunas={5} linhas={6} />
                  ) : (
                    faturas.map((f) => (
                      <tr key={f.cliente_id}>
                        <td className="px-4 py-2.5 font-medium">{f.cliente_nome}</td>
                        <td className="px-4 py-2.5">{formatarValor(f.valor)}</td>
                        <td className="px-4 py-2.5">{f.vencimento || "—"}</td>
                        <td className="px-4 py-2.5">
                          {f.pdf_url ? (
                            <button
                              type="button"
                              onClick={() => setPdfAberto(f.pdf_url)}
                              className="text-primary-strong inline-flex items-center gap-1 hover:underline"
                            >
                              <FileText className="size-3.5" /> Ver
                            </button>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">{nomeOperador(f.operador)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TabelaWrap>
            {!carregando && (
              <Paginacao
                paginaAtual={pagina}
                totalPaginas={totalPaginas}
                totalItens={total}
                tamanhoPagina={TAMANHO_PAGINA_SUPERVISOR}
                onMudarPagina={setPagina}
              />
            )}
          </>
        )}
      </SectionCard>
      <VisualizadorPdf url={pdfAberto} onClose={() => setPdfAberto(null)} />
    </>
  );
}

const STATUS_DISPARO: Record<
  string,
  { label: string; tone: "muted" | "brand" | "success" | "warning" | "danger" }
> = {
  pendente: { label: "Pendente", tone: "muted" },
  agendado: { label: "Agendado", tone: "muted" },
  em_andamento: { label: "Em andamento", tone: "brand" },
  pausado: { label: "Pausado", tone: "warning" },
  concluido: { label: "Concluído", tone: "success" },
  cancelado: { label: "Cancelado", tone: "danger" },
};

function AbaDisparos({ operadores }: { operadores: Operador[] }) {
  const [status, setStatus] = useState("todos");
  const [operadorId, setOperadorId] = useState("");

  // [perf] useQuery em vez de useEffect+useState -- ver comentário equivalente
  // em AbaClientes (mesmo sintoma: reabrir a sub-aba recarregava do zero).
  const {
    data,
    isLoading: carregando,
    error: erroObj,
    refetch: carregar,
  } = useQuery({
    queryKey: ["supervisor-disparos", status, operadorId],
    queryFn: () => api.supervisor.disparos({ status, operador_id: operadorId || undefined }),
    staleTime: 15_000,
  });
  const disparos: DisparoSup[] = Array.isArray(data) ? data : [];
  const erro = erroObj ? (erroObj as Error).message : null;

  return (
    <SectionCard
      titulo="Disparos (todos os operadores)"
      descricao="Lotes de disparo em andamento e finalizados, de qualquer operador."
      acoes={
        <div className="flex gap-2">
          <Seletor
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="max-w-[180px]"
          >
            <option value="todos">Todos os status</option>
            <option value="em_andamento">Em andamento</option>
            <option value="pendente">Pendente</option>
            <option value="pausado">Pausado</option>
            <option value="agendado">Agendado</option>
            <option value="concluido">Concluído</option>
            <option value="cancelado">Cancelado</option>
          </Seletor>
          <SeletorOperador operadores={operadores} valor={operadorId} onChange={setOperadorId} />
        </div>
      }
      flush
      bodyClassName="p-0"
    >
      {erro ? (
        <ErroCarregamento erro={erro} onRetry={() => carregar()} />
      ) : !carregando && disparos.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          titulo="Nenhum disparo encontrado"
          descricao="Ajuste o status ou o filtro de operador acima."
          compacto
        />
      ) : (
        <TabelaWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-subtle border-b text-left text-xs uppercase">
                <th className="px-4 py-2.5">Lote</th>
                <th className="px-4 py-2.5">Operador</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Progresso</th>
                <th className="px-4 py-2.5">Entregues / lidos</th>
                <th className="px-4 py-2.5">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {carregando ? (
                <LinhasEsqueleto colunas={6} linhas={6} />
              ) : (
                disparos.map((d) => {
                  const st = STATUS_DISPARO[d.status] || {
                    label: d.status,
                    tone: "muted" as const,
                  };
                  return (
                    <tr key={d.id}>
                      <td className="px-4 py-2.5 font-medium">{d.lote || d.id.slice(0, 8)}</td>
                      <td className="px-4 py-2.5">{nomeOperador(d.operador)}</td>
                      <td className="px-4 py-2.5">
                        <StatusPill tone={st.tone}>{st.label}</StatusPill>
                      </td>
                      <td className="px-4 py-2.5">
                        {d.enviados}/{d.total} enviados
                        {d.falhas > 0 && (
                          <span className="text-destructive"> · {d.falhas} falha(s)</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {d.entregues} / {d.lidos}
                      </td>
                      <td className="px-4 py-2.5">{formatarData(d.criado_em)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TabelaWrap>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Planilha de PIX -- lida em modo "matriz" (header: 1) em vez de objetos,
// pra preservar EXATAMENTE a estrutura original da planilha (colunas extras,
// ordem, linhas em branco) e só mexer na célula da coluna PIX. Detecta as
// colunas "CLIENTE" e "PIX" pelo texto do cabeçalho (sem acento/maiúscula),
// aceitando variações comuns (Nome do cliente, Chave Pix, etc.).
// ---------------------------------------------------------------------------

function normalizarCabecalho(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function acharColuna(linhaCabecalho: unknown[], candidatos: RegExp[]): number {
  for (const regex of candidatos) {
    const idx = linhaCabecalho.findIndex((cel) => regex.test(normalizarCabecalho(cel)));
    if (idx !== -1) return idx;
  }
  return -1;
}

type ResultadoPlanilha = {
  linhasProcessadas: number;
  preenchidas: number;
  jaTinhamPix: number;
  semCorrespondencia: number;
};

// Processa uma matriz (array de arrays, primeira linha = cabeçalho): acha
// coluna CLIENTE e PIX, casa cada nome com `indice` (nome->pix) e preenche a
// célula PIX só quando estava vazia. Muta `matriz` in-place e devolve um
// resumo pra UI. `indice` pode vir de mais de uma fonte (sistema + extração
// pessoal) -- quem chama decide a ordem de prioridade ao montar o Map.
function preencherPixNaMatriz(
  matriz: unknown[][],
  indice: Map<string, string>,
  clientesParaCasar: { nome: string; pix: string }[],
): ResultadoPlanilha {
  const resultado: ResultadoPlanilha = {
    linhasProcessadas: 0,
    preenchidas: 0,
    jaTinhamPix: 0,
    semCorrespondencia: 0,
  };
  if (!matriz.length) return resultado;

  const cabecalho = matriz[0] || [];
  const colCliente = acharColuna(cabecalho, [
    /^cliente$/,
    /nome.*cliente/,
    /^nome$/,
    /razao social/,
  ]);
  const colPix = acharColuna(cabecalho, [/^pix$/, /chave.*pix/, /pix.*copia/, /codigo.*pix/]);

  if (colCliente === -1 || colPix === -1) {
    throw new Error('Não encontrei as colunas "CLIENTE" e "PIX" no cabeçalho da planilha.');
  }

  for (let i = 1; i < matriz.length; i++) {
    const linha = matriz[i];
    if (!linha || linha.every((c) => c === "" || c == null)) continue;
    const nomeCelula = String(linha[colCliente] ?? "").trim();
    if (!nomeCelula) continue;

    resultado.linhasProcessadas++;

    const pixAtual = String(linha[colPix] ?? "").trim();
    if (pixAtual) {
      resultado.jaTinhamPix++;
      continue;
    }

    const casado = casarClientePorNome(
      nomeCelula,
      clientesParaCasar.map((c) => ({ nome: c.nome, pix: c.pix })),
    );
    const pixEncontrado = casado?.pix || indice.get(normalizarCabecalho(nomeCelula));

    if (pixEncontrado) {
      linha[colPix] = pixEncontrado;
      resultado.preenchidas++;
    } else {
      resultado.semCorrespondencia++;
    }
  }

  return resultado;
}

function baixarMatrizComoXlsx(matriz: unknown[][], nomeArquivo: string) {
  const aba = XLSX.utils.aoa_to_sheet(matriz);
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, aba, "Planilha");
  XLSX.writeFile(livro, nomeArquivo);
}

function AbaPlanilha() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoPlanilha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function processar() {
    if (!arquivo) return;
    setProcessando(true);
    setErro(null);
    setResultado(null);
    try {
      const indicePix = await api.supervisor.indicePix();
      const clientesParaCasar = (Array.isArray(indicePix) ? indicePix : []).map(
        (c: IndicePixItem) => ({
          nome: c.nome,
          pix: c.pix_code,
        }),
      );
      const indice = new Map(clientesParaCasar.map((c) => [normalizarCabecalho(c.nome), c.pix]));

      const buffer = await arquivo.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const nomeAba = workbook.SheetNames[0];
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[nomeAba], {
        header: 1,
        defval: "",
      });

      const res = preencherPixNaMatriz(matriz, indice, clientesParaCasar);
      setResultado(res);

      const nomeSaida = arquivo.name.replace(/\.(xlsx|xls|csv)$/i, "") + "-com-pix.xlsx";
      baixarMatrizComoXlsx(matriz, nomeSaida);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setProcessando(false);
    }
  }

  return (
    <SectionCard
      titulo="Planilha de PIX"
      descricao='Suba uma planilha com as colunas "CLIENTE" e "PIX" (a coluna PIX pode vir vazia) -- o sistema acha cada cliente pelo nome, cruza com o PIX já cadastrado no banco (de qualquer operador) e devolve a mesma planilha com a coluna PIX preenchida.'
    >
      <div className="space-y-4">
        <label className="border-border-strong hover:border-primary flex h-10 max-w-md cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-xs">
          <Upload className="size-3.5 shrink-0" />
          <span className="truncate">
            {arquivo ? arquivo.name : "Selecionar planilha (.xlsx, .xls, .csv)"}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              setArquivo(e.target.files?.[0] ?? null);
              setResultado(null);
              setErro(null);
            }}
          />
        </label>

        <Botao variante="primary" onClick={processar} disabled={!arquivo || processando}>
          {processando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {processando ? "Processando…" : "Processar e baixar"}
        </Botao>

        {resultado && (
          <Aviso tone={resultado.semCorrespondencia > 0 ? "warning" : "info"}>
            {resultado.linhasProcessadas} linha(s) processada(s) — {resultado.preenchidas}{" "}
            preenchida(s) agora, {resultado.jaTinhamPix} já tinham PIX,{" "}
            {resultado.semCorrespondencia} sem correspondência.
          </Aviso>
        )}
        {erro && <Aviso tone="danger">{erro}</Aviso>}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Extrator de PIX pessoal -- extração 100% local (mesmo scanner de QR do
// /pix normal), NUNCA sobe PDF nem grava nada no Supabase. Resultado fica só
// no localStorage (ver lib/extratorPessoal.ts), expira sozinho em 8h. Serve
// pra tirar o Pix de faturas avulsas, fora da carteira de qualquer operador.
// A planilha aqui cruza primeiro com o que acabou de ser extraído localmente
// e, se não achar, cai pro índice do sistema (mesmo indicePix da aba
// "Planilha de PIX") -- é o "relaciona o Pix que existe no sistema com o Pix
// da planilha" pedido.
// ---------------------------------------------------------------------------

function formatarContagemRegressiva(ms: number) {
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h${String(m).padStart(2, "0")}min`;
}

function CopiarPix({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(valor);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
      }}
      className="focus-ring text-subtle hover:text-foreground shrink-0"
      aria-label="Copiar chave PIX"
    >
      {copiado ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function AbaExtratorPessoal() {
  const [itens, setItens] = useState<ItemExtraidoPessoal[]>([]);
  const [expiraEm, setExpiraEmState] = useState(0);
  const [extraindo, setExtraindo] = useState(false);
  const [erroExtracao, setErroExtracao] = useState<string | null>(null);

  const inputPdfRef = useRef<HTMLInputElement>(null);
  const inputPlanilhaRef = useRef<HTMLInputElement>(null);
  const [arquivoPlanilha, setArquivoPlanilha] = useState<File | null>(null);
  const [processandoPlanilha, setProcessandoPlanilha] = useState(false);
  const [resultadoPlanilha, setResultadoPlanilha] = useState<ResultadoPlanilha | null>(null);
  const [erroPlanilha, setErroPlanilha] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    setItens(listarExtracoesPessoais());
    setExpiraEmState(expiraEmMs());
  }, []);

  useEffect(() => {
    recarregar();
    // Atualiza a contagem regressiva a cada minuto -- e faz sumir a lista
    // sozinha quando os dados expiram, sem precisar recarregar a página.
    const t = setInterval(recarregar, 60_000);
    return () => clearInterval(t);
  }, [recarregar]);

  async function extrairArquivos(arquivos: File[]) {
    setExtraindo(true);
    setErroExtracao(null);
    try {
      for (const arquivo of arquivos) {
        try {
          const resultado = await extrairPixLocal(arquivo);
          if (resultado?.pixCopiaCola) {
            adicionarExtracaoPessoal({
              nomeArquivo: arquivo.name,
              pixCopiaCola: resultado.pixCopiaCola,
            });
          }
        } catch {
          // um PDF ruim não derruba o resto do lote
        }
      }
      recarregar();
    } catch (e) {
      setErroExtracao((e as Error).message);
    } finally {
      setExtraindo(false);
    }
  }

  async function processarPlanilha() {
    if (!arquivoPlanilha) return;
    setProcessandoPlanilha(true);
    setErroPlanilha(null);
    setResultadoPlanilha(null);
    try {
      // Prioridade: 1) o que acabou de ser extraído localmente (mais
      // recente = vence, por isso o reduce simples sobrescrevendo), 2) o
      // índice do sistema (todos os operadores) só pra quem não achou local.
      const indiceLocal = new Map(
        itens.map((i) => [
          normalizarCabecalho(i.nomeArquivo.replace(/\.pdf$/i, "")),
          i.pixCopiaCola,
        ]),
      );
      const indiceSistema = await api.supervisor.indicePix();
      const clientesSistema = (Array.isArray(indiceSistema) ? indiceSistema : []).map(
        (c: IndicePixItem) => ({
          nome: c.nome,
          pix: c.pix_code,
        }),
      );

      const buffer = await arquivoPlanilha.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const nomeAba = workbook.SheetNames[0];
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[nomeAba], {
        header: 1,
        defval: "",
      });

      // Casa primeiro contra os nomes de arquivo extraídos localmente (nome
      // do arquivo funciona como "nome do cliente" aqui, mesma convenção do
      // Extrator de PIX normal); o que sobrar cai pro índice do sistema.
      const clientesParaCasarLocal = [...indiceLocal.entries()].map(([nome, pix]) => ({
        nome,
        pix,
      }));
      const res = preencherPixNaMatriz(matriz, indiceLocal, clientesParaCasarLocal);
      const resSistema = preencherPixNaMatriz(matriz, new Map(), clientesSistema);
      const resultadoFinal: ResultadoPlanilha = {
        linhasProcessadas: res.linhasProcessadas,
        preenchidas: res.preenchidas + resSistema.preenchidas,
        jaTinhamPix: res.jaTinhamPix,
        semCorrespondencia: resSistema.semCorrespondencia,
      };
      setResultadoPlanilha(resultadoFinal);

      const nomeSaida = arquivoPlanilha.name.replace(/\.(xlsx|xls|csv)$/i, "") + "-com-pix.xlsx";
      baixarMatrizComoXlsx(matriz, nomeSaida);
    } catch (e) {
      setErroPlanilha((e as Error).message);
    } finally {
      setProcessandoPlanilha(false);
    }
  }

  const contagem = formatarContagemRegressiva(expiraEm - Date.now());

  return (
    <div className="space-y-6">
      <SectionCard
        titulo="Extrair PIX (só neste navegador)"
        descricao="Extração 100% local -- nada é enviado ou salvo no banco. O resultado fica só neste navegador e some sozinho em 8 horas."
        acoes={
          <Botao
            variante="primary"
            onClick={() => inputPdfRef.current?.click()}
            disabled={extraindo}
          >
            {extraindo ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {extraindo ? "Extraindo…" : "Selecionar PDFs"}
          </Botao>
        }
      >
        <input
          ref={inputPdfRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const arquivos = Array.from(e.target.files || []);
            if (arquivos.length) extrairArquivos(arquivos);
            e.target.value = "";
          }}
        />

        {contagem && (
          <p className="text-subtle mb-3 text-xs">
            {itens.length} extração(ões) guardada(s) neste navegador — some(m) em {contagem}.
          </p>
        )}
        {erroExtracao && <Aviso tone="danger">{erroExtracao}</Aviso>}

        {itens.length > 0 ? (
          <div className="divide-border border-border divide-y rounded-md border">
            {itens.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="text-subtle size-4 shrink-0" />
                  <span className="truncate text-sm">{item.nomeArquivo}</span>
                  <span className="text-subtle max-w-[220px] truncate font-mono text-xs">
                    {item.pixCopiaCola}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <CopiarPix valor={item.pixCopiaCola} />
                  <button
                    type="button"
                    onClick={() => {
                      removerExtracaoPessoal(item.id);
                      recarregar();
                    }}
                    className="focus-ring text-subtle hover:text-destructive"
                    aria-label="Remover"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            titulo="Nenhuma extração ainda"
            descricao="Selecione um ou mais PDFs pra extrair a chave PIX localmente."
          />
        )}

        {itens.length > 0 && (
          <Botao
            variante="outline"
            tamanho="sm"
            className="mt-3"
            onClick={() => {
              limparExtracoesPessoais();
              recarregar();
            }}
          >
            <Trash2 className="size-3.5" />
            Limpar tudo
          </Botao>
        )}
      </SectionCard>

      <SectionCard
        titulo="Preencher planilha com esses PIX + o sistema"
        descricao="Suba a planilha (colunas CLIENTE e PIX) -- primeiro tenta casar pelo que você acabou de extrair acima, depois pelo PIX já existente no sistema (de qualquer operador)."
      >
        <div className="space-y-4">
          <label className="border-border-strong hover:border-primary flex h-10 max-w-md cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-xs">
            <Upload className="size-3.5 shrink-0" />
            <span className="truncate">
              {arquivoPlanilha ? arquivoPlanilha.name : "Selecionar planilha (.xlsx, .xls, .csv)"}
            </span>
            <input
              ref={inputPlanilhaRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                setArquivoPlanilha(e.target.files?.[0] ?? null);
                setResultadoPlanilha(null);
                setErroPlanilha(null);
              }}
            />
          </label>

          <Botao
            variante="primary"
            onClick={processarPlanilha}
            disabled={!arquivoPlanilha || processandoPlanilha}
          >
            {processandoPlanilha ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {processandoPlanilha ? "Processando…" : "Processar e baixar"}
          </Botao>

          {resultadoPlanilha && (
            <Aviso tone={resultadoPlanilha.semCorrespondencia > 0 ? "warning" : "info"}>
              {resultadoPlanilha.linhasProcessadas} linha(s) processada(s) —{" "}
              {resultadoPlanilha.preenchidas} preenchida(s) agora, {resultadoPlanilha.jaTinhamPix}{" "}
              já tinham PIX, {resultadoPlanilha.semCorrespondencia} sem correspondência.
            </Aviso>
          )}
          {erroPlanilha && <Aviso tone="danger">{erroPlanilha}</Aviso>}
        </div>
      </SectionCard>
    </div>
  );
}
