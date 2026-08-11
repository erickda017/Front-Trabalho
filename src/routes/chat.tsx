import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  QrCode,
  Receipt,
  Search,
  Send,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { api } from "@/api";
import { supabase } from "@/supabaseClient";
import { cn } from "@/lib/utils";
import { Aviso } from "@/components/shared/Controls";
import { EmptyState } from "@/components/shared/EmptyState";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat com clientes — Veloce Faturas" },
      {
        name: "description",
        content:
          "Caixa de entrada do WhatsApp dentro do painel: fila de mensagens, respostas rápidas e histórico de conversas por cliente.",
      },
      { property: "og:title", content: "Chat com clientes — Veloce Faturas" },
      {
        property: "og:description",
        content: "Fila de mensagens recebidas e respostas aos clientes em um só lugar.",
      },
    ],
  }),
  component: Chat,
});

type Conversa = {
  id: string;
  telefone: string;
  nome_contato: string | null;
  nao_lidas: number;
  ultima_mensagem: string | null;
  ultima_mensagem_em: string | null;
  clientes: { nome: string; pdf_url: string | null; pix_code: string | null } | null;
};

type Mensagem = {
  id: string;
  conversa_id: string;
  direcao: "entrada" | "saida";
  tipo: "texto" | "imagem" | "audio" | "documento";
  texto: string | null;
  anexo_url: string | null;
  anexo_nome: string | null;
  status_entrega: string | null;
  created_at: string;
};

function EnviarFaturaModal({
  aberto,
  onClose,
  conversa,
  enviando,
  erro,
  onEscolher,
}: {
  aberto: boolean;
  onClose: () => void;
  conversa: Conversa | null;
  enviando: boolean;
  erro: string | null;
  onEscolher: (modo: "pdf" | "pix" | "ambos") => void;
}) {
  if (!aberto || !conversa) return null;

  const temPdf = !!conversa.clientes?.pdf_url;
  const temPix = !!conversa.clientes?.pix_code;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="panel w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-sm font-medium">Enviar fatura</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-subtle hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {!temPdf && !temPix ? (
          <p className="text-subtle text-xs">
            Este cliente não tem fatura (PDF) nem código Pix cadastrados. Faça o upload do PDF na aba
            Clientes primeiro.
          </p>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              disabled={!temPdf || enviando}
              onClick={() => onEscolher("pdf")}
              className="hover:bg-surface-raised/60 flex w-full items-center gap-3 rounded-md border border-border px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FileText className="text-primary-strong size-5 shrink-0" />
              <span>
                <span className="block font-medium">Só o PDF</span>
                <span className="text-subtle block text-xs">Manda o arquivo da fatura</span>
              </span>
            </button>
            <button
              type="button"
              disabled={!temPix || enviando}
              onClick={() => onEscolher("pix")}
              className="hover:bg-surface-raised/60 flex w-full items-center gap-3 rounded-md border border-border px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <QrCode className="text-primary-strong size-5 shrink-0" />
              <span>
                <span className="block font-medium">Só o código Pix</span>
                <span className="text-subtle block text-xs">
                  {temPix ? "Manda o copia e cola extraído do QR" : "Nenhum código Pix encontrado nesta fatura"}
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={!temPdf || !temPix || enviando}
              onClick={() => onEscolher("ambos")}
              className="hover:bg-surface-raised/60 flex w-full items-center gap-3 rounded-md border border-border px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Receipt className="text-primary-strong size-5 shrink-0" />
              <span>
                <span className="block font-medium">PDF + Pix</span>
                <span className="text-subtle block text-xs">Manda os dois, um atrás do outro</span>
              </span>
            </button>
          </div>
        )}

        {enviando && (
          <div className="text-subtle mt-4 flex items-center justify-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" /> Enviando...
          </div>
        )}
        {erro && !enviando && (
          <Aviso tone="danger" className="mt-4">
            {erro}
          </Aviso>
        )}
      </div>
    </div>
  );
}

function nomeExibicao(c: Conversa) {
  return c.clientes?.nome || c.nome_contato || c.telefone;
}

