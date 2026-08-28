import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Download, History, RefreshCcw, Send, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusPill, type Tone } from "@/components/shared/StatusPill";
import { Progress } from "@/components/ui/progress";
import { useAppState } from "@/lib/app-state";
import {
  Aviso,
  Botao,
  Busca,
  Campo,
  FiltroChips,
  LinhasEsqueleto,
  Rotulo,
  TabelaWrap,
} from "@/components/shared/Controls";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { statusDoItem, type EnvioResumo, type EnvioStatus, type ItemStatus } from "@/lib/types";

export const Route = createFileRoute("/historico")({
  head: () => ({
    meta: [
      { title: "Histórico de disparos — Voxcel Faturas" },
      {
        name: "description",
        content:
          "Consulte o histórico de lotes de disparo de faturas: totais, entregas, leituras e falhas, com filtros por período, status e conexão.",
      },
      { property: "og:title", content: "Histórico de disparos — Voxcel Faturas" },
      { property: "og:description", content: "Lotes de disparo com filtros por período, status e conexão." },
    ],
  }),
  component: Historico,
});

const STATUS_OPCOES: { valor: EnvioStatus | "todos"; label: string }[] = [
  { valor: "todos", label: "Todos" },
  { valor: "pendente", label: "Pendente" },
  { valor: "agendado", label: "Agendado" },
  { valor: "em_andamento", label: "Em andamento" },
  { valor: "pausado", label: "Pausado" },
  { valor: "concluido", label: "Concluído" },
  { valor: "cancelado", label: "Cancelado" },
];

const TONE_STATUS_LOTE: Record<EnvioStatus, Tone> = {
  pendente: "muted",
  agendado: "info",
  em_andamento: "brand",
  pausado: "warning",
  concluido: "success",
  cancelado: "danger",
};

const FILTRO_ITENS: { valor: string; label: string }[] = [
  { valor: "todos", label: "Todos" },
  { valor: "enviado", label: "Enviados" },
  { valor: "entregue", label: "Entregues" },
  { valor: "lido", label: "Lidos" },
  { valor: "erro", label: "Falhas" },
  { valor: "numero_invalido", label: "Inválidos" },
  { valor: "pendente", label: "Pendentes" },
  { valor: "cancelado", label: "Cancelados" },
];

