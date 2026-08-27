import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  Check,
  Copy,
  FileText,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Tag as TagIcon,
  Trash2,
  Unlink,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Botao, Busca, Campo, FiltroChips, Aviso, LinhasEsqueleto, Rotulo, Seletor } from "@/components/shared/Controls";
import { StatusPill } from "@/components/shared/StatusPill";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppState, type Tag } from "@/lib/app-state";
import type { Cliente } from "@/lib/types";
import { agruparClientesPorNumero, type ClienteAgrupado } from "@/lib/agruparClientes";
import { api, abrirArquivoProtegido } from "@/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes e faturas — Veloce Faturas" },
      {
        name: "description",
        content:
          "Base de clientes com telefone normalizado, valor, vencimento e PDF da fatura anexado, pronta para o próximo disparo.",
      },
      { property: "og:title", content: "Clientes e faturas — Veloce Faturas" },
      {
        property: "og:description",
        content: "Telefone normalizado, valor, vencimento e PDF anexo por cliente.",
      },
    ],
  }),
  component: Clientes,
});

const formatoMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatarValor(valor: string | null): string {
  if (!valor) return "—";
  const numero = Number(String(valor).replace(/\./g, "").replace(",", "."));
  if (Number.isFinite(numero) && /[\d]/.test(valor)) {
    // Se já vier como "150,00" ou "150.00" tentamos normalizar; senão exibimos cru.
    const numeroSimples = Number(String(valor).replace(",", "."));
    if (Number.isFinite(numeroSimples)) return formatoMoeda.format(numeroSimples);
  }
  return valor;
}

function formatarData(data: string | null): string {
  if (!data) return "—";
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return data;
  return format(d, "dd/MM/yyyy", { locale: ptBR });
}

type FiltroPix = "todos" | "com_pix" | "sem_pix" | "com_fatura" | "sem_fatura";
type FiltroDisparo = "todos" | "recebeu" | "nao_recebeu";

function BotaoCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        } catch {
          /* silencioso */
        }
      }}
      aria-label="Copiar chave PIX"
      className="focus-ring text-muted-foreground hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded"
    >
      {copiado ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function TagPicker({
  cliente,
  todasTags,
  onChange,
}: {
  cliente: Cliente;
  todasTags: Tag[];
  onChange: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const atribuidas = new Set(cliente.tags.map((t) => t.id));

  async function alternar(tag: Tag) {
    if (atribuidas.has(tag.id)) {
      await api.tags.remover_do_cliente(tag.id, cliente.id);
    } else {
      await api.tags.atribuir(tag.id, cliente.id);
    }
    onChange();
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex flex-wrap items-center gap-1.5 text-left"
      >
        {cliente.tags.length === 0 && (
          <span className="text-subtle inline-flex items-center gap-1 text-xs hover:text-foreground">
            <TagIcon className="size-3" /> Adicionar
          </span>
        )}
        {cliente.tags.map((t) => (
          <span
            key={t.id}
            className="rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-border"
            style={{ backgroundColor: `${t.cor}22`, color: t.cor }}
          >
            {t.nome}
          </span>
        ))}
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="panel absolute top-full left-0 z-20 mt-2 w-48 space-y-1 p-2">
            {todasTags.length === 0 && (
              <p className="text-subtle px-2 py-1 text-xs">Crie tags na aba Tags.</p>
            )}
            {todasTags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => alternar(t)}
                className="hover:bg-surface-raised flex w-full items-center justify-between rounded px-2 py-1.5 text-xs"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: t.cor }} />
                  {t.nome}
                </span>
                {atribuidas.has(t.id) && <span className="text-primary-strong">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ClienteFormModal({
  cliente,
  onClose,
  onSalvo,
}: {
  cliente: Cliente | null;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState(cliente?.nome ?? "");
  const [telefone, setTelefone] = useState(cliente?.telefone ?? "");
  const [valor, setValor] = useState(cliente?.valor ?? "");
  const [vencimento, setVencimento] = useState(cliente?.vencimento ?? "");
  const [pdf, setPdf] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      if (cliente) {
        await api.clientes.atualizar(cliente.id, { nome, telefone, valor, vencimento });
      } else {
        const novo = await api.clientes.criar({ nome, telefone, valor, vencimento });
        if (pdf) await api.clientes.uploadPdf(novo.id, pdf);
      }
      onSalvo();
      onClose();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/25 p-4 backdrop-blur-[2px]">
      <div className="panel w-full max-w-md p-6">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold">
            {cliente ? "Editar cliente" : "Novo cliente"}
          </h3>
          <button onClick={onClose} className="text-subtle hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Rotulo>Nome</Rotulo>
            <Campo required value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <Rotulo>Telefone</Rotulo>
            <Campo
              required
              placeholder="(11) 99999-9999"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Rotulo>Valor</Rotulo>
              <Campo placeholder="150,00" value={valor ?? ""} onChange={(e) => setValor(e.target.value)} />
            </div>
            <div>
              <Rotulo>Vencimento</Rotulo>
              <Campo type="date" value={vencimento ?? ""} onChange={(e) => setVencimento(e.target.value)} />
            </div>
          </div>
          {!cliente && (
            <div>
              <Rotulo>PDF da fatura (opcional)</Rotulo>
              <label className="border-border-strong hover:border-primary flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-xs">
                <Upload className="size-3.5 shrink-0" />
                <span className="truncate">{pdf ? pdf.name : "Selecionar arquivo .pdf"}</span>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          )}

          {erro && <Aviso tone="danger">{erro}</Aviso>}

          <Botao type="submit" variante="primary" disabled={salvando} className="w-full">
            {salvando ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar cliente
          </Botao>
        </form>
      </div>
    </div>
  );
}

function VincularNumero({ cliente, onMudou }: { cliente: Cliente; onMudou: () => void }) {
  const [vinculados, setVinculados] = useState<{ id: string; nome: string; telefone: string }[]>(
    cliente.vinculados ?? [],
  );
  const [buscando, setBuscando] = useState(false);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [processando, setProcessando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // O objeto vindo da listagem não traz `vinculados` (só o GET de 1
    // cliente traz) -- busca fresco toda vez que a ficha abre um cliente.
    let cancelado = false;
    api.clientes
      .buscar(cliente.id)
      .then((c) => !cancelado && setVinculados(c.vinculados ?? []))
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [cliente.id]);

  async function buscar() {
    if (!termo.trim()) return;
    setBuscando(true);
    setErro(null);
    try {
      const data = await api.clientes.listar({ busca: termo.trim() });
      setResultados((Array.isArray(data) ? data : []).filter((c: Cliente) => c.id !== cliente.id));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBuscando(false);
    }
  }

  async function vincular(outroId: string) {
    setProcessando(outroId);
    setErro(null);
    try {
      const atualizado = await api.clientes.vincular(cliente.id, outroId);
      setVinculados(atualizado.vinculados ?? []);
      setResultados([]);
      setTermo("");
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setProcessando(null);
    }
  }

  async function desvincular(outroId: string) {
    setProcessando(outroId);
    setErro(null);
    try {
      await api.clientes.desvincular(outroId);
      setVinculados((prev) => prev.filter((v) => v.id !== outroId));
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setProcessando(null);
    }
  }

  return (
    <div>
      <p className="label-eyebrow mb-1">Outros números deste cliente</p>
      <p className="text-subtle mb-2 text-xs">
        Fatura, PIX e vencimento gravados em qualquer um destes números valem pros outros também.
      </p>

      {vinculados.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {vinculados.map((v) => (
            <div
              key={v.id}
              className="bg-surface-sunken border-border flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{v.nome}</p>
                <p className="text-subtle font-mono">{v.telefone}</p>
              </div>
              <button
                onClick={() => desvincular(v.id)}
                disabled={processando === v.id}
                aria-label="Desvincular"
                className="focus-ring text-subtle hover:text-destructive grid size-6 shrink-0 place-items-center rounded"
              >
                {processando === v.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Unlink className="size-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <Campo
          placeholder="Buscar por nome ou telefone…"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscar())}
          className="text-xs"
        />
        <Botao type="button" variante="outline" tamanho="sm" onClick={buscar} disabled={buscando}>
          {buscando ? <Loader2 className="size-3.5 animate-spin" /> : "Buscar"}
        </Botao>
      </div>

      {resultados.length > 0 && (
        <div className="border-border mt-1.5 space-y-1 rounded-md border p-1.5">
          {resultados.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => vincular(c.id)}
              disabled={processando === c.id}
              className="hover:bg-surface-sunken focus-ring flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs"
            >
              <span className="min-w-0 truncate">
                {c.nome} <span className="text-subtle font-mono">{c.telefone}</span>
              </span>
              {processando === c.id ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
              ) : (
                <Link2 className="text-subtle size-3.5 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}

      {erro && (
        <p className="text-destructive mt-1.5 text-xs">{erro}</p>
      )}
    </div>
  );
}

function FichaCliente({
  cliente,
  onClose,
  onEditar,
  onMudou,
}: {
  cliente: Cliente | null;
  onClose: () => void;
  onEditar: () => void;
  onMudou: () => void;
}) {
  return (
    <Sheet open={!!cliente} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        {cliente && (
          <>
            <SheetHeader>
              <SheetTitle>Ficha do cliente</SheetTitle>
              <SheetDescription>{cliente.nome}</SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex-1 space-y-4 overflow-y-auto text-sm">
              <Campo1 label="Nome" valor={cliente.nome} />
              <Campo1 label="Telefone" valor={cliente.telefone} mono />
              <Campo1 label="Valor" valor={formatarValor(cliente.valor)} />
              <Campo1 label="Vencimento" valor={formatarData(cliente.vencimento)} />
              <div>
                <p className="label-eyebrow mb-1">Chave PIX</p>
                {cliente.pix_code ? (
                  <div className="bg-surface-sunken border-border flex items-center gap-2 rounded-md border px-3 py-2">
                    <KeyRound className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{cliente.pix_code}</span>
                    <BotaoCopiar texto={cliente.pix_code} />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">—</p>
                )}
              </div>
              <div>
                <p className="label-eyebrow mb-1">Tags</p>
                {cliente.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {cliente.tags.map((t) => (
                      <span
                        key={t.id}
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-border"
                        style={{ backgroundColor: `${t.cor}22`, color: t.cor }}
                      >
                        {t.nome}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">—</p>
                )}
              </div>
              <div>
                <p className="label-eyebrow mb-1">Fatura (PDF)</p>
                {cliente.pdf_url ? (
                  <button
                    type="button"
                    onClick={() => abrirArquivoProtegido(cliente.pdf_url).catch(() => toast.error("Não foi possível abrir o PDF"))}
                    className="text-primary-strong inline-flex items-center gap-1.5 text-xs hover:underline"
                  >
                    <FileText className="size-3.5" />
                    Ver PDF
                  </button>
                ) : (
                  <p className="text-muted-foreground text-sm">—</p>
                )}
              </div>
              <Campo1
                label="Último envio"
                valor={cliente.ultimo_envio_em ? formatarData(cliente.ultimo_envio_em) : "—"}
              />
              <VincularNumero cliente={cliente} onMudou={onMudou} />
            </div>
            <SheetFooter>
              <Botao variante="primary" onClick={onEditar} className="w-full sm:w-auto">
                <Pencil className="size-3.5" />
                Editar
              </Botao>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Campo1({ label, valor, mono = false }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <p className="label-eyebrow mb-1">{label}</p>
      <p className={cn("text-sm", mono && "font-mono text-xs")}>{valor || "—"}</p>
    </div>
  );
}

// [2026-08] "Importar clientes PAGOS" -- cola uma lista de nomes (1 por
// linha, direto de uma planilha/coluna) e o backend casa cada um com um
// cliente já cadastrado, aplicando a tag "Pago" (criada automaticamente já
// como "não dispara" -- ver backend/src/routes/clientes.routes.js, POST
// /importar-pagos). Mesmo espírito do "Importar clientes" da aba Importar,
// mas aqui não se cria ninguém, só se marca quem já existe.
function ImportarPagosDialog({ aberto, onOpenChange, onImportado }: { aberto: boolean; onOpenChange: (v: boolean) => void; onImportado: () => void }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ encontrados: { cliente_nome: string }[]; nao_encontrados: string[] } | null>(null);

  async function importar() {
    if (!texto.trim()) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const data = await api.clientes.importarPagos(texto);
      setResultado(data);
      onImportado();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => { onOpenChange(v); if (!v) { setTexto(""); setResultado(null); setErro(null); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar clientes pagos</DialogTitle>
          <DialogDescription>
            Cole abaixo os nomes de quem já pagou (1 nome por linha). O sistema casa cada nome com um
            cliente já cadastrado e aplica a tag "Pago" — quem leva essa tag sai dos disparos
            pendentes e futuros automaticamente.
          </DialogDescription>
        </DialogHeader>
        {erro && <Aviso tone="danger">{erro}</Aviso>}
        {!resultado ? (
          <>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={"João da Silva\nMaria Souza\n..."}
              rows={8}
              className="bg-surface-sunken border-border focus-ring w-full rounded-md border px-3 py-2 text-sm"
            />
            <DialogFooter>
              <Botao variante="outline" onClick={() => onOpenChange(false)}>Cancelar</Botao>
              <Botao variante="primary" onClick={importar} disabled={enviando || !texto.trim()}>
                {enviando ? "Importando…" : "Importar"}
              </Botao>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-success font-semibold">{resultado.encontrados.length}</span> cliente(s)
                marcado(s) como pago — <span className="font-semibold">{resultado.nao_encontrados.length}</span> nome(s)
                não encontrado(s).
              </p>
              {resultado.nao_encontrados.length > 0 && (
                <div className="bg-surface-sunken border-border max-h-40 overflow-y-auto rounded-md border p-2.5 text-xs">
                  <p className="text-subtle mb-1 font-medium">Não encontrados:</p>
                  {resultado.nao_encontrados.map((n, i) => (
                    <p key={i}>{n}</p>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Botao variante="primary" onClick={() => onOpenChange(false)}>Concluir</Botao>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Clientes() {
  const {
    clientes,
    clientesCarregando,
    clientesErro,
    refreshClientes,
    selecionados,
    toggleSelecionado,
    setSelecionados,
    limparSelecionados,
  } = useAppState();
  const [busca, setBusca] = useState("");
  const [filtroTag, setFiltroTag] = useState<string>("todas");
  const [filtroPix, setFiltroPix] = useState<FiltroPix>("todos");
  const [filtroDisparo, setFiltroDisparo] = useState<FiltroDisparo>("todos");
  const [modalAberto, setModalAberto] = useState(false);
  const [importarPagosAberto, setImportarPagosAberto] = useState(false);
  const [clienteEditando, setClienteEditando] = useState<Cliente | null>(null);
  const [clienteFicha, setClienteFicha] = useState<Cliente | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [enviandoPdfId, setEnviandoPdfId] = useState<string | null>(null);
  const [todasTags, setTodasTags] = useState<Tag[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.tags.listar().then(setTodasTags).catch(() => {});
  }, []);

  // Uma linha por cliente, não por número -- quem tem 2+ números vinculados
  // (ver migration-15) mostra um único cliente com os telefones combinados,
  // em vez de aparecer 2x na lista/dashboard.
  const clientesAgrupados = useMemo(() => agruparClientesPorNumero(clientes), [clientes]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return clientesAgrupados.filter((c) => {
      if (q && !(c.nome.toLowerCase().includes(q) || c.telefones.some((t) => t.includes(q)))) return false;
      if (filtroTag !== "todas" && !c.tags.some((t) => t.id === filtroTag)) return false;
      if (filtroPix === "com_pix" && !c.pix_code) return false;
      if (filtroPix === "sem_pix" && c.pix_code) return false;
      if (filtroPix === "com_fatura" && !c.pdf_url) return false;
      if (filtroPix === "sem_fatura" && c.pdf_url) return false;
      if (filtroDisparo === "recebeu" && !(c.disparos_recebidos && c.disparos_recebidos > 0)) return false;
      if (filtroDisparo === "nao_recebeu" && (c.disparos_recebidos ?? 0) > 0) return false;
      return true;
    });
  }, [clientesAgrupados, busca, filtroTag, filtroPix, filtroDisparo]);

  async function remover(id: string) {
    if (!confirm("Remover este cliente? Isso também apaga o PDF anexado.")) return;
    setRemovendo(id);
    try {
      await api.clientes.remover(id);
      await refreshClientes();
    } finally {
      setRemovendo(null);
    }
  }

  async function anexarPdf(id: string, file: File) {
    setEnviandoPdfId(id);
    try {
      await api.clientes.uploadPdf(id, file);
      await refreshClientes();
    } finally {
      setEnviandoPdfId(null);
    }
  }

  function selecionarTodosFiltrados() {
    setSelecionados(Array.from(new Set([...selecionados, ...filtrados.map((c) => c.id)])));
  }

  const contagens = {
    todos: clientesAgrupados.length,
    com_pix: clientesAgrupados.filter((c) => c.pix_code).length,
    sem_pix: clientesAgrupados.filter((c) => !c.pix_code).length,
    com_fatura: clientesAgrupados.filter((c) => c.pdf_url).length,
    sem_fatura: clientesAgrupados.filter((c) => !c.pdf_url).length,
  };

  const contagensDisparo = {
    todos: clientesAgrupados.length,
    recebeu: clientesAgrupados.filter((c) => (c.disparos_recebidos ?? 0) > 0).length,
    nao_recebeu: clientesAgrupados.filter((c) => !(c.disparos_recebidos ?? 0)).length,
  };

  return (
    <AppShell
      title="Clientes"
      subtitle="Cadastro, faturas em PDF e histórico de envios"
      actions={
        <div className="flex items-center gap-2">
          <Botao variante="outline" onClick={() => setImportarPagosAberto(true)}>
            <TagIcon className="size-3.5" />
            Importar pagos
          </Botao>
          <Botao variante="primary" onClick={() => { setClienteEditando(null); setModalAberto(true); }}>
            <Plus className="size-3.5" />
            Novo cliente
          </Botao>
        </div>
      }
    >
      <ImportarPagosDialog aberto={importarPagosAberto} onOpenChange={setImportarPagosAberto} onImportado={refreshClientes} />
      <div className="space-y-4">
        <div className="toolbar flex flex-wrap items-center gap-3">
          <Busca
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou telefone"
          />
          <Seletor
            value={filtroTag}
            onChange={(e) => setFiltroTag(e.target.value)}
            className="w-auto min-w-[9rem]"
          >
            <option value="todas">Todas as tags</option>
            {todasTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </Seletor>
          <FiltroChips
            valor={filtroPix}
            onChange={setFiltroPix}
            opcoes={[
              { valor: "todos", label: "Todos", contagem: contagens.todos },
              { valor: "com_pix", label: "Com PIX", contagem: contagens.com_pix },
              { valor: "sem_pix", label: "Sem PIX", contagem: contagens.sem_pix },
              { valor: "com_fatura", label: "Com fatura", contagem: contagens.com_fatura },
              { valor: "sem_fatura", label: "Sem fatura", contagem: contagens.sem_fatura },
            ]}
          />
          {/* [2026-08] "Quantos disparos cada cliente recebeu" -- filtro
              recebeu/não recebeu, calculado a partir de disparos_recebidos
              (ver backend/src/routes/clientes.routes.js, GET /). */}
          <FiltroChips
            valor={filtroDisparo}
            onChange={setFiltroDisparo}
            opcoes={[
              { valor: "todos", label: "Qualquer disparo", contagem: contagensDisparo.todos },
              { valor: "recebeu", label: "Já recebeu", contagem: contagensDisparo.recebeu },
              { valor: "nao_recebeu", label: "Nunca recebeu", contagem: contagensDisparo.nao_recebeu },
            ]}
          />
        </div>

        {selecionados.length > 0 && (
          <div className="bg-surface-raised border-border sticky top-16 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-2.5">
            <span className="text-sm font-medium">{selecionados.length} selecionado(s)</span>
            <div className="flex flex-wrap items-center gap-2">
              <Botao variante="ghost" tamanho="sm" onClick={selecionarTodosFiltrados}>
                Selecionar todos os filtrados
              </Botao>
              <Botao variante="ghost" tamanho="sm" onClick={limparSelecionados}>
                Limpar
              </Botao>
              <Botao variante="primary" tamanho="sm" onClick={() => navigate({ to: "/disparos" })}>
                Criar disparo
              </Botao>
            </div>
          </div>
        )}

        <SectionCard flush>
          {clientesErro ? (
            <div className="p-5">
              <Aviso tone="danger">
                {clientesErro}
                <button onClick={refreshClientes} className="ml-3 font-medium underline">
                  Tentar novamente
                </button>
              </Aviso>
            </div>
          ) : !clientesCarregando && clientes.length === 0 ? (
            <EmptyState
              icon={Users}
              titulo="Nenhum cliente cadastrado"
              descricao="Importe sua base de clientes para começar a organizar cobranças e disparos."
              acao={
                <Link to="/importar">
                  <Botao variante="primary">Importar clientes</Botao>
                </Link>
              }
            />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
                  <thead className="bg-surface-raised sticky top-0 z-[1]">
                    <tr>
                      <th className="th-cell w-10">
                        <Checkbox
                          checked={filtrados.length > 0 && filtrados.every((c) => selecionados.includes(c.id))}
                          onCheckedChange={() => {
                            const todosSelecionados = filtrados.every((c) => selecionados.includes(c.id));
                            if (todosSelecionados) {
                              setSelecionados(selecionados.filter((id) => !filtrados.some((c) => c.id === id)));
                            } else {
                              selecionarTodosFiltrados();
                            }
                          }}
                        />
                      </th>
                      <th className="th-cell">Nome</th>
                      <th className="th-cell">Telefone</th>
                      <th className="th-cell">Valor</th>
                      <th className="th-cell">Vencimento</th>
                      <th className="th-cell">PIX</th>
                      <th className="th-cell">Disparos</th>
                      <th className="th-cell">Tags</th>
                      <th className="th-cell text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientesCarregando ? (
                      <LinhasEsqueleto colunas={9} />
                    ) : (
                      filtrados.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => setClienteFicha(c)}
                          className="border-border hover:bg-surface-raised/60 cursor-pointer border-t transition-colors"
                        >
                          <td className="td-cell" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selecionados.includes(c.id)}
                              onCheckedChange={() => toggleSelecionado(c.id)}
                            />
                          </td>
                          <td className="td-cell font-medium">{c.nome}</td>
                          <td className="td-cell text-muted-foreground tabular font-mono text-xs">
                            {c.telefones.length > 1 ? (
                              <div className="flex flex-col gap-0.5">
                                {c.telefones.map((t) => (
                                  <span key={t}>{t}</span>
                                ))}
                              </div>
                            ) : (
                              c.telefones[0]
                            )}
                          </td>
                          <td className="td-cell tabular">{formatarValor(c.valor)}</td>
                          <td className="td-cell text-muted-foreground tabular">{formatarData(c.vencimento)}</td>
                          <td className="td-cell">
                            {c.pix_code ? (
                              <StatusPill tone="success" dot>
                                PIX
                              </StatusPill>
                            ) : (
                              <StatusPill tone="muted">Sem PIX</StatusPill>
                            )}
                          </td>
                          <td className="td-cell">
                            {(c.disparos_recebidos ?? 0) > 0 ? (
                              <StatusPill tone="brand" dot>
                                {c.disparos_recebidos}x
                              </StatusPill>
                            ) : (
                              <StatusPill tone="muted">Nunca</StatusPill>
                            )}
                          </td>
                          <td className="td-cell">
                            <TagPicker cliente={c} todasTags={todasTags} onChange={refreshClientes} />
                          </td>
                          <td className="td-cell text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              {!c.pdf_url && (
                                <label
                                  className="text-muted-foreground hover:text-foreground inline-flex size-7 cursor-pointer items-center justify-center rounded"
                                  title="Anexar PDF"
                                >
                                  {enviandoPdfId === c.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Upload className="size-3.5" />
                                  )}
                                  <input
                                    type="file"
                                    accept="application/pdf"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) anexarPdf(c.id, file);
                                    }}
                                  />
                                </label>
                              )}
                              <button
                                onClick={() => { setClienteEditando(c); setModalAberto(true); }}
                                aria-label="Editar cliente"
                                className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                onClick={() => remover(c.id)}
                                disabled={removendo === c.id}
                                aria-label="Remover cliente"
                                className="text-muted-foreground hover:text-destructive inline-flex size-7 items-center justify-center rounded disabled:opacity-40"
                              >
                                {removendo === c.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="size-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                    {!clientesCarregando && filtrados.length === 0 && (
                      <tr>
                        <td colSpan={9} className="text-muted-foreground px-5 py-10 text-center text-xs">
                          Nenhum cliente encontrado para os filtros aplicados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="divide-border divide-y md:hidden">
                {clientesCarregando ? (
                  <div className="space-y-3 p-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="bg-surface-sunken h-20 animate-pulse rounded-md" />
                    ))}
                  </div>
                ) : (
                  filtrados.map((c) => (
                    <div key={c.id} className="p-4" onClick={() => setClienteFicha(c)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selecionados.includes(c.id)}
                              onCheckedChange={() => toggleSelecionado(c.id)}
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{c.nome}</p>
                            <p className="text-muted-foreground font-mono text-xs">
                              {c.telefones.join(" · ")}
                            </p>
                          </div>
                        </div>
                        {c.pix_code ? (
                          <StatusPill tone="success" dot>PIX</StatusPill>
                        ) : (
                          <StatusPill tone="muted">Sem PIX</StatusPill>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="tabular">{formatarValor(c.valor)}</span>
                        <span className="text-muted-foreground tabular">{formatarData(c.vencimento)}</span>
                      </div>
                      {c.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {c.tags.map((t) => (
                            <span
                              key={t.id}
                              className="rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-border"
                              style={{ backgroundColor: `${t.cor}22`, color: t.cor }}
                            >
                              {t.nome}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Botao variante="ghost" tamanho="sm" onClick={() => { setClienteEditando(c); setModalAberto(true); }}>
                          <Pencil className="size-3.5" /> Editar
                        </Botao>
                        <Botao variante="ghost" tamanho="sm" onClick={() => remover(c.id)} disabled={removendo === c.id}>
                          {removendo === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          Remover
                        </Botao>
                      </div>
                    </div>
                  ))
                )}
                {!clientesCarregando && filtrados.length === 0 && (
                  <p className="text-muted-foreground px-4 py-10 text-center text-xs">
                    Nenhum cliente encontrado para os filtros aplicados.
                  </p>
                )}
              </div>
            </>
          )}
        </SectionCard>
      </div>

      {modalAberto && (
        <ClienteFormModal
          cliente={clienteEditando}
          onClose={() => setModalAberto(false)}
          onSalvo={refreshClientes}
        />
      )}

      <FichaCliente
        cliente={clienteFicha}
        onClose={() => setClienteFicha(null)}
        onEditar={() => {
          if (clienteFicha) {
            setClienteEditando(clienteFicha);
            setModalAberto(true);
            setClienteFicha(null);
          }
        }}
        onMudou={refreshClientes}
      />
    </AppShell>
  );
}
