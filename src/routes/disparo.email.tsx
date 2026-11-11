import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  FileText,
  Loader2,
  Mail,
  RefreshCcw,
  Send,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { MetricCard } from "@/components/shared/MetricCard";
import { StatusPill, type Tone } from "@/components/shared/StatusPill";
import {
  Aviso,
  Botao,
  Busca,
  Campo,
  FiltroChips,
  LinhasEsqueleto,
  Paginacao,
  Rotulo,
  TabelaWrap,
} from "@/components/shared/Controls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { api, abrirArquivoProtegido } from "@/api";
import { formatoMoeda } from "@/lib/utils";
import type {
  LinhaFaturaEmail,
  ResumoLoteEmail,
  StatusEnvioEmail,
} from "@/lib/emailTipos";

// [2026-11] Envio da fatura Claro por e-mail ANTES do vencimento. O EnnyChat (extensão) só alimenta cadastro e PDF
// validado; o operador inicia o envio AQUI. Backend: Backend-Trabalho/src/routes/disparoEmail.routes.js.
export const Route = createFileRoute("/disparo/email")({
  head: () => ({
    meta: [
      { title: "Disparo / E-mail — Voxcel Faturas" },
      {
        name: "description",
        content: "Envie a fatura em PDF por e-mail antes do vencimento.",
      },
    ],
  }),
  component: DisparoEmail,
});

const TAMANHO_PAGINA = 50;

const ROTULO_STATUS: Record<StatusEnvioEmail, string> = {
  na_fila: "Na fila",
  processando: "Processando",
  aceito: "Aceito pela Brevo",
  entregue: "Entregue",
  devolvido: "Devolvido",
  falhou: "Falhou",
  cancelado: "Cancelado",
};
const TOM_STATUS: Record<StatusEnvioEmail, Tone> = {
  na_fila: "muted",
  processando: "info",
  aceito: "brand",
  entregue: "success",
  devolvido: "warning",
  falhou: "danger",
  cancelado: "neutral",
};
const ORDEM_STATUS: StatusEnvioEmail[] = [
  "na_fila",
  "processando",
  "aceito",
  "entregue",
  "devolvido",
  "falhou",
  "cancelado",
];

type Filtro = "elegiveis" | "pendencias" | "todas";

