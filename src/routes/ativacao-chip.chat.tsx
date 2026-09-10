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
  Search,
  Send,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { api, buscarBlobUrlProtegida } from "@/api";
import { supabase } from "@/supabaseClient";
import { cn } from "@/lib/utils";
import type { Conversa, Mensagem } from "@/lib/types";
import { listarTodasConversas } from "@/lib/conversasPaginadas";
import { Aviso } from "@/components/shared/Controls";
import { EmptyState } from "@/components/shared/EmptyState";
import { VisualizadorPdf } from "@/components/shared/VisualizadorPdf";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

// [2026-09] ATIVAÇÃO CHIP: chat separado do de cobrança (ver
// backend/migration-25-ativacao-chip.sql -- `conversas.campanha` e chave
// única agora incluem campanha, então o MESMO telefone pode ter uma thread
// aqui e outra em /chat sem se misturar). Versão mais enxuta do /chat
// normal: sem "Enviar fatura" (PDF/Pix não existem nessa campanha).
export const Route = createFileRoute("/ativacao-chip/chat")({
  head: () => ({
    meta: [
      { title: "Chat — Ativação Chip — Voxcel Faturas" },
      { name: "description", content: "Conversas do WhatsApp da campanha de Ativação Chip." },
    ],
  }),
  component: ChatAtivacaoChip,
});

function nomeExibicao(c: Conversa) {
  return c.clientes?.nome || c.nome_contato || c.telefone;
}