function formatarData(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/* -------------------------------------------------------------------------- */
/* Detalhes do lote (Sheet)                                                  */
/* -------------------------------------------------------------------------- */

type EnvioProgresso = {
  total: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhas: number;
  numeros_invalidos: number;
  pendentes: number;
  status: string;
};

function DetalhesLote({ envio, onOpenChange }: { envio: EnvioResumo; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { setEnvioAtivoId } = useAppState();
  const [progresso, setProgresso] = useState<EnvioProgresso | null>(null);
  const [itens, setItens] = useState<Awaited<ReturnType<typeof api.envios.itens>>>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [statusAtual, setStatusAtual] = useState(envio.status);
  const [acao, setAcao] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const itensParams: { filtro?: string; busca?: string } = { filtro };
      if (busca) itensParams.busca = busca;
      const [progressoData, itensData] = await Promise.all([
        api.envios.progresso(envio.id),
        api.envios.itens(envio.id, itensParams),
      ]);
      setProgresso(progressoData);
      setItens(itensData);
      if (progressoData?.status) setStatusAtual(progressoData.status as typeof envio.status);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [envio.id, filtro, busca]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Enquanto o lote está em andamento, atualiza sozinho -- sem isso, quem
  // abre o Histórico e encontra um lote "em andamento" não tinha nenhuma
  // forma de ver o progresso mudar nem de saber que pausar/interromper
  // funcionou, precisava fechar e reabrir o painel pra conferir.
  useEffect(() => {
    if (statusAtual !== "em_andamento") return;
    const interval = setInterval(carregar, 4000);
    return () => clearInterval(interval);
  }, [statusAtual, carregar]);

  async function pausar() {
    setAcao("pausar");
    try {
      await api.envios.pausar(envio.id);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAcao(null);
    }
  }

  async function cancelar() {
    if (!window.confirm("Interromper este disparo? Os itens ainda não enviados não serão disparados e o lote não poderá ser retomado.")) {
      return;
    }
    setAcao("cancelar");
    try {
      await api.envios.cancelar(envio.id);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAcao(null);
    }
  }

  return (
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader>
        <SheetTitle>{envio.lote || "Detalhes do lote"}</SheetTitle>
        <SheetDescription>Lote #{envio.id.slice(0, 8)} — {formatarData(envio.criado_em)}</SheetDescription>
      </SheetHeader>

      {(statusAtual === "pendente" || statusAtual === "pausado") && (
        <Botao
          variante="primary"
          tamanho="sm"
          className="mt-4 w-full"
          onClick={() => {
            setEnvioAtivoId(envio.id);
            onOpenChange(false);
            navigate({ to: "/disparos" });
          }}
        >
          <Send className="size-3.5" />
          {statusAtual === "pausado" ? "Continuar disparo (pendentes)" : "Disparar este pacote"}
        </Botao>
      )}

      {(statusAtual === "em_andamento" || statusAtual === "pausado") && (
        <div className="mt-4 flex gap-2">
          {statusAtual === "em_andamento" && (
            <Botao variante="secondary" tamanho="sm" className="flex-1" onClick={pausar} disabled={acao !== null}>
              {acao === "pausar" ? "Pausando…" : "Pausar disparo"}
            </Botao>
          )}
          <Botao variante="outline" tamanho="sm" className="flex-1" onClick={cancelar} disabled={acao !== null}>
            {acao === "cancelar" ? "Interrompendo…" : "Interromper disparo"}
          </Botao>
        </div>
      )}

      <div className="mt-5 space-y-5">
        {erro && (
          <Aviso tone="danger">
            {erro}
            <Botao variante="ghost" tamanho="sm" className="ml-2" onClick={carregar}>
              Tentar novamente
            </Botao>
          </Aviso>
        )}

        <BarraProgressoLote status={statusAtual} envio={envio} progresso={progresso} carregando={carregando} />

        <div className="grid grid-cols-4 gap-2.5 text-center sm:gap-3">
          <MiniMetrica label="Total" valor={progresso?.total ?? envio.total} />
          <MiniMetrica label="Enviados" valor={progresso?.enviados ?? envio.enviados} />
          <MiniMetrica label="Entregues" valor={progresso?.entregues ?? envio.entregues} />
          <MiniMetrica label="Lidos" valor={progresso?.lidos ?? envio.lidos} />
          <MiniMetrica label="Falhas" valor={progresso?.falhas ?? envio.falhas} tone="danger" />
          <MiniMetrica label="Inválidos" valor={progresso?.numeros_invalidos ?? envio.numeros_invalidos} tone="warning" />
          <MiniMetrica label="Pendentes" valor={progresso?.pendentes ?? envio.pendentes} />
          <MiniMetrica label="Cancelados" valor={envio.cancelados ?? 0} />
        </div>

        <div>
          <Rotulo>Filtrar destinatários</Rotulo>
          <FiltroChips valor={filtro} opcoes={FILTRO_ITENS} onChange={setFiltro} className="mb-3" />
          <Busca placeholder="Buscar por nome ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>

        <TabelaWrap compact>
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[26%]" />
            <col className="w-[16%]" />
            <col className="w-[22%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr>
              <th className="th-cell whitespace-normal">Cliente</th>
              <th className="th-cell whitespace-normal">Telefone</th>
              <th className="th-cell whitespace-normal">Valor</th>
              <th className="th-cell whitespace-normal">Status</th>
              <th className="th-cell whitespace-normal">Horário</th>
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <LinhasEsqueleto colunas={5} linhas={4} />
            ) : itens.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState titulo="Nenhum destinatário encontrado." compacto />
                </td>
              </tr>
            ) : (
              itens.map((item) => {
                const status: ItemStatus = statusDoItem(item);
                return (
                  <tr key={item.id} className="border-border border-t align-top">
                    <td className="td-cell truncate" title={item.clientes?.nome ?? undefined}>{item.clientes?.nome ?? "—"}</td>
                    <td className="td-cell truncate font-mono text-xs" title={item.clientes?.telefone ?? undefined}>{item.clientes?.telefone ?? "—"}</td>
                    <td className="td-cell truncate">{item.clientes?.valor ?? "—"}</td>
                    <td className="td-cell">
                      <StatusBadge status={status} />
                      {item.erro && <p className="text-destructive mt-1 text-[11px] text-pretty">{item.erro}</p>}
                    </td>
                    <td className="td-cell truncate text-xs">{formatarData(item.enviado_em)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TabelaWrap>
      </div>
    </SheetContent>
  );
}

// Barra de progresso REAL do lote: usa `total - pendentes` (não só
// "enviados") como base do percentual, porque um item com erro/número
// inválido já foi PROCESSADO (não fica pendente pra sempre) -- contar só
// "enviados" fazia a barra parecer travada num lote com bastante falha,
// mesmo ele já tendo terminado de rodar. A cor muda pra vermelho/amarelo
// quando o lote termina com falha, pra responder de cara "deu tudo certo ou
// não?" sem precisar ler os números um a um.
function BarraProgressoLote({
  status,
  envio,
  progresso,
  carregando,
}: {
  status: EnvioStatus;
  envio: EnvioResumo;
  progresso: EnvioProgresso | null;
  carregando: boolean;
}) {
  const total = progresso?.total ?? envio.total;
  const pendentes = progresso?.pendentes ?? envio.pendentes;
  const falhas = (progresso?.falhas ?? envio.falhas) + (progresso?.numeros_invalidos ?? envio.numeros_invalidos);
  const processados = Math.max(0, total - pendentes);
  const percentual = total > 0 ? Math.round((processados / total) * 100) : 0;
  const finalizado = status === "concluido" || status === "cancelado";

  if (carregando && !progresso) {
    return <div className="bg-surface-sunken mb-1 h-2 w-full animate-pulse rounded-full" />;
  }

  const corIndicador = finalizado && falhas === 0 ? "bg-success" : falhas > 0 ? "bg-destructive" : undefined;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          {finalizado && falhas === 0 && <CheckCircle2 className="text-success size-3.5" />}
          {falhas > 0 && <TriangleAlert className="text-warning size-3.5" />}
          {finalizado
            ? falhas > 0
              ? `Concluído com ${falhas} falha(s)`
              : status === "cancelado"
                ? "Interrompido"
                : "Concluído com sucesso"
            : status === "pausado"
              ? "Pausado"
              : status === "em_andamento"
                ? "Em andamento"
                : "Aguardando início"}
        </span>
        <span className="text-subtle font-mono">
          {processados}/{total} ({percentual}%)
        </span>
      </div>
      <Progress value={percentual} indicatorClassName={corIndicador} />
    </div>
  );
}

// Versão compacta da barra pra caber numa linha da tabela -- mesmo cálculo
// (processados/total, cor por falha) da BarraProgressoLote, mas sem
// depender do progresso "ao vivo" (só o resumo que já veio na listagem),
// pra dar uma visão de andamento de TODOS os lotes de uma vez, sem precisar
// abrir cada um.
function MiniBarraLinha({ envio }: { envio: EnvioResumo }) {
  if (envio.status === "agendado") return null; // ainda não começou -- nada pra mostrar
  const processados = Math.max(0, envio.total - envio.pendentes);
  const percentual = envio.total > 0 ? Math.round((processados / envio.total) * 100) : 0;
  const falhas = envio.falhas + envio.numeros_invalidos;
  const finalizado = envio.status === "concluido" || envio.status === "cancelado";
  const cor = finalizado && falhas === 0 ? "bg-success" : falhas > 0 ? "bg-destructive" : undefined;

  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <Progress value={percentual} className="h-1" indicatorClassName={cor} />
      <span className="text-subtle shrink-0 font-mono text-[10px]">{percentual}%</span>
    </div>
  );
}

function MiniMetrica({ label, valor, tone }: { label: string; valor: number | string; tone?: "danger" | "warning" }) {
  return (
    <div>
      <p className="label-eyebrow mb-1">{label}</p>
      <p
        className={cn(
          "font-display tabular text-base font-semibold",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-warning",
        )}
      >
        {valor}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela principal                                                            */
/* -------------------------------------------------------------------------- */

function Historico() {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [status, setStatus] = useState<EnvioStatus | "todos">("todos");
  const [busca, setBusca] = useState("");
  // [layout] Período (De/Até) fica atrás de "Período" em vez de solto na
  // toolbar principal -- mesmo padrão de "Mais filtros" já usado em
  // routes/clientes.tsx, pra manter a barra de filtros compacta e consistente
  // entre as abas.
  const filtrosAvancadosAtivos = Boolean(de || ate);
  const [filtrosAvancadosAbertos, setFiltrosAvancadosAbertos] = useState(false);

  const [loteSelecionado, setLoteSelecionado] = useState<EnvioResumo | null>(null);

  function buildParams() {
    const p: { de?: string; ate?: string; status?: EnvioStatus; busca?: string } = {};
    if (status !== "todos") p.status = status;
    if (de) p.de = de;
    if (ate) p.ate = ate;
    if (busca) p.busca = busca;
    return p;
  }

  // [perf] useQuery com os filtros na queryKey -- cada combinação de
  // filtro/período/busca fica cacheada separadamente, então voltar pra um
  // filtro já visitado (inclusive "todos", o padrão ao abrir a aba) mostra os
  // dados na hora em vez de esperar o fetch de novo.
  const {
    data: lotesData,
    isLoading: carregando,
    error: erroObj,
    refetch: carregar,
  } = useQuery({
    queryKey: ["envios-lista", de, ate, status, busca],
    queryFn: () => api.envios.listar(buildParams()),
    staleTime: 15_000,
  });
  const lotes = Array.isArray(lotesData) ? lotesData : [];
  const erro = erroObj ? (erroObj as Error).message : null;

  async function exportar(formato: "csv" | "xlsx") {
    try {
      await api.envios.exportar(formato, buildParams() as any);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <AppShell
      title="Histórico"
      subtitle="Lotes de disparo já criados, com totais e status de entrega"
      actions={
        <>
          <Botao variante="secondary" tamanho="sm" onClick={() => exportar("csv")}>
            <Download className="size-3.5" /> CSV
          </Botao>
          <Botao variante="secondary" tamanho="sm" onClick={() => exportar("xlsx")}>
            <Download className="size-3.5" /> XLSX
          </Botao>
          <Botao variante="ghost" tamanho="sm" onClick={() => carregar()}>
            <RefreshCcw className="size-3.5" />
          </Botao>
        </>
      }
    >
      <div className="space-y-3">
        <div className="toolbar flex flex-wrap items-center gap-2">
          {/* [2026-08] Mesmo ajuste da tela Clientes: Busca com largura fixa
              em vez de `flex-1` -- não disputa espaço com os chips de status
              e não encolhe a ponto de cortar o próprio texto. */}
          <Busca placeholder="Cliente, telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} className="flex-none w-full sm:w-52" />
          <FiltroChips valor={status} onChange={setStatus} opcoes={STATUS_OPCOES} />
          <button
            type="button"
            onClick={() => setFiltrosAvancadosAbertos((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              filtrosAvancadosAbertos || filtrosAvancadosAtivos
                ? "bg-primary-soft text-primary-strong"
                : "text-muted-foreground hover:bg-surface-raised",
            )}
          >
            <SlidersHorizontal className="size-3.5" />
            Período
            {filtrosAvancadosAtivos && <span className="bg-primary-strong size-1.5 rounded-full" />}
          </button>
        </div>

        {filtrosAvancadosAbertos && (
          <div className="toolbar flex flex-wrap items-end gap-3">
            <div>
              <Rotulo>De</Rotulo>
              <Campo type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-auto" />
            </div>
            <div>
              <Rotulo>Até</Rotulo>
              <Campo type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-auto" />
            </div>
            {filtrosAvancadosAtivos && (
              <Botao variante="ghost" tamanho="sm" onClick={() => { setDe(""); setAte(""); }}>
                Limpar
              </Botao>
            )}
          </div>
        )}
      </div>

      <SectionCard titulo="Lotes" className="mt-4" flush>
        {erro ? (
          <div className="p-5">
            <Aviso tone="danger">
              {erro}
              <Botao variante="ghost" tamanho="sm" className="ml-2" onClick={() => carregar()}>
                Tentar novamente
              </Botao>
            </Aviso>
          </div>
        ) : !carregando && lotes.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={History} titulo="Nenhum disparo realizado ainda." compacto />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {carregando
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="panel-flat h-[11.5rem] animate-pulse" />
                ))
              : lotes.map((envio) => {
                  const statusLabel = STATUS_OPCOES.find((o) => o.valor === envio.status)?.label ?? envio.status;
                  return (
                    <button
                      key={envio.id}
                      type="button"
                      onClick={() => setLoteSelecionado(envio)}
                      className="panel hover:border-border-strong hover:shadow-raised flex flex-col gap-3 p-4 text-left transition-shadow"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-subtle truncate font-mono text-xs">
                          {envio.lote ?? `#${envio.id.slice(0, 8)}`}
                        </span>
                        <StatusPill tone={TONE_STATUS_LOTE[envio.status] ?? "muted"} dot pulse={envio.status === "em_andamento"}>
                          {statusLabel}
                        </StatusPill>
                      </div>

                      <div>
                        <p className="font-display tabular text-2xl font-semibold">
                          {envio.enviados}
                          <span className="text-subtle text-sm font-normal"> / {envio.total}</span>
                        </p>
                        <p className="label-eyebrow mt-0.5">Enviados</p>
                      </div>

                      <MiniBarraLinha envio={envio} />

                      <div className="border-border grid grid-cols-3 gap-2 border-t pt-3 text-center">
                        <div>
                          <p className="tabular text-sm font-semibold">{envio.entregues}</p>
                          <p className="text-subtle text-[10px] uppercase">Entregues</p>
                        </div>
                        <div>
                          <p className="tabular text-sm font-semibold">{envio.lidos}</p>
                          <p className="text-subtle text-[10px] uppercase">Lidos</p>
                        </div>
                        <div>
                          <p className={cn("tabular text-sm font-semibold", envio.falhas > 0 && "text-destructive")}>
                            {envio.falhas}
                          </p>
                          <p className="text-subtle text-[10px] uppercase">Falhas</p>
                        </div>
                      </div>

                      <p className="text-subtle text-[11px]">{formatarData(envio.criado_em)}</p>
                    </button>
                  );
                })}
          </div>
        )}
      </SectionCard>

      <Sheet
        open={loteSelecionado !== null}
        onOpenChange={(v) => {
          if (!v) {
            setLoteSelecionado(null);
            // Recarrega a lista pra refletir status/contadores que podem ter
            // mudado dentro do painel (ex: pausar/interromper um lote).
            carregar();
          }
        }}
      >
        {loteSelecionado && <DetalhesLote envio={loteSelecionado} onOpenChange={() => setLoteSelecionado(null)} />}
      </Sheet>
    </AppShell>
  );
}