function DisparoEmail() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState(""); // com debounce: uma consulta por pausa, não por tecla
  const [filtro, setFiltro] = useState<Filtro>("elegiveis");
  const [pagina, setPagina] = useState(1);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [todos, setTodos] = useState(false); // "Selecionar todos": todas as elegíveis do filtro, até o limite do lote
  const [confirmar, setConfirmar] = useState(false);
  const [reenviar, setReenviar] = useState<LinhaFaturaEmail | null>(null);

  function limparSelecao() {
    setSelecionados(new Set());
    setTodos(false);
  }
  const limparSelecaoRef = useRef(limparSelecao);
  limparSelecaoRef.current = limparSelecao;

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaAplicada((atual) => {
        if (atual !== busca) {
          setPagina(1);
          limparSelecaoRef.current();
        }
        return busca;
      });
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const lotesQ = useQuery({
    queryKey: ["email-lotes"],
    queryFn: () => api.disparoEmail.lotes(),
    // rodando: acompanha de perto; depois, devagar enquanto ainda chegam eventos de entrega (webhook) dos aceitos
    refetchInterval: (q) => {
      const lotes = q.state.data?.itens ?? [];
      if (lotes.some((l) => l.status === "em_andamento")) return 3000;
      return lotes.some((l) => l.contagens.aceito > 0) ? 30_000 : false;
    },
  });
  const emAndamento = (lotesQ.data?.itens ?? []).some(
    (l) => l.status === "em_andamento",
  );
  const aguardandoEntrega = (lotesQ.data?.itens ?? []).some(
    (l) => l.contagens.aceito > 0,
  );
  const intervalo = emAndamento ? 4000 : aguardandoEntrega ? 30_000 : false;

  const painelQ = useQuery({
    queryKey: ["email-config"],
    queryFn: () => api.disparoEmail.config(),
    staleTime: 10_000,
    refetchInterval: intervalo, // saldo e "aceitas" andam junto com o lote
  });
  const painel = painelQ.data;
  const faturasQ = useQuery({
    queryKey: ["email-faturas", buscaAplicada, filtro, pagina],
    queryFn: () =>
      api.disparoEmail.faturas({
        busca: buscaAplicada.trim() || undefined,
        filtro,
        limit: TAMANHO_PAGINA,
        offset: (pagina - 1) * TAMANHO_PAGINA,
      }),
    staleTime: 5_000,
    refetchInterval: intervalo,
  });

  const limiteLote = painel?.limite_por_lote ?? 300;
  const totalElegiveis = faturasQ.data?.total_elegiveis ?? 0;
  const totalSelecionado = todos
    ? Math.min(totalElegiveis, limiteLote)
    : selecionados.size;
  const saldo = painel?.saldo.disponivel ?? 0;
  const excedeSaldo = totalSelecionado > saldo;
  const disponivel = painel?.disponibilidade.configurado === true;

  function alternar(id: string) {
    if (todos) return;
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else if (novo.size >= limiteLote)
        toast.error(`O lote aceita no máximo ${limiteLote} faturas.`);
      else novo.add(id);
      return novo;
    });
  }

  const disparo = useMutation({
    mutationFn: (p: Parameters<typeof api.disparoEmail.criarLote>[0]) =>
      api.disparoEmail.criarLote(p),
    onSuccess: (r, vars) => {
      toast.success(
        `Lote criado com ${r.total} fatura(s)${r.truncado ? ` (de ${r.total_filtrado} elegíveis; o limite por lote é ${limiteLote})` : ""}.`,
      );
      if (!("reenvio" in vars && vars.reenvio)) limparSelecao(); // reenvio não apaga a seleção em andamento
      void qc.invalidateQueries({ queryKey: ["email-lotes"] });
      void qc.invalidateQueries({ queryKey: ["email-config"] });
      void qc.invalidateQueries({ queryKey: ["email-faturas"] });
    },
    onError: (e) => {
      toast.error((e as Error).message);
      limparSelecao(); // a lista mudou no servidor: não confirma de novo com seleção velha
      void qc.invalidateQueries({ queryKey: ["email-config"] });
      void qc.invalidateQueries({ queryKey: ["email-faturas"] });
    },
  });

  function disparar() {
    setConfirmar(false);
    if (disparo.isPending) return; // duplo clique
    disparo.mutate(
      todos
        ? { modo: "todos", busca: buscaAplicada.trim() || undefined }
        : { modo: "ids", ids: [...selecionados] },
    );
  }

  const itens = faturasQ.data?.itens ?? [];
  useEffect(() => {
    // ids selecionados que deixaram de ser elegíveis (nesta página) saem da seleção
    const inelegiveis = new Set(
      (faturasQ.data?.itens ?? [])
        .filter((i) => !i.elegivel)
        .map((i) => i.cliente_id),
    );
    setSelecionados((atual) => {
      const novo = new Set([...atual].filter((id) => !inelegiveis.has(id)));
      return novo.size === atual.size ? atual : novo;
    });
  }, [faturasQ.data]);
  const total = faturasQ.data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA));
  useEffect(() => {
    if (faturasQ.data && pagina > totalPaginas) setPagina(totalPaginas); // lista encolheu: volta à última página
  }, [faturasQ.data, pagina, totalPaginas]);
  const elegiveisNaPagina = itens.filter((i) => i.elegivel);
  const paginaMarcada =
    elegiveisNaPagina.length > 0 &&
    elegiveisNaPagina.every((i) => todos || selecionados.has(i.cliente_id));

  return (
    <AppShell
      title="Disparo / E-mail"
      subtitle="Envie a fatura em PDF por e-mail antes do vencimento. O cadastro e o PDF validado (OS, nome e vencimento) vêm do EnnyChat."
    >
      <div className="flex flex-col gap-4">
        {painelQ.error && (
          <Aviso tone="danger">{(painelQ.error as Error).message}</Aviso>
        )}
        {painel && !disponivel && (
          <Aviso tone="warning">
            O envio de e-mail ainda não está disponível: falta configurar no
            ambiente do backend{" "}
            <strong>{painel.disponibilidade.faltando.join(", ")}</strong>. Você
            já pode conferir a lista e as configurações.
          </Aviso>
        )}
        {painel &&
          disponivel &&
          !painel.disponibilidade.webhook_configurado && (
            <Aviso tone="info">
              Webhook da Brevo não configurado (BREVO_WEBHOOK_TOKEN): os envios
              serão aceitos, mas “entregue” e “devolvido” não vão aparecer.
            </Aviso>
          )}
        {painel &&
          disponivel &&
          !painel.disponibilidade.nome_empresa_definido && (
            <Aviso tone="warning">
              Defina o Nome da empresa em “Configurações do e-mail” abaixo antes
              de disparar.
            </Aviso>
          )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Elegíveis (busca atual)"
            valor={faturasQ.data ? totalElegiveis : null}
            carregando={faturasQ.isLoading}
            icon={Mail}
          />
          <MetricCard
            label="Selecionadas"
            valor={totalSelecionado}
            carregando={false}
            icon={Send}
            destaque
          />
          <MetricCard
            label="Saldo diário da Brevo"
            valor={
              painel
                ? `${painel.saldo.disponivel} / ${painel.saldo.limite_diario}`
                : null
            }
            carregando={painelQ.isLoading}
            icon={FileText}
          />
          <MetricCard
            label="Limite por lote"
            valor={limiteLote}
            carregando={false}
            icon={Settings2}
          />
        </div>
        {painel && (
          <p className="text-subtle -mt-2 text-xs">{painel.saldo.aviso}</p>
        )}

        <SectionCard
          titulo="Faturas"
          descricao="Uma linha por fatura. Só entram no lote padrão as elegíveis; as pendências mostram o que falta."
          acoes={
            <div className="flex flex-wrap items-center gap-2">
              <FiltroChips
                valor={filtro}
                onChange={(v) => {
                  setFiltro(v);
                  setPagina(1);
                  limparSelecao();
                }}
                opcoes={[
                  { valor: "elegiveis", label: "Elegíveis" },
                  { valor: "pendencias", label: "Pendências" },
                  { valor: "todas", label: "Todas" },
                ]}
              />
              <Busca
                placeholder="Nome, e-mail ou OS…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          }
          flush
        >
          <div className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-5">
            <Botao
              tamanho="sm"
              variante="outline"
              disabled={filtro === "pendencias" || totalElegiveis === 0}
              onClick={() => {
                setSelecionados(new Set());
                setTodos(true);
              }}
            >
              Selecionar todos ({Math.min(totalElegiveis, limiteLote)})
            </Botao>
            <Botao
              tamanho="sm"
              variante="ghost"
              disabled={totalSelecionado === 0}
              onClick={limparSelecao}
            >
              Limpar seleção
            </Botao>
            {todos && totalElegiveis > limiteLote && (
              <span className="text-warning text-xs">
                {limiteLote} de {totalElegiveis} elegíveis selecionadas (limite
                por lote).
              </span>
            )}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs" aria-live="polite">
                <strong>{totalSelecionado}</strong> selecionada(s)
              </span>
              <Botao
                variante="primary"
                disabled={
                  !disponivel ||
                  !painel?.disponibilidade.nome_empresa_definido ||
                  totalSelecionado === 0 ||
                  excedeSaldo ||
                  disparo.isPending
                }
                onClick={() => setConfirmar(true)}
              >
                {disparo.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Disparar ({totalSelecionado})
              </Botao>
            </div>
          </div>
          {excedeSaldo && painel && (
            <div className="px-4 pt-3 sm:px-5">
              <Aviso tone="warning">
                O saldo diário comporta só <strong>{saldo}</strong> envio(s).
                Reduza a seleção; o excedente não é agendado para outro dia.
              </Aviso>
            </div>
          )}

          {faturasQ.isLoading ? (
            <TabelaWrap>
              <tbody>
                <LinhasEsqueleto colunas={8} linhas={6} />
              </tbody>
            </TabelaWrap>
          ) : faturasQ.error ? (
            <div className="p-4">
              <Aviso tone="danger">{(faturasQ.error as Error).message}</Aviso>
            </div>
          ) : itens.length === 0 ? (
            <EmptyState
              icon={Mail}
              titulo={
                busca
                  ? "Nada encontrado"
                  : filtro === "elegiveis"
                    ? "Nenhuma fatura elegível agora"
                    : "Nada por aqui"
              }
              descricao="Faturas chegam pela extensão do EnnyChat (Tratar + PDF anexado). Veja a aba Pendências para entender o que falta."
            />
          ) : (
            <>
              <TabelaWrap>
                <thead>
                  <tr className="border-border text-subtle border-b">
                    <th className="th-cell w-8">
                      <Checkbox
                        aria-label="Marcar elegíveis desta página"
                        checked={paginaMarcada}
                        disabled={todos || elegiveisNaPagina.length === 0}
                        onCheckedChange={(v) => {
                          const marcar = v === true;
                          const novo = new Set(selecionados);
                          let cortou = false;
                          for (const i of elegiveisNaPagina) {
                            if (!marcar) novo.delete(i.cliente_id);
                            else if (novo.size < limiteLote)
                              novo.add(i.cliente_id);
                            else cortou = true;
                          }
                          if (cortou)
                            toast.error(
                              `O lote aceita no máximo ${limiteLote} faturas.`,
                            );
                          setSelecionados(novo);
                        }}
                      />
                    </th>
                    <th className="th-cell">Cliente</th>
                    <th className="th-cell">E-mail</th>
                    <th className="th-cell">OS</th>
                    <th className="th-cell">Valor</th>
                    <th className="th-cell">Vencimento</th>
                    <th className="th-cell">PDF</th>
                    <th className="th-cell">Envios</th>
                    <th className="th-cell">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((l) => (
                    <tr key={l.cliente_id} className="border-border border-t">
                      <td className="td-cell">
                        <Checkbox
                          aria-label={`Selecionar ${l.nome}`}
                          checked={
                            todos
                              ? l.elegivel &&
                                (l.ordem_elegivel ?? Infinity) <= limiteLote
                              : selecionados.has(l.cliente_id)
                          }
                          disabled={!l.elegivel || todos}
                          onCheckedChange={() => alternar(l.cliente_id)}
                        />
                      </td>
                      <td className="td-cell font-medium">{l.nome}</td>
                      <td className="td-cell text-xs">{l.email ?? "—"}</td>
                      <td className="td-cell font-mono text-xs">
                        {l.os_numero ?? "—"}
                      </td>
                      <td className="td-cell">
                        {l.valor ? formatoMoeda.format(Number(l.valor)) : "—"}
                      </td>
                      <td className="td-cell">{l.vencimento ?? "—"}</td>
                      <td className="td-cell">
                        {l.pdf_url ? (
                          <Botao
                            variante="ghost"
                            tamanho="sm"
                            aria-label={`Ver PDF de ${l.nome}`}
                            onClick={() =>
                              void abrirArquivoProtegido(l.pdf_url)
                            }
                          >
                            <FileText className="size-3.5" /> Ver
                          </Botao>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className="td-cell text-xs"
                        title="Aceitas para envio / tentativas técnicas"
                      >
                        {l.aceitos} aceita(s) · {l.tentativas} tent.
                        {l.ultimo_status && (
                          <StatusPill
                            tone={TOM_STATUS[l.ultimo_status]}
                            className="ml-1.5"
                          >
                            {ROTULO_STATUS[l.ultimo_status]}
                          </StatusPill>
                        )}
                      </td>
                      <td className="td-cell text-xs">
                        {l.elegivel ? (
                          <StatusPill tone="success">Elegível</StatusPill>
                        ) : (
                          <div className="flex flex-col items-start gap-1">
                            {l.motivos_texto.map((m) => (
                              <StatusPill key={m} tone="warning">
                                {m}
                              </StatusPill>
                            ))}
                            {l.motivos.length > 0 &&
                              l.motivos.every((m) => m === "ja_enviado") &&
                              disponivel && (
                                <Botao
                                  variante="ghost"
                                  tamanho="sm"
                                  aria-label={`Reenviar para ${l.nome}`}
                                  onClick={() => setReenviar(l)}
                                >
                                  <RefreshCcw className="size-3.5" /> Reenviar
                                </Botao>
                              )}
                          </div>
                        )}
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

        <Lotes lotes={lotesQ.data?.itens ?? []} carregando={lotesQ.isLoading} />
        <ConfiguracoesEmail />
      </div>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Enviar {totalSelecionado} e-mail(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cada fatura vai para o e-mail cadastrado dela, com o PDF
              correspondente. O servidor revalida cada uma antes de enviar. Nome
              da empresa neste lote: <strong>{painel?.nome_empresa}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={disparar}>Disparar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(reenviar)}
        onOpenChange={(v) => !v && setReenviar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reenviar para {reenviar?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta fatura já foi aceita para envio {reenviar?.aceitos} vez(es).
              O reenvio é intencional e fica contado à parte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (reenviar && !disparo.isPending)
                  disparo.mutate({
                    modo: "ids",
                    ids: [reenviar.cliente_id],
                    reenvio: true,
                  });
                setReenviar(null);
              }}
            >
              Reenviar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Lotes({
  lotes,
  carregando,
}: {
  lotes: ResumoLoteEmail[];
  carregando: boolean;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState<string | null>(null);
  const detalhe = useQuery({
    queryKey: ["email-lote", aberto],
    queryFn: () => api.disparoEmail.lote(aberto as string),
    enabled: Boolean(aberto),
    refetchInterval: 4000,
  });
  const cancelar = useMutation({
    mutationFn: (id: string) => api.disparoEmail.cancelarLote(id),
    onSuccess: () => {
      toast.success(
        "Fila cancelada. O que já foi aceito pela Brevo não é desfeito.",
      );
      void qc.invalidateQueries({ queryKey: ["email-lotes"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <SectionCard
      titulo="Lotes e acompanhamento"
      descricao="Entrega só aparece quando o evento da Brevo chega (webhook)."
      flush
    >
      {carregando ? (
        <TabelaWrap>
          <tbody>
            <LinhasEsqueleto colunas={4} linhas={2} />
          </tbody>
        </TabelaWrap>
      ) : lotes.length === 0 ? (
        <EmptyState
          compacto
          icon={Send}
          titulo="Nenhum lote ainda"
          descricao="Selecione faturas e clique em Disparar."
        />
      ) : (
        <ul className="divide-border divide-y">
          {lotes.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">
                  {new Date(l.criado_em).toLocaleString("pt-BR")}
                </span>
                <StatusPill
                  tone={
                    l.status === "em_andamento"
                      ? "info"
                      : l.status === "cancelado"
                        ? "neutral"
                        : "success"
                  }
                  dot
                  pulse={l.status === "em_andamento"}
                >
                  {l.status === "em_andamento"
                    ? "Em andamento"
                    : l.status === "cancelado"
                      ? "Cancelado"
                      : "Concluído"}
                </StatusPill>
                {l.reenvio && <StatusPill tone="warning">Reenvio</StatusPill>}
                <span className="text-subtle">
                  {l.processados}/{l.total} processadas · {l.aceitos_para_envio}{" "}
                  aceita(s) · {l.tentativas_tecnicas} tentativa(s) técnica(s)
                </span>
                <div className="ml-auto flex gap-1.5">
                  <Botao
                    tamanho="sm"
                    variante="ghost"
                    aria-expanded={aberto === l.id}
                    onClick={() => setAberto(aberto === l.id ? null : l.id)}
                  >
                    {aberto === l.id ? "Ocultar" : "Detalhes"}
                  </Botao>
                  {l.status === "em_andamento" && (
                    <Botao
                      tamanho="sm"
                      variante="danger"
                      disabled={cancelar.isPending}
                      onClick={() => cancelar.mutate(l.id)}
                    >
                      <Ban className="size-3.5" /> Cancelar fila
                    </Botao>
                  )}
                </div>
              </div>
              <Progress
                aria-label={`Progresso do lote: ${l.processados} de ${l.total}`}
                value={l.total ? (l.processados / l.total) * 100 : 0}
                className="h-1.5"
              />
              <div className="flex flex-wrap gap-1.5">
                {ORDEM_STATUS.filter((s) => l.contagens[s] > 0).map((s) => (
                  <StatusPill key={s} tone={TOM_STATUS[s]}>
                    {ROTULO_STATUS[s]}: {l.contagens[s]}
                  </StatusPill>
                ))}
              </div>
              {aberto === l.id && (
                <div className="border-border mt-1 max-h-72 overflow-y-auto rounded-md border">
                  <TabelaWrap compact>
                    <tbody>
                      {(detalhe.data?.itens ?? []).map((i) => (
                        <tr
                          key={i.id}
                          className="border-border border-t first:border-t-0"
                        >
                          <td className="td-cell truncate text-xs font-medium">
                            {i.nome ?? "—"}
                          </td>
                          <td className="td-cell truncate text-xs">
                            {i.email}
                          </td>
                          <td className="td-cell text-xs">
                            <StatusPill tone={TOM_STATUS[i.status]}>
                              {ROTULO_STATUS[i.status]}
                            </StatusPill>
                            {i.motivo && (
                              <span className="text-subtle ml-1.5">
                                {i.motivo}
                              </span>
                            )}
                          </td>
                          <td className="td-cell text-subtle text-xs">
                            {i.tentativas} tent.
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </TabelaWrap>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ConfiguracoesEmail() {
  const qc = useQueryClient();
  const painel = useQuery({
    queryKey: ["email-config"],
    queryFn: () => api.disparoEmail.config(),
    staleTime: 10_000,
  }).data;
  const [nome, setNome] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<Set<string> | null>(null);

  const iniciado = useRef(false);
  useEffect(() => {
    if (painel && !iniciado.current) {
      iniciado.current = true;
      setNome(painel.nome_empresa);
    }
  }, [painel]);
  const nomeInvalido =
    /[<>]/.test(nome) || [...nome].some((c) => c.charCodeAt(0) < 32); // o backend recusa < > e controles
  const aceitosAtuais = status ?? new Set(painel?.status_aceitos ?? []);

  const salvarNome = useMutation({
    mutationFn: () => api.disparoEmail.salvarConfig({ nome_empresa: nome }),
    onSuccess: () => {
      toast.success("Nome da empresa salvo. Vale para os próximos lotes.");
      void qc.invalidateQueries({ queryKey: ["email-config"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const previa = useMutation({
    mutationFn: () =>
      api.disparoEmail.preview({ nome_empresa: nome.trim() || undefined }),
    onSuccess: (r) => setHtml(r.html),
    onError: (e) => toast.error((e as Error).message),
  });
  const salvarStatus = useMutation({
    mutationFn: () => api.ennychat.salvarStatusAceitos([...aceitosAtuais]),
    onSuccess: () => {
      toast.success(
        "Status aceitos salvos. Valem também para lotes em andamento.",
      );
      setStatus(null);
      void qc.invalidateQueries({ queryKey: ["email-config"] });
      void qc.invalidateQueries({ queryKey: ["email-faturas"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <SectionCard
      titulo="Configurações do e-mail"
      descricao="Nome da empresa no cabeçalho do e-mail e status do EnnyChat que podem entrar no sistema."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div>
            <Rotulo htmlFor="email-nome-empresa">Nome da empresa</Rotulo>
            <Campo
              id="email-nome-empresa"
              value={nome}
              maxLength={80}
              onChange={(e) => {
                setNome(e.target.value);
                setHtml(null); // a prévia deixou de refletir o nome digitado
              }}
              placeholder="Ex.: Minha Empresa Ltda"
            />
            <p className="text-subtle mt-1 text-xs">
              Fica fixado em cada lote no momento do disparo; editar depois não
              muda e-mails em andamento.
            </p>
          </div>
          <div className="flex gap-2">
            <Botao
              variante="primary"
              disabled={!nome.trim() || nomeInvalido || salvarNome.isPending}
              onClick={() => salvarNome.mutate()}
            >
              Salvar
            </Botao>
            <Botao
              variante="outline"
              disabled={previa.isPending}
              onClick={() => previa.mutate()}
            >
              {previa.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileText className="size-4" />
              )}{" "}
              Prévia do e-mail
            </Botao>
          </div>
          {html && (
            <iframe
              title="Prévia do e-mail"
              sandbox=""
              srcDoc={html}
              className="border-border h-[28rem] w-full rounded-md border bg-white"
            />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <p className="label-eyebrow mb-1.5">Status aceitos do EnnyChat</p>
            <p className="text-subtle text-xs">
              Só faturas com status marcado entram. Lista vazia = nada entra. Os
              status aparecem aqui quando a extensão os vê em “Tratar”.
            </p>
          </div>
          {(painel?.catalogo.length ?? 0) === 0 ? (
            <Aviso tone="info">
              Nenhum status conhecido ainda. Abra uma ficha em “Tratar” no
              EnnyChat com a extensão ativa.
            </Aviso>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {painel?.catalogo.map((c) => (
                <li key={c.codigo} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`st-${c.codigo}`}
                    checked={aceitosAtuais.has(c.codigo)}
                    onCheckedChange={(v) => {
                      const novo = new Set(aceitosAtuais);
                      if (v === true) novo.add(c.codigo);
                      else novo.delete(c.codigo);
                      setStatus(novo);
                    }}
                  />
                  <label htmlFor={`st-${c.codigo}`}>
                    {c.rotulo}
                    {c.rotulo !== c.codigo && (
                      <span className="text-subtle ml-1 font-mono text-xs">
                        ({c.codigo})
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Botao
              variante="primary"
              disabled={status === null || salvarStatus.isPending}
              onClick={() => salvarStatus.mutate()}
            >
              Salvar status aceitos
            </Botao>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
