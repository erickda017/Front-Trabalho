import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ClipboardList,
  History,
  ListChecks,
  Loader2,
  TrendingUp,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusPill, type Tone } from "@/components/shared/StatusPill";
import {
  Aviso,
  Botao,
  Busca,
  LinhasEsqueleto,
  Paginacao,
  Rotulo,
  Seletor,
  TabelaWrap,
} from "@/components/shared/Controls";
import { MetricCard } from "@/components/shared/MetricCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/api";
import { paraBr } from "@/lib/dataBr";
import { formatoMoeda } from "@/lib/utils";
import type { Cliente, StatusOperador } from "@/lib/types";

// [2026-09] "Fila de trabalho" pro operador registrar o desfecho de cada
// tentativa de cobrança (tratativa) -- backend já existia inteiro desde a
// migration-20 (status_operador bloqueia disparo igual uma tag, ver
// lib/statusOperador.js), só não tinha tela nenhuma que deixasse o operador
// REGISTRAR isso -- só dava pra ver o efeito indireto (cliente sumindo do
// disparo) sem nunca ter escolhido o motivo pela interface. Ver CONTEXTO.md.
export const Route = createFileRoute("/qualidade")({
  head: () => ({
    meta: [
      { title: "Qualidade — Voxcel Faturas" },
      {
        name: "description",
        content:
          "Fila de trabalho e registro de tratativa de cobrança por cliente (contato, promessa de pagamento, recusa, etc).",
      },
      { property: "og:title", content: "Qualidade — Voxcel Faturas" },
      { property: "og:description", content: "Registre o desfecho de cada tentativa de cobrança." },
    ],
  }),
  component: Qualidade,
});

const TAMANHO_PAGINA = 20;

// Cor por FAMÍLIA de desfecho -- não por valor individual, pra não precisar
// tocar aqui se o catálogo de status (backend, lib/statusOperador.js) ganhar
// um valor novo no futuro. `bloqueia_disparo` já é exatamente a distinção
// que importa pro operador bater o olho: "isso é um desfecho final ou ainda
// está em andamento?".
function tonePorStatus(valor: StatusOperador | null | undefined, bloqueiaDisparo: boolean): Tone {
  if (!valor) return "muted";
  if (valor === "pagamento_confirmado") return "success";
  if (valor === "fraude" || valor === "numero_invalido") return "danger";
  if (bloqueiaDisparo) return "warning";
  return "info";
}

