import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Download,
  FlaskConical,
  Loader2,
  Paperclip,
  Play,
  RotateCcw,
  Send,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Botao, Aviso } from "@/components/shared/Controls";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppState } from "@/lib/app-state";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { statusDoItem, VARIAVEIS_MENSAGEM, type EstrategiaEnvio, type WhatsappSlot } from "@/lib/types";

export const Route = createFileRoute("/disparos")({
  head: () => ({
    meta: [
      { title: "Disparo de faturas — Veloce Faturas" },
      {
        name: "description",
        content:
          "Monte e acompanhe um lote de disparo de faturas via WhatsApp: destinatários, mensagem, conexão, estratégia, agendamento e progresso em tempo real.",
      },
      { property: "og:title", content: "Disparo de faturas — Veloce Faturas" },
      {
        property: "og:description",
        content: "Passo a passo do disparo: destinatários, mensagem, conexão, estratégia e progresso.",
      },
    ],
  }),
  component: Disparo,
});

const ESTRATEGIAS: { valor: EstrategiaEnvio; label: string; descricao: string }[] = [
  { valor: "qualquer", label: "Qualquer conexão", descricao: "Usa a primeira conexão disponível" },
  { valor: "slot_1", label: "Somente WhatsApp 1", descricao: "Todas as mensagens saem pelo slot 1" },
  { valor: "slot_2", label: "Somente WhatsApp 2", descricao: "Todas as mensagens saem pelo slot 2" },
  { valor: "round_robin", label: "Alternar (round robin)", descricao: "Alterna entre as conexões disponíveis" },
];

/* -------------------------------------------------------------------------- */
/* 1. Destinatários                                                           */
/* -------------------------------------------------------------------------- */