function GerenciarRespostasRapidas({
  aberto,
  onClose,
  respostas,
  onChange,
}: {
  aberto: boolean;
  onClose: () => void;
  respostas: { id: string; atalho: string; texto: string }[];
  onChange: () => void;
}) {
  const [atalho, setAtalho] = useState("");
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (!aberto) return null;

  async function criar() {
    if (!atalho.trim() || !texto.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.respostasRapidas.criar({ atalho, texto });
      setAtalho("");
      setTexto("");
      onChange();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    setRemovendo(id);
    try {
      await api.respostasRapidas.remover(id);
      onChange();
    } finally {
      setRemovendo(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onClose}>
      <div
        className="panel max-h-[80vh] w-full max-w-lg overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-sm font-medium">Mensagens rápidas</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-subtle hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="mb-5 space-y-2">
          <div className="flex gap-2">
            <input
              value={atalho}
              onChange={(e) => setAtalho(e.target.value)}
              placeholder="atalho (ex: boasvindas)"
              className="bg-background text-foreground border-border focus:ring-ring h-9 w-36 shrink-0 rounded-md border px-2.5 font-mono text-xs outline-hidden focus:ring-2"
            />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Texto da mensagem"
              className="bg-background text-foreground border-border focus:ring-ring h-9 w-full min-w-0 flex-1 rounded-md border px-2.5 text-xs outline-hidden focus:ring-2"
            />
            <button
              onClick={criar}
              disabled={salvando}
              aria-label="Adicionar"
              className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-md disabled:opacity-50"
            >
              {salvando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            </button>
          </div>
          {erro && <Aviso tone="danger">{erro}</Aviso>}
          <p className="text-subtle text-xs">
            No chat, digite <span className="font-mono">/atalho</span> pra usar.
          </p>
        </div>

        <div className="divide-border/60 divide-y">
          {respostas.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-primary-strong font-mono text-xs font-semibold">/{r.atalho}</p>
                <p className="text-muted-foreground truncate text-xs">{r.texto}</p>
              </div>
              <button
                onClick={() => remover(r.id)}
                disabled={removendo === r.id}
                aria-label="Remover"
                className="text-subtle hover:text-destructive shrink-0 disabled:opacity-40"
              >
                {removendo === r.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>
            </div>
          ))}
          {respostas.length === 0 && (
            <p className="text-subtle py-6 text-center text-xs">Nenhuma mensagem rápida ainda.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function iniciais(nome: string) {
  return nome
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function hora(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** "14:32" se hoje, "Ontem", senão "12/03" — igual à lista do WhatsApp. */
function carimboLista(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  if (mesmoDia) return hora(iso);
  const ontem = new Date(hoje.getTime() - 86400000);
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function rotuloDia(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  const ontem = new Date(hoje.getTime() - 86400000);
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function Ticks({ status }: { status: string | null }) {
  if (status === "lido") return <CheckCheck className="text-primary size-3.5 shrink-0" />;
  if (status === "entregue") return <CheckCheck className="size-3.5 shrink-0 opacity-70" />;
  if (status === "enviado" || status === null)
    return <Check className="size-3.5 shrink-0 opacity-70" />;
  return <Clock className="size-3 shrink-0 opacity-70" />;
}

function Chat() {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [mensagensPorConversa, setMensagensPorConversa] = useState<Record<string, Mensagem[]>>({});
  const [ativoId, setAtivoId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "nao_lidas">("todas");
  const [rascunho, setRascunho] = useState("");
  const [anexo, setAnexo] = useState<File | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [respostasRapidas, setRespostasRapidas] = useState<{ id: string; atalho: string; texto: string }[]>([]);
  const [sugestaoIndex, setSugestaoIndex] = useState(0);
  const [enviandoFatura, setEnviandoFatura] = useState(false);
  const [modalFaturaAberto, setModalFaturaAberto] = useState(false);
  const [erroFatura, setErroFatura] = useState<string | null>(null);
  const [gerenciarRespostasAberto, setGerenciarRespostasAberto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fimDaThreadRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  // Carga inicial das conversas
  useEffect(() => {
    let cancelado = false;
    api.chat
      .listarConversas()
      .then((data: Conversa[]) => {
        if (cancelado) return;
        setConversas(data);
      })
      .catch((e) => setErro(e.message))
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, []);

  // Mensagens rápidas (atalho "/algo") configuradas na aba Tags/Mensagens rápidas
  useEffect(() => {
    api.respostasRapidas.listar().then(setRespostasRapidas).catch(() => {});
  }, []);

  function recarregarRespostasRapidas() {
    api.respostasRapidas.listar().then(setRespostasRapidas).catch(() => {});
  }

  // Histórico da conversa ativa (busca só na primeira vez que ela é aberta)
  useEffect(() => {
    if (!ativoId || mensagensPorConversa[ativoId]) return;
    api.chat
      .listarMensagens(ativoId)
      .then((data: Mensagem[]) => setMensagensPorConversa((prev) => ({ ...prev, [ativoId]: data })))
      .catch((e) => setErro(e.message));
  }, [ativoId, mensagensPorConversa]);

  // Realtime: mensagem nova (de qualquer conversa) e atualização de resumo da conversa
  useEffect(() => {
    const canal = supabase
      .channel("chat-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens" }, (payload) => {
        const nova = payload.new as Mensagem;
        setMensagensPorConversa((prev) => {
          const existentes = prev[nova.conversa_id];
          if (!existentes) return prev; // conversa ainda não foi aberta
          if (existentes.some((m) => m.id === nova.id)) return prev;
          return { ...prev, [nova.conversa_id]: [...existentes, nova] };
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "mensagens" }, (payload) => {
        const atualizada = payload.new as Mensagem;
        setMensagensPorConversa((prev) => {
          const existentes = prev[atualizada.conversa_id];
          if (!existentes) return prev;
          return {
            ...prev,
            [atualizada.conversa_id]: existentes.map((m) =>
              m.id === atualizada.id ? atualizada : m,
            ),
          };
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversas" }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const c = payload.new as Conversa;
        setConversas((prev) => {
          const ja = prev.some((x) => x.id === c.id);
          const proximas = ja ? prev.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [...prev, c];
          return proximas.sort((a, b) =>
            (b.ultima_mensagem_em || "").localeCompare(a.ultima_mensagem_em || ""),
          );
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return conversas.filter((c) => {
      if (filtro === "nao_lidas" && c.nao_lidas === 0) return false;
      if (!q) return true;
      return nomeExibicao(c).toLowerCase().includes(q) || c.telefone.includes(q);
    });
  }, [conversas, busca, filtro]);

  const ativo = conversas.find((c) => c.id === ativoId) ?? null;
  const mensagensAtivo = useMemo(
    () => (ativoId && mensagensPorConversa[ativoId]) || [],
    [ativoId, mensagensPorConversa],
  );
  const totalNaoLidas = conversas.reduce((s, c) => s + c.nao_lidas, 0);

  // Se o rascunho é só "/algumacoisa" (sem espaço), mostra sugestões de mensagem
  // rápida que começam com esse texto. Assim que aparece um espaço, o usuário já
  // tá escrevendo a mensagem de verdade, não mais escolhendo o atalho.
  const sugestoes = useMemo(() => {
    const m = /^\/([^\s]*)$/.exec(rascunho);
    if (!m) return [];
    const termo = (m[1] ?? "").toLowerCase();
    return respostasRapidas.filter((r) => r.atalho.toLowerCase().startsWith(termo));
  }, [rascunho, respostasRapidas]);

  useEffect(() => {
    setSugestaoIndex(0);
  }, [sugestoes.length]);

  function escolherSugestao(r: { texto: string }) {
    setRascunho(r.texto);
    campoRef.current?.focus();
  }

  async function apagarConversa(conversaId: string) {
    if (!confirm("Apagar esta conversa e todo o histórico de mensagens dela? Não tem como desfazer.")) return;
    try {
      await api.chat.apagar(conversaId);
      setConversas((prev) => prev.filter((c) => c.id !== conversaId));
      if (ativoId === conversaId) setAtivoId(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function enviarFaturaAgora(modo: "pdf" | "pix" | "ambos") {
    if (!ativo || enviandoFatura) return;
    setEnviandoFatura(true);
    setErroFatura(null);
    try {
      const resultado = await api.chat.enviarFatura(ativo.id, modo);
      setMensagensPorConversa((prev) => {
        const existentes = prev[ativo.id] || [];
        const novas = [resultado.fatura, resultado.pix].filter(Boolean);
        return { ...prev, [ativo.id]: [...existentes, ...novas] };
      });
      setModalFaturaAberto(false);
    } catch (e) {
      setErroFatura((e as Error).message);
    } finally {
      setEnviandoFatura(false);
    }
  }

  // Agrupa mensagens por dia para os separadores de data
  const grupos = useMemo(() => {
    const out: { dia: string; itens: Mensagem[] }[] = [];
    for (const m of mensagensAtivo) {
      const dia = new Date(m.created_at).toDateString();
      const ultimo = out[out.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.itens.push(m);
      else out.push({ dia, itens: [m] });
    }
    return out;
  }, [mensagensAtivo]);

  // Rola para o fim quando chegam mensagens ou troca de conversa
  useEffect(() => {
    fimDaThreadRef.current?.scrollIntoView({ block: "end" });
  }, [mensagensAtivo.length, ativoId]);

  // Mantém o campo de digitação focado
  useEffect(() => {
    if (ativoId) campoRef.current?.focus();
  }, [ativoId]);

  function abrir(id: string) {
    setAtivoId(id);
    const conversa = conversas.find((c) => c.id === id);
    if (conversa && conversa.nao_lidas > 0) {
      setConversas((prev) => prev.map((c) => (c.id === id ? { ...c, nao_lidas: 0 } : c)));
      api.chat.marcarLida(id).catch(() => {});
    }
  }

  async function enviar() {
    const texto = rascunho.trim();
    if ((!texto && !anexo) || !ativo || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const nova = await api.chat.enviar(ativo.id, { mensagem: texto, anexo: anexo ?? undefined });
      setMensagensPorConversa((prev) => ({
        ...prev,
        [ativo.id]: [...(prev[ativo.id] || []), nova],
      }));
      setRascunho("");
      setAnexo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      campoRef.current?.focus();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AppShell
      title="Chat"
      subtitle="Conversas do WhatsApp em tempo real"
      flush
      actions={
        <span className="bg-surface-raised text-muted-foreground inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium ring-1 ring-border">
          <span
            className={cn(
              "size-1.5 rounded-full",
              totalNaoLidas > 0 ? "bg-success animate-pulse" : "bg-subtle",
            )}
          />
          {totalNaoLidas} não lidas
        </span>
      }
    >
      <div className="flex h-full min-h-0 w-full">
        {/* Lista de conversas */}
        <aside
          className={cn(
            "bg-surface border-border flex w-full min-w-0 flex-col border-r lg:w-[22rem] lg:shrink-0",
            ativo && "hidden lg:flex",
          )}
        >
          <div className="border-border shrink-0 space-y-2 border-b p-3">
            <div className="relative">
              <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Pesquisar ou começar uma nova conversa"
                className="bg-background text-foreground border-border focus:ring-ring h-9 w-full rounded-full border pr-3 pl-9 text-sm outline-hidden focus:ring-2"
              />
            </div>
            <div className="flex items-center gap-2">
              {(
                [
                  { id: "todas", label: "Todas" },
                  { id: "nao_lidas", label: "Não lidas" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFiltro(f.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    filtro === f.id
                      ? "bg-success/15 text-success ring-success/25 ring-1"
                      : "text-muted-foreground hover:bg-surface-raised/50",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto">
            {carregando && (
              <li className="text-subtle flex items-center justify-center gap-2 p-6 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Carregando conversas...
              </li>
            )}
            {!carregando &&
              filtradas.map((c) => {
                const selecionado = c.id === ativoId;
                const nome = nomeExibicao(c);
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => abrir(c.id)}
                      className={cn(
                        "border-border/50 flex w-full items-center gap-3 border-b px-3 py-3 text-left transition-colors",
                        selecionado ? "bg-surface-raised/70" : "hover:bg-surface-raised/30",
                      )}
                    >
                      <span className="bg-surface-raised text-muted-foreground grid size-11 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-border">
                        {iniciais(nome)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{nome}</span>
                          <span
                            className={cn(
                              "shrink-0 text-[10px]",
                              c.nao_lidas > 0 ? "text-success font-semibold" : "text-subtle",
                            )}
                          >
                            {carimboLista(c.ultima_mensagem_em)}
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground truncate text-xs">
                            {c.ultima_mensagem || "—"}
                          </span>
                          {c.nao_lidas > 0 && (
                            <span className="bg-success text-success-foreground grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[10px] font-bold">
                              {c.nao_lidas}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            {!carregando && filtradas.length === 0 && (
              <li>
                <EmptyState
                  icon={MessageSquare}
                  titulo="Nenhuma conversa encontrada"
                  descricao="Tente outro termo de busca ou troque o filtro."
                  compacto
                />
              </li>
            )}
          </ul>
        </aside>

        {/* Thread */}
        {ativo ? (
          <section className="bg-surface-sunken flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="border-border bg-surface/95 flex shrink-0 items-center gap-3 border-b px-4 py-2.5 backdrop-blur">
              <button
                onClick={() => setAtivoId(null)}
                aria-label="Voltar para conversas"
                className="text-muted-foreground hover:text-foreground grid size-8 shrink-0 place-items-center rounded-md lg:hidden"
              >
                <ArrowLeft className="size-4" />
              </button>
              <span className="bg-surface-raised text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-border">
                {iniciais(nomeExibicao(ativo))}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{nomeExibicao(ativo)}</span>
                <span className="text-subtle truncate font-mono text-[11px]">{ativo.telefone}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setErroFatura(null);
                  setModalFaturaAberto(true);
                }}
                className="bg-primary-soft text-primary-strong hover:bg-primary-soft/70 ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              >
                <Receipt className="size-3.5" />
                Enviar fatura
              </button>
              <button
                type="button"
                aria-label="Apagar conversa"
                onClick={() => apagarConversa(ativo.id)}
                className="text-subtle hover:text-destructive hover:bg-surface-raised/50 grid size-8 shrink-0 place-items-center rounded-full transition-colors"
              >
                <Trash2 className="size-3.5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8">
              <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
                {grupos.map((grupo) => (
                  <div key={grupo.dia} className="flex flex-col gap-1.5">
                    <div className="my-3 flex justify-center">
                      <span className="bg-surface-raised text-muted-foreground rounded-full px-3 py-1 text-[11px] font-medium shadow-panel">
                        {rotuloDia(grupo.dia)}
                      </span>
                    </div>
                    {grupo.itens.map((m, i) => {
                      const meu = m.direcao === "saida";
                      const anterior = grupo.itens[i - 1];
                      const primeiraDoBloco = !anterior || anterior.direcao !== m.direcao;
                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "flex",
                            meu ? "justify-end" : "justify-start",
                            primeiraDoBloco ? "mt-2" : "mt-0",
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[85%] px-2.5 py-1.5 text-sm shadow-sm sm:max-w-[70%]",
                              meu
                                ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
                                : "bg-surface-raised text-foreground rounded-2xl rounded-bl-sm",
                            )}
                          >
                            {m.anexo_url && m.tipo === "imagem" && (
                              <a
                                href={m.anexo_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mb-1 block"
                              >
                                <img
                                  src={m.anexo_url}
                                  alt={m.anexo_nome ?? "imagem"}
                                  className="max-h-72 rounded-md"
                                />
                              </a>
                            )}
                            {m.anexo_url && m.tipo === "audio" && (
                              <audio controls src={m.anexo_url} className="mb-1 max-w-full" />
                            )}
                            {m.anexo_url && m.tipo === "documento" && (
                              <a
                                href={m.anexo_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mb-1 flex items-center gap-2 rounded-md bg-foreground/10 px-2 py-2 font-mono text-[11px]"
                              >
                                <FileText className="size-4 shrink-0" />
                                <span className="truncate">{m.anexo_nome}</span>
                              </a>
                            )}
                            {m.texto && (
                              <p className="pr-14 leading-relaxed whitespace-pre-wrap">{m.texto}</p>
                            )}
                            <span
                              className={cn(
                                "-mt-3.5 flex items-center justify-end gap-1 text-[10px] opacity-80",
                                !m.texto && "mt-0",
                              )}
                            >
                              {hora(m.created_at)}
                              {meu && <Ticks status={m.status_entrega} />}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div ref={fimDaThreadRef} />
              </div>
            </div>

            {erro && (
              <div className="shrink-0 px-4 py-2">
                <Aviso tone="danger">{erro}</Aviso>
              </div>
            )}

            <footer className="bg-surface/95 border-border shrink-0 border-t px-3 py-2.5 backdrop-blur">
              {anexo && (
                <div className="text-muted-foreground bg-surface-raised/60 mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-md px-3 py-2 text-xs">
                  <Paperclip className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{anexo.name}</span>
                  <button
                    type="button"
                    aria-label="Remover anexo"
                    className="text-subtle hover:text-foreground"
                    onClick={() => setAnexo(null)}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
              {sugestoes.length > 0 && (
                <div className="panel mx-auto mb-2 max-w-3xl overflow-hidden p-1">
                  {sugestoes.map((r, i) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => escolherSugestao(r)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs transition-colors",
                        i === sugestaoIndex ? "bg-primary-soft" : "hover:bg-surface-raised/50",
                      )}
                    >
                      <span className="text-primary-strong shrink-0 font-mono font-semibold">/{r.atalho}</span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate">{r.texto}</span>
                    </button>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sugestoes.length > 0) {
                    const sugestaoAtual = sugestoes[sugestaoIndex];
                    if (sugestaoAtual) escolherSugestao(sugestaoAtual);
                    return;
                  }
                  enviar();
                }}
                className="mx-auto flex max-w-3xl items-end gap-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setAnexo(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  aria-label="Anexar arquivo"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-muted-foreground hover:text-foreground hover:bg-surface-raised/50 grid size-10 shrink-0 place-items-center rounded-full transition-colors"
                >
                  <Paperclip className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Gerenciar mensagens rápidas"
                  onClick={() => setGerenciarRespostasAberto(true)}
                  className="text-muted-foreground hover:text-foreground hover:bg-surface-raised/50 grid size-10 shrink-0 place-items-center rounded-full transition-colors"
                >
                  <Settings className="size-4" />
                </button>
                <textarea
                  ref={campoRef}
                  value={rascunho}
                  rows={1}
                  onChange={(e) => setRascunho(e.target.value)}
                  onKeyDown={(e) => {
                    if (sugestoes.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSugestaoIndex((i) => (i + 1) % sugestoes.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSugestaoIndex((i) => (i - 1 + sugestoes.length) % sugestoes.length);
                        return;
                      }
                      if (e.key === "Tab" || e.key === "Enter") {
                        e.preventDefault();
                        const sugestaoAtual = sugestoes[sugestaoIndex];
                        if (sugestaoAtual) escolherSugestao(sugestaoAtual);
                        return;
                      }
                      if (e.key === "Escape") {
                        setRascunho("");
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      enviar();
                    }
                  }}
                  placeholder="Mensagem (digite / para respostas rápidas)"
                  className="bg-background text-foreground border-border focus:ring-ring max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-2xl border px-4 py-2.5 text-sm outline-hidden focus:ring-2"
                />
                <button
                  type="submit"
                  aria-label="Enviar mensagem"
                  disabled={(!rascunho.trim() && !anexo) || enviando}
                  className="bg-success text-success-foreground grid size-10 shrink-0 place-items-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {enviando ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </button>
              </form>
            </footer>
          </section>
        ) : (
          <section className="bg-surface-sunken hidden min-h-0 flex-1 place-items-center p-10 lg:grid">
            <EmptyState
              icon={MessageSquare}
              titulo="Suas conversas"
              descricao="Selecione um contato à esquerda para ver o histórico e responder."
            />
          </section>
        )}
      </div>

      <GerenciarRespostasRapidas
        aberto={gerenciarRespostasAberto}
        onClose={() => setGerenciarRespostasAberto(false)}
        respostas={respostasRapidas}
        onChange={recarregarRespostasRapidas}
      />
      <EnviarFaturaModal
        aberto={modalFaturaAberto}
        onClose={() => setModalFaturaAberto(false)}
        conversa={ativo}
        enviando={enviandoFatura}
        erro={erroFatura}
        onEscolher={enviarFaturaAgora}
      />
    </AppShell>
  );
}
