import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Download, History, RefreshCcw, Send, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
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
  Seletor,
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
import { statusDoItem, type EnvioResumo, type EnvioStatus, type ItemStatus, type WhatsappSlot } from "@/lib/types";

export const Route = createFileRoute("/historico")({
  head: () => ({
    meta: [
      { title: "Histórico de disparos — Veloce Faturas" },
      {
        name: "description",
        content:
          "Consulte o histórico de lotes de disparo de faturas: totais, entregas, leituras e falhas, com filtros por período, status e conexão.",
      },
      { property: "og:title", content: "Histórico de disparos — Veloce Faturas" },
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
  slot_atual: WhatsappSlot | null;
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

        <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-4">
          <MiniMetrica label="Total" valor={progresso?.total ?? envio.total} />
          <MiniMetrica label="Enviados" valor={progresso?.enviados ?? envio.enviados} />
          <MiniMetrica label="Entregues" valor={progresso?.entregues ?? envio.entregues} />
          <MiniMetrica label="Lidos" valor={progresso?.lidos ?? envio.lidos} />
          <MiniMetrica label="Falhas" valor={progresso?.falhas ?? envio.falhas} tone="danger" />
          <MiniMetrica label="Inválidos" valor={progresso?.numeros_invalidos ?? envio.numeros_invalidos} tone="warning" />
          <MiniMetrica label="Pendentes" valor={progresso?.pendentes ?? envio.pendentes} />
          <MiniMetrica label="Cancelados" valor={envio.cancelados ?? 0} />
          <MiniMetrica label="Conexão" valor={progresso?.slot_atual ?? envio.slot ?? "—"} />
        </div>

        <div>
          <Rotulo>Filtrar destinatários</Rotulo>
          <FiltroChips valor={filtro} opcoes={FILTRO_ITENS} onChange={setFiltro} className="mb-3" />
          <Busca placeholder="Buscar por nome ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>

        <TabelaWrap compact>
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[22%]" />
            <col className="w-[14%]" />
            <col className="w-[22%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr>
              <th className="th-cell whitespace-normal">Cliente</th>
              <th className="th-cell whitespace-normal">Telefone</th>
              <th className="th-cell whitespace-normal">Valor</th>
              <th className="th-cell whitespace-normal">Status</th>
              <th className="th-cell whitespace-normal">Conexão</th>
              <th className="th-cell whitespace-normal">Horário</th>
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <LinhasEsqueleto colunas={6} linhas={4} />
            ) : itens.length === 0 ? (
              <tr>
                <td colSpan={6}>
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
                    <td className="td-cell truncate">{item.slot != null ? `WhatsApp ${item.slot}` : "—"}</td>
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
  const [lotes, setLotes] = useState<EnvioResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [status, setStatus] = useState<EnvioStatus | "todos">("todos");
  const [slot, setSlot] = useState<WhatsappSlot | "todos">("todos");
  const [busca, setBusca] = useState("");

  const [loteSelecionado, setLoteSelecionado] = useState<EnvioResumo | null>(null);

  function buildParams() {
    const p: { de?: string; ate?: string; status?: EnvioStatus; slot?: WhatsappSlot; busca?: string } = {};
    if (status !== "todos") p.status = status;
    if (slot !== "todos") p.slot = slot;
    if (de) p.de = de;
    if (ate) p.ate = ate;
    if (busca) p.busca = busca;
    return p;
  }

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const data = await api.envios.listar(buildParams());
      setLotes(Array.isArray(data) ? data : []);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate, status, slot, busca]);

  useEffect(() => {
    carregar();
  }, [carregar]);

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
          <Botao variante="ghost" tamanho="sm" onClick={carregar}>
            <RefreshCcw className="size-3.5" />
          </Botao>
        </>
      }
    >
      <SectionCard titulo="Filtros" flush bodyClassName="p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1.5">
            <Rotulo>De</Rotulo>
            <Campo type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <Rotulo>Até</Rotulo>
            <Campo type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <Rotulo>Status</Rotulo>
            <Seletor value={status} onChange={(e) => setStatus(e.target.value as EnvioStatus | "todos")}>
              {STATUS_OPCOES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.label}
                </option>
              ))}
            </Seletor>
          </label>
          <label className="flex flex-col gap-1.5">
            <Rotulo>Conexão</Rotulo>
            <Seletor
              value={String(slot)}
              onChange={(e) => setSlot(e.target.value === "todos" ? "todos" : (Number(e.target.value) as WhatsappSlot))}
            >
              <option value="todos">Todas</option>
              <option value="1">WhatsApp 1</option>
              <option value="2">WhatsApp 2</option>
            </Seletor>
          </label>
          <label className="flex flex-col gap-1.5">
            <Rotulo>Buscar</Rotulo>
            <Busca placeholder="Cliente, telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
        </div>
      </SectionCard>

      <SectionCard titulo="Lotes" className="mt-6" flush>
        {erro ? (
          <div className="p-5">
            <Aviso tone="danger">
              {erro}
              <Botao variante="ghost" tamanho="sm" className="ml-2" onClick={carregar}>
                Tentar novamente
              </Botao>
            </Aviso>
          </div>
        ) : (
          <TabelaWrap>
            <thead>
              <tr>
                <th className="th-cell">Data</th>
                <th className="th-cell">Lote</th>
                <th className="th-cell">Status</th>
                <th className="th-cell text-right">Total</th>
                <th className="th-cell text-right">Enviados</th>
                <th className="th-cell text-right">Entregues</th>
                <th className="th-cell text-right">Lidos</th>
                <th className="th-cell text-right">Falhas</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <LinhasEsqueleto colunas={8} linhas={6} />
              ) : lotes.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState icon={History} titulo="Nenhum disparo realizado ainda." compacto />
                  </td>
                </tr>
              ) : (
                lotes.map((envio) => (
                  <tr
                    key={envio.id}
                    onClick={() => setLoteSelecionado(envio)}
                    className="border-border hover:bg-surface-raised/60 cursor-pointer border-t transition-colors"
                  >
                    <td className="td-cell text-xs">{formatarData(envio.criado_em)}</td>
                    <td className="td-cell font-mono text-xs">
                      {envio.lote ?? `#${envio.id.slice(0, 8)}`}
                    </td>
                    <td className="td-cell">
                      <span className="text-xs font-medium">{STATUS_OPCOES.find((o) => o.valor === envio.status)?.label ?? envio.status}</span>
                      <MiniBarraLinha envio={envio} />
                    </td>
                    <td className="td-cell tabular text-right">{envio.total}</td>
                    <td className="td-cell tabular text-right">{envio.enviados}</td>
                    <td className="td-cell tabular text-right">{envio.entregues}</td>
                    <td className="td-cell tabular text-right">{envio.lidos}</td>
                    <td className="td-cell tabular text-right">{envio.falhas}</td>
                  </tr>
                ))
              )}
            </tbody>
          </TabelaWrap>
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