function VincularClienteModal({
  aberto,
  onClose,
  conversa,
  vinculando,
  erro,
  onVincular,
}: {
  aberto: boolean;
  onClose: () => void;
  conversa: Conversa | null;
  vinculando: boolean;
  erro: string | null;
  onVincular: (clienteId: string | null) => void;
}) {
  const [busca, setBusca] = useState("");
  const [clientes, setClientes] = useState<{ id: string; nome: string; telefone: string }[]>([]);

  useEffect(() => {
    if (!aberto) return;
    api.clientes
      .listar({ campanha: "chip_ativacao", per_page: 5000 })
      .then((r) => setClientes(r.itens.map((c) => ({ id: c.id, nome: c.nome, telefone: c.telefone }))))
      .catch(() => {});
  }, [aberto]);

  const q = busca.trim().toLowerCase();
  const filtrados = q
    ? clientes.filter((c) => c.nome.toLowerCase().includes(q) || c.telefone.includes(q)).slice(0, 30)
    : clientes.slice(0, 30);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-sm">
        {conversa && (
          <>
            <DialogHeader>
              <DialogTitle>Vincular cliente de Ativação Chip</DialogTitle>
            </DialogHeader>

            {conversa.cliente_id && (
              <button
                type="button"
                disabled={vinculando}
                onClick={() => onVincular(null)}
                className="text-destructive hover:bg-surface-raised/60 w-full shrink-0 rounded-md border border-border px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Desvincular de "{conversa.clientes?.nome}"
              </button>
            )}

            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              autoFocus
              className="bg-surface-sunken border-border focus-ring h-9 shrink-0 rounded-md border px-3 text-sm"
            />

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {filtrados.length === 0 && <p className="text-subtle p-2 text-xs">Nenhum cliente encontrado.</p>}
              {filtrados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={vinculando || c.id === conversa.cliente_id}
                  onClick={() => onVincular(c.id)}
                  className="hover:bg-surface-raised/60 flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="truncate">{c.nome}</span>
                  <span className="text-subtle shrink-0 font-mono text-xs">{c.telefone}</span>
                </button>
              ))}
            </div>

            {vinculando && (
              <div className="text-subtle flex shrink-0 items-center justify-center gap-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Vinculando...
              </div>
            )}
            {erro && !vinculando && <Aviso tone="danger">{erro}</Aviso>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function iniciais(nome: string) {
  return nome.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

function hora(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

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

function MidiaProtegida({ path, tipo, alt }: { path: string; tipo: "imagem" | "audio"; alt?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let urlCriada: string | null = null;
    setErro(false);
    buscarBlobUrlProtegida(path)
      .then((url) => {
        if (cancelado) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        urlCriada = url;
        setBlobUrl(url);
      })
      .catch(() => !cancelado && setErro(true));
    return () => {
      cancelado = true;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
  }, [path]);

  if (erro) return <p className="text-muted-foreground mb-1 text-xs italic">Não foi possível carregar</p>;
  if (!blobUrl) return <div className="bg-foreground/10 mb-1 h-40 w-40 animate-pulse rounded-md" />;
  if (tipo === "imagem") {
    return (
      <button type="button" onClick={() => window.open(blobUrl, "_blank")} className="mb-1 block">
        <img src={blobUrl} alt={alt ?? "imagem"} className="max-h-72 rounded-md" />
      </button>
    );
  }
  return <audio controls src={blobUrl} className="mb-1 max-w-full" />;
}

function Ticks({ status }: { status: string | null }) {
  if (status === "lido") return <CheckCheck className="text-chat-tick-read size-3.5 shrink-0" />;
  if (status === "entregue") return <CheckCheck className="size-3.5 shrink-0 opacity-70" />;
  if (status === "enviado" || status === null) return <Check className="size-3.5 shrink-0 opacity-70" />;
  return <Clock className="size-3 shrink-0 opacity-70" />;
}

function ChatAtivacaoChip() {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [mensagensPorConversa, setMensagensPorConversa] = useState<Record<string, Mensagem[]>>({});
  const [ativoId, setAtivoId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState("");
  const [anexo, setAnexo] = useState<File | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState(false);
  const [modalVincularAberto, setModalVincularAberto] = useState(false);
  const [erroVincular, setErroVincular] = useState<string | null>(null);
  const [pdfAberto, setPdfAberto] = useState<string | null>(null);
  const [apagandoConversaId, setApagandoConversaId] = useState<string | null>(null);
  const [apagando, setApagando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fimDaThreadRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelado = false;
    listarTodasConversas("chip_ativacao")
      .then((data) => !cancelado && setConversas(data))
      .catch((e) => setErro(e.message))
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, []);

  function recarregarConversas() {
    listarTodasConversas("chip_ativacao").then(setConversas).catch(() => {});
  }

  useEffect(() => {
    if (!ativoId || mensagensPorConversa[ativoId]) return;
    api.chat
      .listarMensagens(ativoId)
      .then((data) => setMensagensPorConversa((prev) => ({ ...prev, [ativoId]: data })))
      .catch((e) => setErro(e.message));
  }, [ativoId, mensagensPorConversa]);

  // [2026-09] Realtime filtrado por campanha='chip_ativacao' (mesmo motivo
  // do filtro espelhado em routes/chat.tsx) -- sem isso, uma conversa de
  // cobrança vazaria pra dentro desta lista.
  useEffect(() => {
    const canal = supabase
      .channel("chat-ativacao-chip-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens" }, (payload) => {
        const nova = payload.new as Mensagem;
        setMensagensPorConversa((prev) => {
          const existentes = prev[nova.conversa_id];
          if (!existentes) return prev;
          if (existentes.some((m) => m.id === nova.id)) return prev;
          return { ...prev, [nova.conversa_id]: [...existentes, nova] };
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "mensagens" }, (payload) => {
        const atualizada = payload.new as Mensagem;
        setMensagensPorConversa((prev) => {
          const existentes = prev[atualizada.conversa_id];
          if (!existentes) return prev;
          return { ...prev, [atualizada.conversa_id]: existentes.map((m) => (m.id === atualizada.id ? atualizada : m)) };
        });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversas", filter: "campanha=eq.chip_ativacao" },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const c = payload.new as Conversa;
          setConversas((prev) => {
            const ja = prev.some((x) => x.id === c.id);
            const proximas = ja ? prev.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [...prev, c];
            return proximas.sort((a, b) => (b.ultima_mensagem_em || "").localeCompare(a.ultima_mensagem_em || ""));
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return conversas;
    return conversas.filter((c) => nomeExibicao(c).toLowerCase().includes(q) || c.telefone.includes(q));
  }, [conversas, busca]);

  const ativo = conversas.find((c) => c.id === ativoId) ?? null;
  const mensagensAtivo = useMemo(() => (ativoId && mensagensPorConversa[ativoId]) || [], [ativoId, mensagensPorConversa]);
  const totalNaoLidas = conversas.reduce((s, c) => s + c.nao_lidas, 0);

  async function confirmarApagarConversa() {
    if (!apagandoConversaId) return;
    const conversaId = apagandoConversaId;
    setApagando(true);
    try {
      await api.chat.apagar(conversaId);
      setConversas((prev) => prev.filter((c) => c.id !== conversaId));
      if (ativoId === conversaId) setAtivoId(null);
      setApagandoConversaId(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApagando(false);
    }
  }

  async function vincularClienteAgora(clienteId: string | null) {
    if (!ativo || vinculando) return;
    setVinculando(true);
    setErroVincular(null);
    try {
      const atualizada = await api.chat.vincularCliente(ativo.id, clienteId);
      setConversas((prev) => prev.map((c) => (c.id === ativo.id ? { ...c, ...atualizada } : c)));
      setModalVincularAberto(false);
    } catch (e) {
      setErroVincular((e as Error).message);
    } finally {
      setVinculando(false);
    }
  }

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

  useEffect(() => {
    fimDaThreadRef.current?.scrollIntoView({ block: "end" });
  }, [mensagensAtivo.length, ativoId]);

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
      setMensagensPorConversa((prev) => ({ ...prev, [ativo.id]: [...(prev[ativo.id] || []), nova] }));
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
      title="Chat — Ativação Chip"
      subtitle="Conversas do WhatsApp desta campanha (separadas da carteira de cobrança)"
      flush
      actions={
        <span className="bg-surface-raised text-muted-foreground inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium ring-1 ring-border">
          <span className={cn("size-1.5 rounded-full", totalNaoLidas > 0 ? "bg-success animate-pulse" : "bg-subtle")} />
          {totalNaoLidas} não lidas
        </span>
      }
    >
      <div className="flex h-full min-h-0 w-full">
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
                placeholder="Pesquisar…"
                className="bg-background text-foreground border-border focus:ring-ring h-9 w-full rounded-full border pr-3 pl-9 text-sm outline-hidden focus:ring-2"
              />
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
                          <span className={cn("shrink-0 text-[10px]", c.nao_lidas > 0 ? "text-success font-semibold" : "text-subtle")}>
                            {carimboLista(c.ultima_mensagem_em)}
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground truncate text-xs">{c.ultima_mensagem || "—"}</span>
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
                  descricao="As conversas aparecem aqui assim que um cliente de Ativação Chip responder no WhatsApp."
                  compacto
                />
              </li>
            )}
          </ul>
        </aside>

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
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{nomeExibicao(ativo)}</span>
                <span className="text-subtle truncate font-mono text-[11px]">{ativo.telefone}</span>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setErroVincular(null);
                    setModalVincularAberto(true);
                  }}
                  aria-label={ativo.cliente_id ? "Trocar cliente vinculado" : "Vincular a um cliente cadastrado"}
                  title={ativo.cliente_id ? "Trocar cliente vinculado" : "Vincular a um cliente cadastrado"}
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
                    ativo.cliente_id ? "text-muted-foreground hover:bg-surface-raised/60" : "bg-warning/15 text-warning hover:bg-warning/25",
                  )}
                >
                  <UserPlus className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Apagar conversa"
                  title="Apagar conversa"
                  onClick={() => setApagandoConversaId(ativo.id)}
                  className="text-subtle hover:text-destructive hover:bg-surface-raised/50 grid size-8 shrink-0 place-items-center rounded-full transition-colors"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </header>

            <div className="chat-wallpaper min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8 lg:px-12">
              <div className="flex flex-col gap-1.5">
                {grupos.map((grupo) => (
                  <div key={grupo.dia} className="flex flex-col gap-1.5">
                    <div className="my-3 flex justify-center">
                      <span className="chat-daypill">{rotuloDia(grupo.dia)}</span>
                    </div>
                    {grupo.itens.map((m, i) => {
                      const meu = m.direcao === "saida";
                      const anterior = grupo.itens[i - 1];
                      const proxima = grupo.itens[i + 1];
                      const primeiraDoBloco = !anterior || anterior.direcao !== m.direcao;
                      const ultimaDoBloco = !proxima || proxima.direcao !== m.direcao;
                      return (
                        <div key={m.id} className={cn("flex", meu ? "justify-end" : "justify-start", primeiraDoBloco ? "mt-2" : "mt-0")}>
                          <div
                            className={cn(
                              "max-w-[85%] px-2.5 py-1.5 text-sm sm:max-w-[70%]",
                              meu
                                ? ultimaDoBloco
                                  ? "bubble-out"
                                  : "bg-chat-bubble-out text-chat-bubble-out-foreground shadow-panel rounded-lg"
                                : ultimaDoBloco
                                  ? "bubble-in"
                                  : "bg-chat-bubble-in text-chat-bubble-in-foreground shadow-panel rounded-lg",
                            )}
                          >
                            {m.anexo_url && m.tipo === "imagem" && <MidiaProtegida path={m.anexo_url} tipo="imagem" alt={m.anexo_nome ?? "imagem"} />}
                            {m.anexo_url && m.tipo === "audio" && <MidiaProtegida path={m.anexo_url} tipo="audio" />}
                            {m.anexo_url && m.tipo === "documento" && (
                              <button
                                type="button"
                                onClick={() => setPdfAberto(m.anexo_url)}
                                className="mb-1 flex w-full items-center gap-2 rounded-md bg-foreground/10 px-2 py-2 text-left font-mono text-[11px]"
                              >
                                <FileText className="size-4 shrink-0" />
                                <span className="truncate">{m.anexo_nome}</span>
                              </button>
                            )}
                            {m.texto && <p className="pr-14 leading-relaxed whitespace-pre-wrap">{m.texto}</p>}
                            <span className={cn("-mt-3.5 flex items-center justify-end gap-1 text-[10px] opacity-80", !m.texto && "mt-0")}>
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

            <footer className="bg-surface/95 border-border shrink-0 border-t px-3 py-2.5 sm:px-8 lg:px-12 backdrop-blur">
              {anexo && (
                <div className="text-muted-foreground bg-surface-raised/60 mb-2 flex items-center gap-2 rounded-md px-3 py-2 text-xs">
                  <Paperclip className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{anexo.name}</span>
                  <button type="button" aria-label="Remover anexo" className="text-subtle hover:text-foreground" onClick={() => setAnexo(null)}>
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  enviar();
                }}
                className="flex items-end gap-2"
              >
                <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => setAnexo(e.target.files?.[0] ?? null)} />
                <button
                  type="button"
                  aria-label="Anexar arquivo"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-muted-foreground hover:text-foreground hover:bg-surface-raised/50 grid size-10 shrink-0 place-items-center rounded-full transition-colors"
                >
                  <Paperclip className="size-4" />
                </button>
                <textarea
                  ref={campoRef}
                  value={rascunho}
                  rows={1}
                  onChange={(e) => setRascunho(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      enviar();
                    }
                  }}
                  placeholder="Mensagem"
                  className="bg-background text-foreground border-border focus:ring-ring max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-2xl border px-4 py-2.5 text-sm outline-hidden focus:ring-2"
                />
                <button
                  type="submit"
                  aria-label="Enviar mensagem"
                  disabled={(!rascunho.trim() && !anexo) || enviando}
                  className="bg-success text-success-foreground grid size-10 shrink-0 place-items-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </button>
              </form>
            </footer>
          </section>
        ) : (
          <section className="bg-surface-sunken hidden min-h-0 flex-1 place-items-center p-10 lg:grid">
            <EmptyState icon={MessageSquare} titulo="Suas conversas" descricao="Selecione um contato à esquerda para ver o histórico e responder." />
          </section>
        )}
      </div>

      <VincularClienteModal
        aberto={modalVincularAberto}
        onClose={() => setModalVincularAberto(false)}
        conversa={ativo}
        vinculando={vinculando}
        erro={erroVincular}
        onVincular={vincularClienteAgora}
      />
      <VisualizadorPdf url={pdfAberto} onClose={() => setPdfAberto(null)} />
      <AlertDialog open={!!apagandoConversaId} onOpenChange={(open) => !open && setApagandoConversaId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar esta conversa?</AlertDialogTitle>
            <AlertDialogDescription>Todo o histórico de mensagens dela é apagado junto. Não tem como desfazer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apagando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarApagarConversa();
              }}
              disabled={apagando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {apagando ? "Apagando…" : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
