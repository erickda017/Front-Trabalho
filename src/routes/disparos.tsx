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
  Pause,
  Play,
  RotateCcw,
  Send,
  StopCircle,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { HelpTooltip } from "@/components/shared/HelpTooltip";
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
import { statusDoItem, VARIAVEIS_MENSAGEM, type ConfigDisparo } from "@/lib/types";

export const Route = createFileRoute("/disparos")({
  head: () => ({
    meta: [
      { title: "Disparo de faturas — Voxcel Faturas" },
      {
        name: "description",
        content:
          "Monte e acompanhe um lote de disparo de faturas via WhatsApp: destinatários, mensagem, conexão, estratégia, agendamento e progresso em tempo real.",
      },
      { property: "og:title", content: "Disparo de faturas — Voxcel Faturas" },
      {
        property: "og:description",
        content: "Passo a passo do disparo: destinatários, mensagem, conexão, estratégia e progresso.",
      },
    ],
  }),
  component: Disparo,
});

/* [2026-08] MULTI-TENANT: ESTRATEGIAS removido -- não existe mais escolha de
   slot/round-robin, cada usuário tem 1 WhatsApp só (ver migration-13). */

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

const MAX_VARIACOES = 5;

/**
 * Um textarea de variação de mensagem, com o botão de inserir variável focado
 * NELE (cada variação tem seu próprio cursor/seleção).
 */
