import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, History, RefreshCcw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
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
];

const FILTRO_ITENS: { valor: string; label: string }[] = [
  { valor: "todos", label: "Todos" },
  { valor: "enviado", label: "Enviados" },
  { valor: "entregue", label: "Entregues" },
  { valor: "lido", label: "Lidos" },
  { valor: "erro", label: "Falhas" },
  { valor: "numero_invalido", label: "Inválidos" },
  { valor: "pendente", label: "Pendentes" },
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
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [envio.id, filtro, busca]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader>
        <SheetTitle>{envio.lote || "Detalhes do lote"}</SheetTitle>
        <SheetDescription>Lote #{envio.id.slice(0, 8)} — {formatarData(envio.criado_em)}</SheetDescription>
      </SheetHeader>

      {envio.status === "pendente" && (
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
          Disparar este pacote
        </Botao>
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

        <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-4">
          <MiniMetrica label="Total" valor={progresso?.total ?? envio.total} />
          <MiniMetrica label="Enviados" valor={progresso?.enviados ?? envio.enviados} />
          <MiniMetrica label="Entregues" valor={progresso?.entregues ?? envio.entregues} />
          <MiniMetrica label="Lidos" valor={progresso?.lidos ?? envio.lidos} />
          <MiniMetrica label="Falhas" valor={progresso?.falhas ?? envio.falhas} tone="danger" />
          <MiniMetrica label="Inválidos" valor={progresso?.numeros_invalidos ?? envio.numeros_invalidos} tone="warning" />
          <MiniMetrica label="Pendentes" valor={progresso?.pendentes ?? envio.pendentes} />
          <MiniMetrica label="Conexão" valor={progresso?.slot_atual ?? envio.slot ?? "—"} />
        </div>

        <div>
          <Rotulo>Filtrar destinatários</Rotulo>
          <FiltroChips valor={filtro} opcoes={FILTRO_ITENS} onChange={setFiltro} className="mb-3" />
          <Busca placeholder="Buscar por nome ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>

        <TabelaWrap>
          <thead>
            <tr>
              <th className="th-cell">Cliente</th>
              <th className="th-cell">Telefone</th>
              <th className="th-cell">Valor</th>
              <th className="th-cell">Status</th>
              <th className="th-cell">Conexão</th>
              <th className="th-cell">Horário</th>
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
                    <td className="td-cell">{item.clientes?.nome ?? "—"}</td>
                    <td className="td-cell font-mono text-xs">{item.clientes?.telefone ?? "—"}</td>
                    <td className="td-cell">{item.clientes?.valor ?? "—"}</td>
                    <td className="td-cell">
                      <StatusBadge status={status} />
                      {item.erro && <p className="text-destructive mt-1 text-[11px]">{item.erro}</p>}
                    </td>
                    <td className="td-cell">{item.slot != null ? `WhatsApp ${item.slot}` : "—"}</td>
                    <td className="td-cell text-xs">{formatarData(item.enviado_em)}</td>
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

      <Sheet open={loteSelecionado !== null} onOpenChange={(v) => !v && setLoteSelecionado(null)}>
        {loteSelecionado && <DetalhesLote envio={loteSelecionado} onOpenChange={() => setLoteSelecionado(null)} />}
      </Sheet>
    </AppShell>
  );
}