function HistoricoTratativas({
  clienteId,
  statusCatalogo,
}: {
  clienteId: string;
  statusCatalogo: { valor: StatusOperador; rotulo: string; bloqueia_disparo: boolean }[];
}) {
  const { data: historico, isLoading } = useQuery({
    queryKey: ["qualidade-historico", clienteId],
    queryFn: () => api.qualidade.historico(clienteId),
  });
  const rotuloPorValor = new Map(statusCatalogo.map((s) => [s.valor, s.rotulo]));

  if (isLoading) {
    return <p className="text-subtle text-xs">Carregando histórico…</p>;
  }
  if (!historico || historico.length === 0) {
    return (
      <p className="text-subtle text-xs">Nenhuma tratativa registrada ainda para este cliente.</p>
    );
  }
  return (
    <ol className="border-border max-h-48 space-y-3 overflow-y-auto border-t pt-3 text-xs">
      {historico.map((t) => (
        <li key={t.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{rotuloPorValor.get(t.status) || t.status}</span>
            <span className="text-subtle">{paraBr(t.criado_em)}</span>
          </div>
          {t.observacao && <p className="text-muted-foreground">{t.observacao}</p>}
        </li>
      ))}
    </ol>
  );
}

function RegistrarTratativaDialog({
  cliente,
  statusCatalogo,
  onOpenChange,
  onRegistrado,
}: {
  cliente: Cliente | null;
  statusCatalogo: { valor: StatusOperador; rotulo: string; bloqueia_disparo: boolean }[];
  onOpenChange: (v: boolean) => void;
  onRegistrado: () => void;
}) {
  const [status, setStatus] = useState<StatusOperador | "">("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!cliente || !status) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.qualidade.registrarTratativa(cliente.id, {
        status,
        observacao: observacao.trim() || undefined,
      });
      toast.success(`Tratativa registrada para ${cliente.nome}.`);
      setStatus("");
      setObservacao("");
      onRegistrado();
      onOpenChange(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open={Boolean(cliente)}
      onOpenChange={(v) => {
        if (!v) {
          setStatus("");
          setObservacao("");
          setErro(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar tratativa — {cliente?.nome}</DialogTitle>
          <DialogDescription>
            {cliente?.telefone}{" "}
            {cliente?.valor ? `· ${formatoMoeda.format(Number(cliente.valor))}` : ""}
          </DialogDescription>
        </DialogHeader>

        {erro && <Aviso tone="danger">{erro}</Aviso>}

        <div className="space-y-3">
          <div>
            <Rotulo>Desfecho</Rotulo>
            <Seletor value={status} onChange={(e) => setStatus(e.target.value as StatusOperador)}>
              <option value="">Selecione…</option>
              {statusCatalogo.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.rotulo}
                  {s.bloqueia_disparo ? " (sai do disparo)" : ""}
                </option>
              ))}
            </Seletor>
          </div>
          <div>
            <Rotulo>Observação (opcional)</Rotulo>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: prometeu pagar até sexta, pediu pra ligar de novo semana que vem…"
              rows={3}
              className="bg-surface text-foreground border-border focus-ring w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          {cliente && (
            <div>
              <p className="label-eyebrow mb-2 flex items-center gap-1.5">
                <History className="size-3.5" /> Histórico
              </p>
              <HistoricoTratativas clienteId={cliente.id} statusCatalogo={statusCatalogo} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Botao variante="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Botao>
          <Botao variante="primary" onClick={salvar} disabled={!status || salvando}>
            {salvando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Registrar
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Qualidade() {
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusOperador | "">("");
  const [pagina, setPagina] = useState(1);
  const [clienteEmTratativa, setClienteEmTratativa] = useState<Cliente | null>(null);

  const { data: resumo, isLoading: carregandoResumo } = useQuery({
    queryKey: ["qualidade-resumo"],
    queryFn: () => api.qualidade.resumo(),
    staleTime: 15_000,
  });

  const { data: statusCatalogo } = useQuery({
    queryKey: ["qualidade-status"],
    queryFn: () => api.qualidade.status(),
    staleTime: 5 * 60_000,
  });

  const {
    data: fila,
    error: erroObj,
    refetch: recarregarFila,
    isLoading: carregandoFila,
  } = useQuery({
    queryKey: ["qualidade-fila", busca, filtroStatus, pagina],
    queryFn: () =>
      api.qualidade.fila({
        busca: busca.trim() || undefined,
        status: filtroStatus || undefined,
        page: pagina,
        per_page: TAMANHO_PAGINA,
      }),
    staleTime: 10_000,
  });
  const erro = erroObj ? (erroObj as Error).message : null;

  async function recarregarTudo() {
    await recarregarFila();
  }

  const rotuloPorValor = new Map((statusCatalogo || []).map((s) => [s.valor, s.rotulo]));
  const bloqueiaPorValor = new Map(
    (statusCatalogo || []).map((s) => [s.valor, s.bloqueia_disparo]),
  );

  const itens = fila?.itens ?? [];
  const total = fila?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA));

  return (
    <AppShell
      title="Qualidade"
      subtitle="Fila de trabalho de cobrança: registre o desfecho de cada contato (tentativa, promessa de pagamento, recusa, número inválido…). Um desfecho final tira o cliente do disparo automaticamente, igual uma tag."
    >
      <div className="flex flex-col gap-4">
        {erro && <Aviso tone="danger">{erro}</Aviso>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <MetricCard
            label="Carteira"
            valor={resumo?.total_carteira ?? null}
            carregando={carregandoResumo}
            icon={Users}
          />
          <MetricCard
            label="Na fila"
            valor={resumo?.em_fila ?? null}
            carregando={carregandoResumo}
            icon={ListChecks}
          />
          <MetricCard
            label="Já tocados"
            valor={resumo?.tocados ?? null}
            carregando={carregandoResumo}
            icon={ClipboardList}
          />
          <MetricCard
            label="Resolvidos"
            valor={resumo?.resolvidos ?? null}
            carregando={carregandoResumo}
            icon={CheckCircle2}
          />
          <MetricCard
            label="Taxa de resolução"
            valor={resumo ? `${resumo.taxa_resolucao}%` : null}
            carregando={carregandoResumo}
            icon={TrendingUp}
            destaque
          />
        </div>

        <SectionCard
          titulo="Fila de trabalho"
          descricao="Sem filtro de status, mostra só quem ainda não teve um desfecho final registrado -- é a fila de verdade."
          acoes={
            <div className="flex flex-wrap items-center gap-2">
              <Busca
                placeholder="Buscar por nome ou telefone…"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setPagina(1);
                }}
              />
              <Seletor
                value={filtroStatus}
                onChange={(e) => {
                  setFiltroStatus(e.target.value as StatusOperador | "");
                  setPagina(1);
                }}
                className="w-auto"
              >
                <option value="">Fila (sem desfecho final)</option>
                {(statusCatalogo || []).map((s) => (
                  <option key={s.valor} value={s.valor}>
                    {s.rotulo}
                  </option>
                ))}
              </Seletor>
            </div>
          }
          flush
        >
          {carregandoFila ? (
            <TabelaWrap>
              <tbody>
                <LinhasEsqueleto colunas={6} linhas={6} />
              </tbody>
            </TabelaWrap>
          ) : itens.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              titulo={filtroStatus || busca ? "Nada encontrado" : "Fila vazia"}
              descricao={
                filtroStatus || busca
                  ? "Ninguém bate com esse filtro agora."
                  : "Todos os clientes já têm um desfecho registrado, ou a carteira ainda está vazia."
              }
              acao={
                !filtroStatus && !busca ? (
                  <Link to="/clientes">
                    <Botao variante="primary">Ver clientes</Botao>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <TabelaWrap>
                <thead>
                  <tr className="border-border text-subtle border-b">
                    <th className="th-cell">Cliente</th>
                    <th className="th-cell">Telefone</th>
                    <th className="th-cell">Valor</th>
                    <th className="th-cell">Vencimento</th>
                    <th className="th-cell">Status atual</th>
                    <th className="th-cell" />
                  </tr>
                </thead>
                <tbody>
                  {itens.map((c) => (
                    <tr key={c.id} className="border-border border-t">
                      <td className="td-cell font-medium">{c.nome}</td>
                      <td className="td-cell font-mono text-xs">{c.telefone}</td>
                      <td className="td-cell">
                        {c.valor ? formatoMoeda.format(Number(c.valor)) : "—"}
                      </td>
                      <td className="td-cell">{c.vencimento ? paraBr(c.vencimento) : "—"}</td>
                      <td className="td-cell">
                        <StatusPill
                          tone={tonePorStatus(
                            c.status_operador,
                            Boolean(c.status_operador && bloqueiaPorValor.get(c.status_operador)),
                          )}
                        >
                          {c.status_operador
                            ? rotuloPorValor.get(c.status_operador) || c.status_operador
                            : "Sem tratativa"}
                        </StatusPill>
                      </td>
                      <td className="td-cell">
                        <Botao
                          variante="ghost"
                          tamanho="sm"
                          onClick={() => setClienteEmTratativa(c)}
                        >
                          <ClipboardList className="size-3.5" /> Registrar
                        </Botao>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TabelaWrap>
              <Paginacao
                paginaAtual={pagina}
                totalPaginas={totalPaginas}
                totalItens={total}
                tamanhoPagina={TAMANHO_PAGINA}
                onMudarPagina={setPagina}
              />
            </>
          )}
        </SectionCard>
      </div>

      <RegistrarTratativaDialog
        cliente={clienteEmTratativa}
        statusCatalogo={statusCatalogo || []}
        onOpenChange={(v) => {
          if (!v) setClienteEmTratativa(null);
        }}
        onRegistrado={recarregarTudo}
      />
    </AppShell>
  );
}