function CampoVariacao({
  indice,
  valor,
  onChange,
  onRemover,
  removivel,
}: {
  indice: number;
  valor: string;
  onChange: (v: string) => void;
  onRemover: () => void;
  removivel: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function inserirToken(token: string) {
    const el = textareaRef.current;
    if (!el) {
      onChange(valor + token);
      return;
    }
    const start = el.selectionStart ?? valor.length;
    const end = el.selectionEnd ?? valor.length;
    const proximo = valor.slice(0, start) + token + valor.slice(end);
    onChange(proximo);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  return (
    <div className="border-border rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="label-eyebrow">
          Variação {indice + 1}
          {indice === 0 && <span className="text-subtle font-normal normal-case"> (principal)</span>}
        </p>
        {removivel && (
          <button
            type="button"
            onClick={onRemover}
            aria-label={`Remover variação ${indice + 1}`}
            title="Remover esta variação"
            className="text-subtle hover:text-destructive focus-ring shrink-0 rounded p-1"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={indice === 0 ? undefined : "Escreva uma variação com o mesmo sentido, mas com palavras diferentes…"}
        className="bg-surface text-foreground border-border focus-ring w-full rounded-md border px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
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
    </div>
  );
}

function EtapaMensagem({
  templates,
  setTemplates,
}: {
  templates: string[];
  setTemplates: (v: string[]) => void;
}) {
  function atualizar(indice: number, valor: string) {
    setTemplates(templates.map((t, i) => (i === indice ? valor : t)));
  }

  function adicionarVariacao() {
    if (templates.length >= MAX_VARIACOES) return;
    setTemplates([...templates, ""]);
  }

  function removerVariacao(indice: number) {
    setTemplates(templates.filter((_, i) => i !== indice));
  }

  return (
    <SectionCard
      eyebrow="Etapa 2"
      titulo="Mensagem"
      descricao={
        templates.length > 1
          ? `${templates.length} variações cadastradas — o sistema sorteia uma delas para cada mensagem enviada.`
          : "Template usado para todos os destinatários do lote."
      }
      acoes={
        templates.length < MAX_VARIACOES ? (
          <Botao variante="ghost" tamanho="sm" onClick={adicionarVariacao}>
            + Adicionar variação
          </Botao>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {templates.map((valor, indice) => (
          <CampoVariacao
            key={indice}
            indice={indice}
            valor={valor}
            onChange={(v) => atualizar(indice, v)}
            onRemover={() => removerVariacao(indice)}
            removivel={templates.length > 1}
          />
        ))}
      </div>
      <p className="text-subtle mt-3 text-[11px]">
        Cadastre até {MAX_VARIACOES} pequenas variações do mesmo texto (mesmo sentido, palavras diferentes) para
        reduzir o risco do WhatsApp derrubar o número por identificar mensagens idênticas em massa. A substituição
        das variáveis acima por dados reais de cada cliente é feita pelo backend no momento do envio.
      </p>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Anexo                                                                   */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* 4. WhatsApp                                                                */
/* -------------------------------------------------------------------------- */

// [2026-08] MULTI-TENANT: não existe mais escolha de estratégia/slot -- só
// mostra o status da conexão do próprio usuário, e avisa se ela não estiver
// pronta pra disparar.
function EtapaConexao() {
  const { conexao, conexaoSlot2, conexaoCarregando, algumaConexaoConectada } = useAppState();
  // Segundo Zap só aparece aqui se o operador já configurou ele alguma vez --
  // não polui esta tela pra quem usa só 1 número (a grande maioria).
  const temSlot2 = conexaoSlot2.configurada;

  return (
    <SectionCard eyebrow="Etapa 4" titulo="WhatsApp" descricao="Sessão(ões) de WhatsApp usada(s) para este disparo.">
      {conexaoCarregando ? (
        <p className="text-subtle text-xs">Carregando conexão…</p>
      ) : (
        <div className="flex flex-col gap-2 sm:max-w-sm">
          <div className="border-border flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs">
            <Wifi
              className={cn(
                "size-3.5 shrink-0",
                conexao.status === "connected" ? "text-success" : "text-subtle",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{temSlot2 ? "Zap 1" : "Seu WhatsApp"}</p>
              <p className="text-subtle truncate">{conexao.telefone ?? (conexao.configurada ? "sem número" : "não configurado")}</p>
            </div>
            <StatusBadgeSimples status={conexao.status} />
          </div>
          {temSlot2 && (
            <div className="border-border flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs">
              <Wifi
                className={cn(
                  "size-3.5 shrink-0",
                  conexaoSlot2.status === "connected" ? "text-success" : "text-subtle",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Zap 2</p>
                <p className="text-subtle truncate">{conexaoSlot2.telefone ?? "sem número"}</p>
              </div>
              <StatusBadgeSimples status={conexaoSlot2.status} />
            </div>
          )}
        </div>
      )}
      {!algumaConexaoConectada && (
        <p className="text-warning mt-3 text-xs">
          Conecte seu WhatsApp em <Link to="/conexoes" className="underline">Conexão</Link> antes de disparar.
        </p>
      )}
      {temSlot2 && algumaConexaoConectada && conexao.status !== "connected" && (
        <p className="text-subtle mt-3 text-xs">Zap 1 desconectado -- disparando só pelo Zap 2 até reconectar.</p>
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
/* 5/6/7. Configurações avançadas (Anexo + Intervalo + Agendamento)          */
/* -------------------------------------------------------------------------- */

// [2026-09] O que o lote exige de cada cliente pra entrar: 'pdf' (padrão)
// exige PDF vinculado, 'pix' exige código Pix cadastrado, 'livre' não exige
// nenhum dos dois -- só a mensagem de texto (ver backend, resolverClienteIds).
type ModoDisparo = "pdf" | "pix" | "livre";

// [layout] As 3 etapas acima eram 3 SectionCard sempre abertos, sempre
// visíveis -- itens "configura uma vez, raramente revisita" (anexo PDF,
// espalhar no tempo, agendar) empilhados junto com as etapas realmente
// importantes de todo disparo (destinatários, mensagem). Compactados aqui
// num card só, recolhido por padrão, no mesmo padrão de toggle que
// "Disparo de teste" já usava (ver `aberto`/ChevronDown abaixo) -- reduz o
// scroll sem esconder nada que já não fosse opcional.
function ConfiguracoesAvancadas({
  modo,
  setModo,
  janelaHoras,
  setJanelaHoras,
  janelaMinutos,
  setJanelaMinutos,
  agendarPara,
  setAgendarPara,
}: {
  modo: ModoDisparo;
  setModo: (v: ModoDisparo) => void;
  janelaHoras: string;
  setJanelaHoras: (v: string) => void;
  janelaMinutos: string;
  setJanelaMinutos: (v: string) => void;
  agendarPara: string;
  setAgendarPara: (v: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const horas = Number(janelaHoras) || 0;
  const minutos = Number(janelaMinutos) || 0;
  const janelaAtiva = horas > 0 || minutos > 0;

  const resumoAnexo = { pdf: "com PDF", pix: "só Pix", livre: "livre" }[modo];
  const resumo = [
    resumoAnexo,
    janelaAtiva ? `janela ${horas > 0 ? `${horas}h` : ""}${minutos > 0 ? `${minutos}min` : ""}` : null,
    agendarPara ? "agendado" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SectionCard
      eyebrow="Etapas 5-7"
      titulo="Configurações avançadas"
      descricao="Anexo, intervalo de envio e agendamento -- opcionais, o padrão já funciona pra maioria dos disparos."
      acoes={
        <div className="flex items-center gap-2">
          {!aberto && <span className="text-subtle hidden text-xs sm:inline">{resumo}</span>}
          <button
            onClick={() => setAberto((v) => !v)}
            className="text-subtle hover:text-foreground focus-ring rounded p-1"
            aria-label={aberto ? "Recolher" : "Expandir"}
          >
            <ChevronDown className={cn("size-4 transition-transform", aberto && "rotate-180")} />
          </button>
        </div>
      }
    >
      {aberto ? (
        <div className="divide-border -m-4 divide-y sm:-m-5">
          <div className="p-4 sm:p-5">
            <p className="label-eyebrow mb-3 flex items-center gap-1.5">
              Anexo
              <HelpTooltip texto="Escolha o que cada cliente precisa ter cadastrado pra entrar no lote: PDF da fatura, código Pix, ou nenhum dos dois (livre, só a mensagem de texto)." />
            </p>
            <div className="space-y-2.5">
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="modo-disparo"
                  checked={modo === "pdf"}
                  onChange={() => setModo("pdf")}
                  className="accent-primary mt-0.5 size-4"
                />
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Paperclip className="size-3.5" /> Enviar PDF da fatura
                </span>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="modo-disparo"
                  checked={modo === "pix"}
                  onChange={() => setModo("pix")}
                  className="accent-primary mt-0.5 size-4"
                />
                <span className="text-sm font-medium">Só Pix (texto, sem PDF)</span>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="modo-disparo"
                  checked={modo === "livre"}
                  onChange={() => setModo("livre")}
                  className="accent-primary mt-0.5 size-4"
                />
                <span className="text-sm font-medium">Livre (texto, sem exigir PDF nem Pix)</span>
              </label>
            </div>
            {modo === "pix" && (
              <p className="text-muted-foreground mt-3 text-xs">
                Ninguém recebe PDF neste lote -- só a mensagem, com o Pix de cada cliente. Só entram clientes com PIX
                cadastrado.
              </p>
            )}
            {modo === "livre" && (
              <p className="text-muted-foreground mt-3 text-xs">
                Ninguém precisa ter PDF nem PIX cadastrado pra entrar no lote -- só a mensagem de texto. Cliente que
                já tiver PDF vinculado recebe ele anexado normalmente.
              </p>
            )}
          </div>

          <div className="p-4 sm:p-5">
            <p className="label-eyebrow mb-3 flex items-center gap-1.5">
              Intervalo de disparo
              <HelpTooltip texto='Opcional: espalha o lote inteiro dentro de uma janela de tempo (ex: "5 horas" -- a primeira mensagem sai já, a última antes das 5h fecharem), em vez do intervalo padrão entre mensagens.' />
            </p>
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
                {janelaAtiva
                  ? `Mensagens espalhadas ao longo de ${horas > 0 ? `${horas}h` : ""}${minutos > 0 ? `${minutos}min` : ""}.`
                  : "Sem janela definida: usa o intervalo padrão entre mensagens."}
              </p>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <p className="label-eyebrow mb-3">Agendamento</p>
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
          </div>
        </div>
      ) : (
        <p className="text-subtle text-xs sm:hidden">{resumo}</p>
      )}
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
  modo,
  agendarPara,
  onConfirmar,
  confirmando,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  totalClientes: number;
  modo: ModoDisparo;
  agendarPara: string;
  onConfirmar: () => void;
  confirmando: boolean;
}) {
  const anexoLabel = {
    pdf: "com PDF da fatura",
    pix: "somente mensagem de texto, com o Pix",
    livre: "somente mensagem de texto (sem exigir PDF nem Pix)",
  }[modo];
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
          <p className="text-muted-foreground">Anexo: {anexoLabel}</p>
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
  cancelados: number;
  status: string;
  ultimo_envio_em: string | null;
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
  const [configDisparo, setConfigDisparo] = useState<ConfigDisparo | null>(null);

  useEffect(() => {
    api.configuracoes.disparo().then(setConfigDisparo).catch(() => setConfigDisparo(null));
  }, []);

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

  async function pausar() {
    setAcao("pausar");
    try {
      await api.envios.pausar(envioAtivoId);
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
      await api.envios.cancelar(envioAtivoId);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAcao(null);
    }
  }

  const podeIniciar = envio && (envio.status === "pendente" || envio.status === "pausado" || envio.status === "agendado");
  const podePausarOuCancelar = envio && (envio.status === "em_andamento" || envio.status === "pausado");
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
          {envio?.status === "em_andamento" && (
            <Botao variante="secondary" tamanho="sm" onClick={pausar} disabled={acao !== null}>
              {acao === "pausar" ? <Loader2 className="size-3.5 animate-spin" /> : <Pause className="size-3.5" />}
              Pausar
            </Botao>
          )}
          {podePausarOuCancelar && (
            <Botao variante="outline" tamanho="sm" onClick={cancelar} disabled={acao !== null}>
              {acao === "cancelar" ? <Loader2 className="size-3.5 animate-spin" /> : <StopCircle className="size-3.5" />}
              Interromper
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
          </div>

          {envio?.status === "em_andamento" && configDisparo && configDisparo.batch_size > 0 && (
            <p className="text-subtle mt-2 text-xs">
              Pausa automática de {Math.round(configDisparo.batch_pause_ms / 60000)} min a cada{" "}
              {configDisparo.batch_size} mensagens (comportamento mais humano, reduz risco de bloqueio).
            </p>
          )}
          {envio?.status === "em_andamento" && configDisparo && configDisparo.daily_limit > 0 && (
            <p className="text-subtle mt-1 text-xs">Limite diário de disparo: {configDisparo.daily_limit} mensagens.</p>
          )}

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
  const { envioAtivoId, setEnvioAtivoId, selecionados, limparSelecionados } = useAppState();

  const [templates, setTemplates] = useState<string[]>([
    "Olá {{nome}}, tudo bem? Segue em anexo sua fatura no valor de {{valor}}, com vencimento em {{vencimento}}. Qualquer dúvida estou à disposição!",
  ]);
  const [modo, setModo] = useState<ModoDisparo>("pdf");
  const [janelaHoras, setJanelaHoras] = useState("");
  const [janelaMinutos, setJanelaMinutos] = useState("");
  const [agendarPara, setAgendarPara] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoIgnorados, setAvisoIgnorados] = useState<string | null>(null);
  const [confirmarAberto, setConfirmarAberto] = useState(false);

  // Se não há um lote "ativo" guardado nesta aba (sessionStorage perdido --
  // aba nova, outro navegador, ou o servidor caiu e voltou), pergunta pro
  // backend se existe algum disparo em_andamento/pausado agora. Sem isso, um
  // disparo real rodando no servidor ficava "invisível" pra quem abrisse o
  // sistema de novo -- via um browser diferente, ou depois de um crash -- só
  // aparecendo se a pessoa fosse manualmente até o Histórico procurar.
  useEffect(() => {
    if (envioAtivoId) return;
    let cancelado = false;
    api.envios
      .ativo()
      .then((r) => {
        if (!cancelado && r?.id) setEnvioAtivoId(r.id);
      })
      .catch(() => {
        // Sem problema -- só significa que não dá pra saber agora; a tela de
        // montagem de lote continua disponível normalmente.
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envioAtivoId]);

  async function criarEIniciar() {
    setCriando(true);
    setErro(null);
    try {
      const horas = Number(janelaHoras) || 0;
      const minutos = Number(janelaMinutos) || 0;
      const janela_ms = horas > 0 || minutos > 0 ? (horas * 60 + minutos) * 60 * 1000 : undefined;

      const variacoesPreenchidas = templates.map((t) => t.trim()).filter(Boolean);

      const envio = await api.envios.criar({
        cliente_ids: selecionados,
        // NOTA: o backend (POST /envios) espera "mensagem", não "template_mensagem"
        // -- estava divergente aqui, o que fazia a criação sempre falhar com
        // "mensagem é obrigatória" quando disparada direto por essa tela (fora
        // do fluxo de Importar planilha+zip, que usa outro endpoint).
        mensagem: variacoesPreenchidas[0] ?? "",
        // Até 5 variações -- o backend sorteia uma delas pra cada mensagem do
        // lote (ver migration-9-variacoes-mensagem.sql).
        mensagens: variacoesPreenchidas,
        ...(janela_ms ? { janela_ms } : {}),
        ...(agendarPara ? { agendado_para: new Date(agendarPara).toISOString() } : {}),
        // "pix" = lote "só PIX" (nunca anexa PDF, manda o código PIX como
        // texto -- ver migration-17); "livre" = não exige PDF nem PIX pra
        // elegibilidade, só a mensagem de texto (ver resolverClienteIds no
        // backend). Nos dois casos ainda anexa o PDF do cliente que por
        // acaso tiver um vinculado, exceto em "pix" (força texto puro).
        enviar_pix: modo === "pix",
        livre: modo === "livre",
      });
      const ignoradosSemPdf = (envio as { ignorados_sem_pdf?: number }).ignorados_sem_pdf ?? 0;
      const ignoradosPorTag = (envio as { ignorados_por_tag?: number }).ignorados_por_tag ?? 0;
      if (ignoradosSemPdf || ignoradosPorTag) {
        const partes = [];
        // ignoradosSemPdf nunca vem > 0 quando modo === "livre" (backend não
        // exige PDF nem PIX nesse modo -- ver resolverClienteIds).
        if (ignoradosSemPdf) partes.push(modo === "pix" ? `${ignoradosSemPdf} sem PIX cadastrado` : `${ignoradosSemPdf} sem PDF vinculado`);
        if (ignoradosPorTag) partes.push(`${ignoradosPorTag} com tag ou status que bloqueia disparo (ex.: Pago/Cancelado/Fraude)`);
        setAvisoIgnorados(`${partes.join(" e ")} ficaram de fora do lote.`);
      } else {
        setAvisoIgnorados(null);
      }

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

  const podeConfirmar = selecionados.length > 0 && templates.some((t) => t.trim().length > 0);

  return (
    <AppShell
      title="Disparo"
      subtitle="Monte, agende e acompanhe um lote de disparo de faturas"
      actions={
        <Botao
          variante="secondary"
          tamanho="sm"
          onClick={() => api.importacao.baixarModelo().catch((e) => toast.error((e as Error).message))}
        >
          <Download className="size-3.5" />
          Baixar planilha exemplo
        </Botao>
      }
    >
      <div className="space-y-6">
        {erro && <Aviso tone="danger">{erro}</Aviso>}
        {avisoIgnorados && <Aviso tone="warning">{avisoIgnorados}</Aviso>}

        {envioAtivoId ? (
          <ProgressoDisparo envioAtivoId={envioAtivoId} setEnvioAtivoId={setEnvioAtivoId} />
        ) : (
          <>
            <EtapaDestinatarios />
            <EtapaMensagem templates={templates} setTemplates={setTemplates} />
            <EtapaConexao />
            <ConfiguracoesAvancadas
              modo={modo}
              setModo={setModo}
              janelaHoras={janelaHoras}
              setJanelaHoras={setJanelaHoras}
              janelaMinutos={janelaMinutos}
              setJanelaMinutos={setJanelaMinutos}
              agendarPara={agendarPara}
              setAgendarPara={setAgendarPara}
            />

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
              modo={modo}
              agendarPara={agendarPara}
              onConfirmar={criarEIniciar}
              confirmando={criando}
            />
          </>
        )}

        <TesteDisparo templateSugerido={templates[0]} />
      </div>
    </AppShell>
  );
}