function EtapaDestinatarios() {
  const { selecionados, toggleSelecionado, limparSelecionados, clientes } = useAppState();
  const clientesSelecionados = clientes.filter((c) => selecionados.includes(c.id));

  return (
    <SectionCard
      eyebrow="Etapa 1"
      titulo="Destinatários"
      descricao={
        selecionados.length > 0
          ? `${selecionados.length} cliente(s) selecionado(s) para este lote.`
          : undefined
      }
      acoes={
        selecionados.length > 0 ? (
          <Botao variante="ghost" tamanho="sm" onClick={limparSelecionados}>
            Limpar seleção
          </Botao>
        ) : undefined
      }
    >
      {selecionados.length === 0 ? (
        <EmptyState
          icon={Users}
          titulo="Nenhum cliente selecionado"
          descricao="Selecione clientes na aba Clientes para montar o lote de disparo."
          acao={
            <Link to="/clientes">
              <Botao variante="primary" tamanho="sm">
                Ir para Clientes
              </Botao>
            </Link>
          }
        />
      ) : (
        <ul className="divide-border max-h-72 divide-y overflow-y-auto rounded-md border border-border">
          {clientesSelecionados.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.nome}</p>
                <p className="text-subtle truncate font-mono text-xs">{c.telefone}</p>
              </div>
              <button
                onClick={() => toggleSelecionado(c.id)}
                aria-label={`Remover ${c.nome}`}
                className="text-subtle hover:text-destructive shrink-0 p-1"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Mensagem                                                                */
/* -------------------------------------------------------------------------- */

function EtapaMensagem({
  template,
  setTemplate,
}: {
  template: string;
  setTemplate: (v: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function inserirToken(token: string) {
    const el = textareaRef.current;
    if (!el) {
      setTemplate(template + token);
      return;
    }
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    const proximo = template.slice(0, start) + token + template.slice(end);
    setTemplate(proximo);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  return (
    <SectionCard eyebrow="Etapa 2" titulo="Mensagem" descricao="Template usado para todos os destinatários do lote.">
      <textarea
        ref={textareaRef}
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        rows={5}
        className="bg-surface text-foreground border-border focus-ring w-full rounded-md border px-3 py-2 text-sm"
      />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {VARIAVEIS_MENSAGEM.map((v) => (
          <button
            key={v.token}
            type="button"
            title={v.descricao}
            onClick={() => inserirToken(v.token)}
            className="bg-primary-soft text-primary-strong hover:bg-primary/20 focus-ring rounded-full px-2.5 py-1 font-mono text-xs font-medium transition-colors"
          >
            {v.token}
          </button>
        ))}
      </div>
      <p className="text-subtle mt-3 text-[11px]">
        A substituição dos valores acima por dados reais de cada cliente é feita pelo backend no momento do envio.
      </p>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Anexo                                                                   */
/* -------------------------------------------------------------------------- */

function EtapaAnexo({ comPdf, setComPdf }: { comPdf: boolean; setComPdf: (v: boolean) => void }) {
  return (
    <SectionCard eyebrow="Etapa 3" titulo="Anexo">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={comPdf}
          onChange={(e) => setComPdf(e.target.checked)}
          className="accent-primary mt-0.5 size-4"
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Paperclip className="size-3.5" /> Enviar PDF da fatura
          </span>
          <span className="text-muted-foreground block text-xs">
            O arquivo é o PDF já cadastrado em cada cliente. Clientes sem PDF cadastrado recebem só a mensagem de texto.
          </span>
        </span>
      </label>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* 4/5. WhatsApp e Estratégia                                                 */
/* -------------------------------------------------------------------------- */

function EtapaConexaoEstrategia({
  estrategiaEscolhida,
  setEstrategiaEscolhida,
}: {
  estrategiaEscolhida: EstrategiaEnvio;
  setEstrategiaEscolhida: (v: EstrategiaEnvio) => void;
}) {
  const { conexoes, conexoesCarregando, estrategia } = useAppState();

  return (
    <SectionCard eyebrow="Etapas 4 e 5" titulo="WhatsApp e estratégia" descricao="Escolha como as mensagens serão distribuídas entre as conexões.">
      <div className="mb-5">
        <p className="label-eyebrow mb-2">Conexões disponíveis</p>
        {conexoesCarregando ? (
          <p className="text-subtle text-xs">Carregando conexões…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {conexoes.map((c) => (
              <div
                key={c.slot}
                className="border-border flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs"
              >
                <Wifi
                  className={cn(
                    "size-3.5 shrink-0",
                    c.status === "connected" ? "text-success" : "text-subtle",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">WhatsApp {c.slot}</p>
                  <p className="text-subtle truncate">{c.telefone ?? (c.configurada ? "sem número" : "não configurado")}</p>
                </div>
                <StatusBadgeSimples status={c.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="label-eyebrow mb-2">Estratégia de envio</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {ESTRATEGIAS.map((op) => (
          <button
            key={op.valor}
            type="button"
            onClick={() => setEstrategiaEscolhida(op.valor)}
            className={cn(
              "focus-ring rounded-md border px-3 py-2.5 text-left text-xs transition-colors",
              estrategiaEscolhida === op.valor
                ? "border-primary bg-primary-soft text-primary-strong"
                : "border-border text-foreground hover:bg-surface-raised",
            )}
          >
            <span className="block font-medium">{op.label}</span>
            <span className="text-muted-foreground block">{op.descricao}</span>
          </button>
        ))}
      </div>

      {estrategiaEscolhida === "round_robin" && estrategia?.next_slot != null && (
        <p className="text-info mt-3 text-xs">Próximo envio: WhatsApp {estrategia.next_slot}</p>
      )}
    </SectionCard>
  );
}

function StatusBadgeSimples({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    connected: { label: "Conectado", cls: "text-success" },
    qr: { label: "Aguardando QR", cls: "text-warning" },
    connecting: { label: "Conectando", cls: "text-warning" },
    disconnected: { label: "Desconectado", cls: "text-subtle" },
  };
  const s = map[status] ?? map["disconnected"]!;
  return <span className={cn("shrink-0 text-[11px] font-medium", s.cls)}>{s.label}</span>;
}

/* -------------------------------------------------------------------------- */
/* 6. Intervalo de disparo                                                   */
/* -------------------------------------------------------------------------- */

function EtapaIntervalo({
  janelaHoras,
  setJanelaHoras,
  janelaMinutos,
  setJanelaMinutos,
}: {
  janelaHoras: string;
  setJanelaHoras: (v: string) => void;
  janelaMinutos: string;
  setJanelaMinutos: (v: string) => void;
}) {
  const horas = Number(janelaHoras) || 0;
  const minutos = Number(janelaMinutos) || 0;
  const ativo = horas > 0 || minutos > 0;

  return (
    <SectionCard
      eyebrow="Etapa 6"
      titulo="Intervalo de disparo"
      descricao='Opcional: espalha o lote inteiro dentro de uma janela de tempo (ex: "5 horas" -- a primeira mensagem sai já, a última antes das 5h fecharem), em vez do intervalo padrão entre mensagens. Reduz risco de queda do WhatsApp em lotes grandes.'
    >
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="label-eyebrow">Horas</span>
          <input
            type="number"
            min={0}
            value={janelaHoras}
            onChange={(e) => setJanelaHoras(e.target.value)}
            placeholder="0"
            className="bg-surface text-foreground border-border focus-ring h-9 w-24 rounded-md border px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-eyebrow">Minutos</span>
          <input
            type="number"
            min={0}
            max={59}
            value={janelaMinutos}
            onChange={(e) => setJanelaMinutos(e.target.value)}
            placeholder="0"
            className="bg-surface text-foreground border-border focus-ring h-9 w-24 rounded-md border px-3 text-sm"
          />
        </label>
        <p className="text-subtle mb-2 text-xs">
          {ativo
            ? `Mensagens espalhadas ao longo de ${horas > 0 ? `${horas}h` : ""}${minutos > 0 ? `${minutos}min` : ""}.`
            : "Sem janela definida: usa o intervalo padrão entre mensagens (comportamento atual)."}
        </p>
      </div>
      <p className="text-subtle mt-3 text-xs">
        Também vale ao continuar um lote pausado -- se sobrarem itens, eles dividem essa mesma
        duração a partir do momento em que você continuar.
      </p>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* 7. Agendamento                                                             */
/* -------------------------------------------------------------------------- */

function EtapaAgendamento({
  agendarPara,
  setAgendarPara,
}: {
  agendarPara: string;
  setAgendarPara: (v: string) => void;
}) {
  return (
    <SectionCard eyebrow="Etapa 7" titulo="Agendamento" descricao="Opcional: defina uma data/hora para iniciar o disparo automaticamente.">
      <label className="flex flex-col gap-1.5 sm:w-64">
        <span className="label-eyebrow flex items-center gap-1.5">
          <Calendar className="size-3.5" /> Data e hora
        </span>
        <input
          type="datetime-local"
          value={agendarPara}
          onChange={(e) => setAgendarPara(e.target.value)}
          className="bg-surface text-foreground border-border focus-ring h-9 rounded-md border px-3 text-sm"
        />
      </label>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialog de confirmação                                                     */
/* -------------------------------------------------------------------------- */

function ConfirmarDisparo({
  aberto,
  onOpenChange,
  totalClientes,
  conexaoResumo,
  comPdf,
  agendarPara,
  onConfirmar,
  confirmando,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  totalClientes: number;
  conexaoResumo: string;
  comPdf: boolean;
  agendarPara: string;
  onConfirmar: () => void;
  confirmando: boolean;
}) {
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar disparo</DialogTitle>
          <DialogDescription>Revise os dados antes de iniciar.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            Você está prestes a enviar para <strong>{totalClientes}</strong> cliente(s).
          </p>
          <p className="text-muted-foreground">Estratégia/conexão: {conexaoResumo}</p>
          <p className="text-muted-foreground">Anexo: {comPdf ? "com PDF da fatura" : "somente mensagem de texto"}</p>
          <p className="text-muted-foreground">
            {agendarPara
              ? `Agendado para ${new Date(agendarPara).toLocaleString("pt-BR")}`
              : "Início imediato"}
          </p>
        </div>
        <DialogFooter>
          <Botao variante="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Botao>
          <Botao variante="primary" onClick={onConfirmar} disabled={confirmando}>
            {confirmando ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Confirmar e iniciar
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Progresso do disparo                                                      */
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
  ultimo_envio_em: string | null;
  proximo_slot: WhatsappSlot | null;
  slot_atual: WhatsappSlot | null;
};

function ProgressoDisparo({
  envioAtivoId,
  setEnvioAtivoId,
}: {
  envioAtivoId: string;
  setEnvioAtivoId: (id: string | null) => void;
}) {
  const [envio, setEnvio] = useState<Awaited<ReturnType<typeof api.envios.buscar>> | null>(null);
  const [progresso, setProgresso] = useState<EnvioProgresso | null>(null);
  const [itens, setItens] = useState<Awaited<ReturnType<typeof api.envios.itens>> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [envioData, progressoData, itensData] = await Promise.all([
        api.envios.buscar(envioAtivoId),
        api.envios.progresso(envioAtivoId),
        // GET /:id/itens é a fonte real da lista (com o join de clientes) --
        // GET /:id (api.envios.buscar) só devolve o resumo/contadores, nunca
        // mandou um campo "itens" -- lendo envio.itens direto sempre foi
        // undefined, só não quebrava com lotes vazios de teste.
        api.envios.itens(envioAtivoId),
      ]);
      setEnvio(envioData);
      setProgresso(progressoData);
      setItens(itensData);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [envioAtivoId]);

  useEffect(() => {
    let cancelado = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      if (cancelado) return;
      await carregar();
    }
    tick();
    interval = setInterval(async () => {
      if (cancelado) return;
      const p = await api.envios.progresso(envioAtivoId).catch(() => null);
      if (cancelado) return;
      if (p) setProgresso(p);
      const [e, i] = await Promise.all([
        api.envios.buscar(envioAtivoId).catch(() => null),
        api.envios.itens(envioAtivoId).catch(() => null),
      ]);
      if (cancelado) return;
      if (e) setEnvio(e);
      if (i) setItens(i);
    }, 3000);

    return () => {
      cancelado = true;
      if (interval) clearInterval(interval);
    };
  }, [envioAtivoId, carregar]);

  async function iniciar() {
    setAcao("iniciar");
    try {
      await api.envios.disparar(envioAtivoId);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAcao(null);
    }
  }

  async function reenviarErros() {
    setAcao("reenviar");
    try {
      await api.envios.reenviarErros(envioAtivoId);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAcao(null);
    }
  }

  const podeIniciar = envio && (envio.status === "pendente" || envio.status === "pausado" || envio.status === "agendado");
  const temErros = (progresso?.falhas ?? 0) > 0 || (progresso?.numeros_invalidos ?? 0) > 0;

  return (
    <SectionCard
      titulo="Progresso do disparo"
      descricao={envio ? `Lote #${envio.id.slice(0, 8)}` : undefined}
      acoes={
        <>
          <Botao variante="secondary" tamanho="sm" onClick={reenviarErros} disabled={acao !== null || !temErros}>
            <RotateCcw className="size-3.5" /> Reenviar erros
          </Botao>
          {podeIniciar && (
            <Botao variante="primary" tamanho="sm" onClick={iniciar} disabled={acao !== null}>
              {acao === "iniciar" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Iniciar lote
            </Botao>
          )}
          <Botao variante="ghost" tamanho="sm" onClick={() => setEnvioAtivoId(null)}>
            Trocar de lote
          </Botao>
        </>
      }
    >
      {erro && (
        <Aviso tone="danger" className="mb-4">
          {erro}
        </Aviso>
      )}

      {carregando && !envio ? (
        <div className="text-subtle flex items-center gap-2 p-8 text-sm">
          <Loader2 className="size-4 animate-spin" /> Carregando lote…
        </div>
      ) : !progresso ? (
        <EmptyState titulo="Sem dados de progresso" descricao="Ainda não há informações de progresso para este lote." compacto />
      ) : (
        <>
          <div className="mb-4 flex items-baseline gap-2">
            <span className="font-display text-2xl font-semibold tabular">
              {progresso.enviados} / {progresso.total}
            </span>
            <span className="text-subtle text-xs">enviados</span>
          </div>
          <Progress value={progresso.total ? (progresso.enviados / progresso.total) * 100 : 0} className="mb-5" />

          <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Metrica label="Entregues" valor={progresso.entregues} />
            <Metrica label="Lidos" valor={progresso.lidos} />
            <Metrica label="Falhas" valor={progresso.falhas} tone="danger" />
            <Metrica label="Inválidos" valor={progresso.numeros_invalidos} tone="warning" />
            <Metrica label="Pendentes" valor={progresso.pendentes} />
          </div>

          <div className="text-subtle flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {progresso.ultimo_envio_em && (
              <span>Último envio: {new Date(progresso.ultimo_envio_em).toLocaleString("pt-BR")}</span>
            )}
            {progresso.slot_atual != null && <span>Slot atual: WhatsApp {progresso.slot_atual}</span>}
            {progresso.proximo_slot != null && <span>Próximo slot: WhatsApp {progresso.proximo_slot}</span>}
          </div>

          {itens && itens.length > 0 ? (
            <div className="mt-6 max-h-96 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-sunken sticky top-0">
                  <tr>
                    <th className="th-cell">Cliente</th>
                    <th className="th-cell">Telefone</th>
                    <th className="th-cell">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item) => (
                    <tr key={item.id} className="border-border border-t">
                      <td className="td-cell">{item.clientes?.nome ?? "—"}</td>
                      <td className="td-cell font-mono text-xs">{item.clientes?.telefone ?? item.erro ?? "—"}</td>
                      <td className="td-cell">
                        <StatusBadge status={statusDoItem(item)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : itens ? (
            <EmptyState titulo="Este lote não tem itens." compacto className="mt-4" />
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

function Metrica({ label, valor, tone }: { label: string; valor: number; tone?: "danger" | "warning" }) {
  return (
    <div>
      <p className="label-eyebrow mb-1">{label}</p>
      <p
        className={cn(
          "font-display tabular text-lg font-semibold",
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
/* Disparo de teste                                                          */
/* -------------------------------------------------------------------------- */

function TesteDisparo({ templateSugerido }: { templateSugerido?: string | undefined }) {
  const { clientes, whatsappStatus } = useAppState();
  const [aberto, setAberto] = useState(false);
  const [destino, setDestino] = useState<"cliente" | "numero">("cliente");
  const [clienteId, setClienteId] = useState("");
  const [telefone, setTelefone] = useState("");
  const [mensagem, setMensagem] = useState(
    templateSugerido ?? "🔔 Teste de disparo. Se você recebeu esta mensagem, o sistema está funcionando.",
  );
  const [comPdf, setComPdf] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  const conectado = whatsappStatus === "connected";
  const podeEnviar =
    conectado && !enviando && (destino === "cliente" ? Boolean(clienteId) : telefone.trim().length >= 8);

  async function enviarTeste() {
    setEnviando(true);
    setResultado(null);
    try {
      const r = await api.envios.teste({
        ...(destino === "cliente" ? { cliente_id: clienteId } : { telefone: telefone.trim() }),
        template_mensagem: mensagem,
        com_pdf: comPdf,
      });
      setResultado({
        ok: true,
        texto: `Mensagem de teste enviada para ${r.telefone}${r.com_pdf ? " (com PDF anexado)" : ""}.`,
      });
    } catch (e) {
      setResultado({ ok: false, texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <SectionCard
      titulo="Disparo de teste"
      descricao="Envie uma única mensagem real para conferir se está tudo funcionando antes de soltar o lote."
      acoes={
        <button
          onClick={() => setAberto((v) => !v)}
          className="text-subtle hover:text-foreground focus-ring rounded p-1"
          aria-label={aberto ? "Recolher" : "Expandir"}
        >
          <ChevronDown className={cn("size-4 transition-transform", aberto && "rotate-180")} />
        </button>
      }
    >
      {aberto && (
        <div className="space-y-4">
          {!conectado && (
            <Aviso tone="warning">O WhatsApp não está conectado. Vá até a aba Conexões e leia o QR Code.</Aviso>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: "cliente", label: "Cliente cadastrado" },
                { id: "numero", label: "Número avulso" },
              ] as const
            ).map((op) => (
              <button
                key={op.id}
                onClick={() => setDestino(op.id)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  destino === op.id
                    ? "bg-primary-soft text-primary-strong"
                    : "text-muted-foreground hover:bg-surface-raised",
                )}
              >
                {op.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {destino === "cliente" ? (
              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">Cliente</span>
                <select
                  value={clienteId}
                  onChange={(e) => setClienteId(e.target.value)}
                  className="bg-surface text-foreground border-border focus-ring h-9 rounded-md border px-3 text-sm"
                >
                  <option value="">Selecione um cliente</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} — {c.telefone}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">Telefone (com DDD)</span>
                <input
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  placeholder="11999999999"
                  inputMode="tel"
                  className="bg-surface text-foreground border-border focus-ring h-9 rounded-md border px-3 text-sm"
                />
              </label>
            )}

            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                checked={comPdf}
                onChange={(e) => setComPdf(e.target.checked)}
                className="accent-primary size-4"
              />
              <span className="text-muted-foreground text-xs">Anexar o PDF do cliente (quando existir)</span>
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="label-eyebrow">Mensagem do teste</span>
            <textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              rows={3}
              className="bg-surface text-foreground border-border focus-ring rounded-md border px-3 py-2 text-sm"
            />
          </label>

          {resultado && <Aviso tone={resultado.ok ? "info" : "danger"}>{resultado.texto}</Aviso>}

          <Botao variante="primary" onClick={enviarTeste} disabled={!podeEnviar}>
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
            Enviar mensagem de teste
          </Botao>
        </div>
      )}
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela principal                                                            */
/* -------------------------------------------------------------------------- */

function Disparo() {
  const { envioAtivoId, setEnvioAtivoId, selecionados, limparSelecionados, estrategia } = useAppState();

  const [template, setTemplate] = useState(
    "Olá {{nome}}, tudo bem? Segue em anexo sua fatura no valor de {{valor}}, com vencimento em {{vencimento}}. Qualquer dúvida estou à disposição!",
  );
  const [comPdf, setComPdf] = useState(true);
  const [estrategiaEscolhida, setEstrategiaEscolhida] = useState<EstrategiaEnvio>(estrategia?.estrategia ?? "qualquer");
  const [janelaHoras, setJanelaHoras] = useState("");
  const [janelaMinutos, setJanelaMinutos] = useState("");
  const [agendarPara, setAgendarPara] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarAberto, setConfirmarAberto] = useState(false);

  useEffect(() => {
    if (estrategia?.estrategia) setEstrategiaEscolhida(estrategia.estrategia);
  }, [estrategia?.estrategia]);

  async function criarEIniciar() {
    setCriando(true);
    setErro(null);
    try {
      const horas = Number(janelaHoras) || 0;
      const minutos = Number(janelaMinutos) || 0;
      const janela_ms = horas > 0 || minutos > 0 ? (horas * 60 + minutos) * 60 * 1000 : undefined;

      const envio = await api.envios.criar({
        cliente_ids: selecionados,
        // NOTA: o backend (POST /envios) espera "mensagem", não "template_mensagem"
        // -- estava divergente aqui, o que fazia a criação sempre falhar com
        // "mensagem é obrigatória" quando disparada direto por essa tela (fora
        // do fluxo de Importar planilha+zip, que usa outro endpoint).
        mensagem: template,
        slot: estrategiaEscolhida === "slot_1" ? 1 : estrategiaEscolhida === "slot_2" ? 2 : undefined,
        ...(janela_ms ? { janela_ms } : {}),
        ...(agendarPara ? { agendado_para: new Date(agendarPara).toISOString() } : {}),
      });
      limparSelecionados();
      setEnvioAtivoId(envio.id);
      setConfirmarAberto(false);
      if (!agendarPara) {
        await api.envios.disparar(envio.id).catch((e) => setErro((e as Error).message));
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCriando(false);
    }
  }

  const estrategiaLabel = ESTRATEGIAS.find((e) => e.valor === estrategiaEscolhida)?.label ?? estrategiaEscolhida;
  const podeConfirmar = selecionados.length > 0 && template.trim().length > 0;

  return (
    <AppShell
      title="Disparo"
      subtitle="Monte, agende e acompanhe um lote de disparo de faturas"
      actions={
        <Botao
          variante="secondary"
          tamanho="sm"
          onClick={() => api.importacao.baixarModelo().catch((e) => alert((e as Error).message))}
        >
          <Download className="size-3.5" />
          Baixar planilha exemplo
        </Botao>
      }
    >
      <div className="space-y-6">
        {erro && <Aviso tone="danger">{erro}</Aviso>}

        {envioAtivoId ? (
          <ProgressoDisparo envioAtivoId={envioAtivoId} setEnvioAtivoId={setEnvioAtivoId} />
        ) : (
          <>
            <EtapaDestinatarios />
            <EtapaMensagem template={template} setTemplate={setTemplate} />
            <EtapaAnexo comPdf={comPdf} setComPdf={setComPdf} />
            <EtapaConexaoEstrategia
              estrategiaEscolhida={estrategiaEscolhida}
              setEstrategiaEscolhida={setEstrategiaEscolhida}
            />
            <EtapaIntervalo
              janelaHoras={janelaHoras}
              setJanelaHoras={setJanelaHoras}
              janelaMinutos={janelaMinutos}
              setJanelaMinutos={setJanelaMinutos}
            />
            <EtapaAgendamento agendarPara={agendarPara} setAgendarPara={setAgendarPara} />

            <SectionCard eyebrow="Etapa 8" titulo="Confirmação">
              <Botao
                variante="primary"
                onClick={() => setConfirmarAberto(true)}
                disabled={!podeConfirmar}
              >
                <Send className="size-4" />
                Revisar e disparar
              </Botao>
              {selecionados.length === 0 && (
                <p className="text-subtle mt-2 text-xs">Selecione ao menos um cliente para continuar.</p>
              )}
            </SectionCard>

            <ConfirmarDisparo
              aberto={confirmarAberto}
              onOpenChange={setConfirmarAberto}
              totalClientes={selecionados.length}
              conexaoResumo={estrategiaLabel}
              comPdf={comPdf}
              agendarPara={agendarPara}
              onConfirmar={criarEIniciar}
              confirmando={criando}
            />
          </>
        )}

        <TesteDisparo templateSugerido={template} />
      </div>
    </AppShell>
  );
}
