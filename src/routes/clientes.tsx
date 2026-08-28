import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { paraIso, paraBr } from "@/lib/dataBr";
import {
  Check,
  Copy,
  FileSearch,
  FileText,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
  Tag as TagIcon,
  Trash2,
  Unlink,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { TagPicker } from "@/components/shared/TagPicker";
import { Botao, Busca, Campo, FiltroChips, Aviso, LinhasEsqueleto, Paginacao, Rotulo, Seletor } from "@/components/shared/Controls";
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
import { STATUS_OPERADOR_BLOQUEIA_DISPARO, type Cliente } from "@/lib/types";

const MESES_PT = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];
// "2026-09" -> "Set/2026" -- mesmo dado da coluna gerada `clientes.safra` no
// backend (ver backend/src/lib/safras.js, rotuloSafra), só que abreviado pra
// caber num chip de filtro/pill.
function rotuloSafra(safra: string | null | undefined): string {
  if (!safra || !/^\d{4}-\d{2}$/.test(safra)) return "—";
  const [ano, mes] = safra.split("-").map(Number);
  return `${MESES_PT[(mes ?? 1) - 1] ?? mes}/${ano}`;
}

// [regra de negócio] Classificação FPD/SPD + safra do cliente -- tornar
// visível isso era um pedido explícito (hoje só aparecia agregado na tela
// /safras, nunca por cliente individual). Ausente pra quem foi cadastrado
// manualmente/sem passar pela lista crua (tipo_fatura fica null nesse caso) --
// não mostra nada em vez de um pill vazio.
function SafraTipoPill({ cliente }: { cliente: Pick<Cliente, "tipo_fatura" | "safra"> }) {
  if (!cliente.tipo_fatura && !cliente.safra) return null;
  return (
    <StatusPill tone={cliente.tipo_fatura === "SPD" ? "brand" : cliente.tipo_fatura === "FPD" ? "warning" : "muted"}>
      {cliente.tipo_fatura ?? "—"} · {rotuloSafra(cliente.safra)}
    </StatusPill>
  );
}

// [regra de negócio] Sugestão de promoção FPD -> SPD (ver
// backend/src/lib/promocaoSpd.js) devolvida por POST /clientes/importar-pagos
// e POST /tags/:id/clientes/:clienteId -- nunca aplicada sozinha.
type SugestaoSpd = {
  cliente_id: string;
  cliente_nome: string;
  tipo_fatura_atual: "FPD";
  data_prazo_atual: string;
  sugestao: { tipo_fatura: "SPD"; data_prazo: string };
};
import { agruparClientesPorNumero, type ClienteAgrupado } from "@/lib/agruparClientes";
import { api, abrirArquivoProtegido } from "@/api";
import { cn, formatoMoeda } from "@/lib/utils";

export const Route = createFileRoute("/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes e faturas — Voxcel Faturas" },
      {
        name: "description",
        content:
          "Base de clientes com telefone normalizado, valor, vencimento e PDF da fatura anexado, pronta para o próximo disparo.",
      },
      { property: "og:title", content: "Clientes e faturas — Voxcel Faturas" },
      {
        property: "og:description",
        content: "Telefone normalizado, valor, vencimento e PDF anexo por cliente.",
      },
    ],
  }),
  component: Clientes,
});

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

// [CRÍTICO] Usa parseDataFlexivel (dataBr.ts) em vez de `new Date(texto)`
// direto -- `vencimento` é texto livre "DD/MM/AAAA" e o construtor Date do JS
// interpreta "/" como formato AMERICANO (MM/DD/AAAA), invertendo dia e mês
// (10/08 virava 08/10). `data_prazo` também passa por aqui (já é ISO) e
// continua funcionando normalmente.
function formatarData(data: string | null): string {
  if (!data) return "—";
  const br = paraBr(data);
  return br || data;
}

type FiltroPix = "todos" | "com_pix" | "sem_pix" | "com_fatura" | "sem_fatura";
type FiltroDisparo = "todos" | "recebeu" | "nao_recebeu";

// [layout] Vieram da ex-tela /faturas -- "nenhuma" mantém a ordem padrão
// (nome). Faturas sem valor/vencimento sempre vão pro fim da lista, não
// importa a direção -- senão "sem valor" (null) apareceria misturado no meio
// como se fosse zero, o que confunde mais do que ajuda.
type Ordenacao = "nenhuma" | "valor_asc" | "valor_desc" | "vencimento_asc" | "vencimento_desc";

function valorNumero(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const numero = Number(String(valor).replace(",", "."));
  return Number.isFinite(numero) ? numero : null;
}

function compararComNuloNoFim<T extends number | string>(a: T | null, b: T | null, direcao: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return -1 * direcao;
  if (a > b) return 1 * direcao;
  return 0;
}

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
  // Estado do campo fica em ISO (é o que o `<input type="date">` nativo exige
  // pra exibir/editar corretamente) -- `cliente.vencimento` vem em texto livre
  // (BR ou ISO, dependendo de como foi preenchido, ver dataBr.ts), por isso
  // sempre passa por `paraIso` aqui. Convertido de volta pra BR só na hora de
  // salvar (formato usado na exibição e na variável {{vencimento}} da mensagem).
  const [vencimento, setVencimento] = useState(paraIso(cliente?.vencimento));
  const [pdf, setPdf] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    const vencimentoBr = paraBr(vencimento) || undefined;
    try {
      if (cliente) {
        await api.clientes.atualizar(cliente.id, { nome, telefone, valor, vencimento: vencimentoBr });
      } else {
        const novo = await api.clientes.criar({ nome, telefone, valor, vencimento: vencimentoBr });
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
              <Campo1 label="Prazo" valor={formatarData(cliente.data_prazo ?? null)} />
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
                        style={{ backgroundColor: `color-mix(in oklab, ${t.cor} 18%, transparent)`, color: t.cor }}
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
                valor={
                  cliente.ultimo_envio_em
                    ? `${formatarData(cliente.ultimo_envio_em)}${cliente.ultimo_envio_status ? ` · ${cliente.ultimo_envio_status}` : ""}`
                    : "—"
                }
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
  const [resultado, setResultado] = useState<{ encontrados: { cliente_nome: string }[]; nao_encontrados: string[]; sugestoes_spd: SugestaoSpd[] } | null>(null);
  // [regra de negócio] FPD pago -> sugestão de virar SPD na próxima safra (ver
  // backend/src/lib/promocaoSpd.js). Nunca aplica sozinho -- guarda aqui só
  // pra controlar edição da data sugerida e quais já foram confirmadas/
  // descartadas pelo operador nesta sessão do diálogo.
  const [datasEditadas, setDatasEditadas] = useState<Record<string, string>>({});
  const [promovendo, setPromovendo] = useState<string | null>(null);
  const [promovidos, setPromovidos] = useState<Set<string>>(new Set());
  const [erroPromocao, setErroPromocao] = useState<string | null>(null);

  async function importar() {
    if (!texto.trim()) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    setDatasEditadas({});
    setPromovidos(new Set());
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

  async function confirmarPromocao(s: SugestaoSpd) {
    setPromovendo(s.cliente_id);
    setErroPromocao(null);
    try {
      await api.clientes.promoverSpd(s.cliente_id, datasEditadas[s.cliente_id]);
      setPromovidos((atual) => new Set(atual).add(s.cliente_id));
      onImportado();
    } catch (e) {
      setErroPromocao((e as Error).message);
    } finally {
      setPromovendo(null);
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
              {resultado.sugestoes_spd.length > 0 && (
                <div className="border-border space-y-2 rounded-md border p-2.5">
                  <p className="text-subtle text-xs font-medium">
                    {resultado.sugestoes_spd.length} cliente(s) FPD pago(s) — entram na próxima safra como SPD.
                    Confirme (ou ajuste) a data de vencimento do SPD de cada um:
                  </p>
                  {erroPromocao && <Aviso tone="danger">{erroPromocao}</Aviso>}
                  {resultado.sugestoes_spd.map((s) => (
                    <div key={s.cliente_id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate font-medium">{s.cliente_nome}</span>
                      <span className="text-subtle">FPD {formatarData(s.data_prazo_atual)} →</span>
                      {promovidos.has(s.cliente_id) ? (
                        <span className="text-success font-medium">SPD confirmado</span>
                      ) : (
                        <>
                          <input
                            type="date"
                            value={datasEditadas[s.cliente_id] ?? s.sugestao.data_prazo}
                            onChange={(e) =>
                              setDatasEditadas((atual) => ({ ...atual, [s.cliente_id]: e.target.value }))
                            }
                            className="bg-surface-sunken border-border focus-ring rounded-md border px-2 py-1"
                          />
                          <Botao
                            variante="outline"
                            onClick={() => confirmarPromocao(s)}
                            disabled={promovendo === s.cliente_id}
                          >
                            {promovendo === s.cliente_id ? "Confirmando…" : "Confirmar SPD"}
                          </Botao>
                        </>
                      )}
                    </div>
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

// [layout] Movido da ex-tela /faturas (agora unificada aqui, ver prompt
// original: "unificar clientes e faturas preservando relacionamentos,
// filtros, permissões e detalhes") -- "1 PDF (ou vários) subido direto, sem
// passar pela importação em massa (zip + planilha)". O backend tenta casar
// pelo nome do arquivo com um cliente já cadastrado; não achando, o PDF fica
// "pendente" e a associação acontece sozinha quando o cliente certo for
// criado depois (ver backend/src/lib/faturasPendentes.js).
type ResultadoAvulso = { arquivo: string; associado: boolean; cliente_nome: string | undefined };
type PendenciaAvulsa = {
  id: string;
  arquivo: string;
  pdf_url: string;
  pix_code: string | null;
  valor: string | null;
  vencimento: string | null;
  criado_em: string;
};

// [CRÍTICO] Botão + progresso da verificação em massa de VENCIMENTO (lê o PDF
// já anexado de cada cliente, ver backend/src/services/verificacaoVencimentos.js
// e api.clientes.verificarVencimentos). Roda em background no servidor -- este
// componente só dispara o job e faz polling do status (mesmo padrão de
// polling usado pra conexão WhatsApp em app-state.tsx, só que aqui sob
// demanda, não o tempo todo).
type StatusVerificacaoVencimentos = {
  rodando: boolean;
  total: number;
  processados: number;
  encontrados: number;
  nao_encontrados: number;
  erros: { cliente_id: string; cliente_nome: string; erro: string }[];
  iniciado_em: string | null;
  concluido_em: string | null;
};

function VerificacaoVencimentos({ onAtualizado }: { onAtualizado: () => void }) {
  const [status, setStatus] = useState<StatusVerificacaoVencimentos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const avisouConclusaoRef = useRef(false);

  useEffect(() => {
    if (!status?.rodando) return;
    const id = setInterval(async () => {
      try {
        const atual = await api.clientes.statusVerificarVencimentos();
        setStatus(atual);
      } catch {
        // Falha de rede isolada no polling não derruba o job (que continua
        // rodando no servidor) -- só tenta de novo no próximo tick.
      }
    }, 2500);
    return () => clearInterval(id);
  }, [status?.rodando]);

  useEffect(() => {
    if (status && !status.rodando && status.concluido_em && !avisouConclusaoRef.current) {
      avisouConclusaoRef.current = true;
      toast.success(
        `Verificação concluída: ${status.encontrados} vencimento(s) encontrado(s) de ${status.total} PDF(s) verificado(s).`,
      );
      onAtualizado();
    }
    if (status?.rodando) avisouConclusaoRef.current = false;
  }, [status, onAtualizado]);

  async function iniciar(apenasPendentes: boolean) {
    setErro(null);
    try {
      const estado = await api.clientes.verificarVencimentos(apenasPendentes);
      setStatus(estado);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (!status) {
    return (
      <div className="flex items-center gap-1.5">
        <Botao variante="outline" onClick={() => iniciar(true)}>
          <FileSearch className="size-3.5" />
          Verificar vencimentos nos PDFs
        </Botao>
        {/* [CRÍTICO] Clientes que passaram pela lista crua ou promoção FPD->SPD
            ANTES da correção do bug de vencimento=prazo (ver CONTEXTO.md) podem
            já ter um `vencimento` preenchido, só que ERRADO -- "apenas
            pendentes" (o padrão) nunca revê quem já tem algum vencimento
            gravado. Esta opção força reverificar todo mundo com PDF. */}
        <button
          type="button"
          onClick={() => iniciar(false)}
          title="Reverifica todo mundo com PDF anexado, mesmo quem já tem vencimento gravado -- útil pra corrigir dados salvos antes da correção do bug de vencimento=prazo."
          className="text-muted-foreground hover:text-foreground text-[11px] underline decoration-dotted underline-offset-2"
        >
          revalidar todos
        </button>
      </div>
    );
  }

  if (status.rodando) {
    const pct = status.total ? Math.round((status.processados / status.total) * 100) : 0;
    return (
      <div className="border-border bg-surface-raised flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
        <Loader2 className="text-primary size-3.5 shrink-0 animate-spin" />
        <span className="text-muted-foreground whitespace-nowrap">
          Verificando PDFs... {status.processados}/{status.total} ({pct}%)
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Botao variante="outline" onClick={() => iniciar(true)}>
        <FileSearch className="size-3.5" />
        Verificar vencimentos nos PDFs
      </Botao>
      <button
        type="button"
        onClick={() => iniciar(false)}
        title="Reverifica todo mundo com PDF anexado, mesmo quem já tem vencimento gravado -- útil pra corrigir dados salvos antes da correção do bug de vencimento=prazo."
        className="text-muted-foreground hover:text-foreground text-[11px] underline decoration-dotted underline-offset-2"
      >
        revalidar todos
      </button>
      {erro && <span className="text-destructive text-xs">{erro}</span>}
    </div>
  );
}

function UploadAvulsoFaturas({ onAssociado }: { onAssociado: () => void }) {
  const { clientes } = useAppState();
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoAvulso[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pendencias, setPendencias] = useState<PendenciaAvulsa[]>([]);
  const [carregandoPendencias, setCarregandoPendencias] = useState(false);
  const [vinculandoId, setVinculandoId] = useState<string | null>(null);
  const [clienteEscolhido, setClienteEscolhido] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [aberto, setAberto] = useState(false);

  const carregarPendencias = useCallback(async () => {
    setCarregandoPendencias(true);
    try {
      const data = await api.faturas.pendentes.listar();
      setPendencias(Array.isArray(data) ? data : []);
    } catch {
      // silencioso -- lista de pendências é só um extra de conveniência
    } finally {
      setCarregandoPendencias(false);
    }
  }, []);

  useEffect(() => {
    carregarPendencias();
  }, [carregarPendencias]);

  async function enviarArquivos(files: File[]) {
    const pdfs = files.filter((f) => f.type === "application/pdf");
    if (!pdfs.length) return;
    setEnviando(true);
    setErro(null);
    setResultados([]);
    for (const file of pdfs) {
      try {
        const resp = await api.faturas.uploadAvulso(file);
        setResultados((prev) => [...prev, { arquivo: file.name, associado: !!resp.associado, cliente_nome: resp.cliente_nome }]);
      } catch (e) {
        setErro((e as Error).message);
        setResultados((prev) => [...prev, { arquivo: file.name, associado: false, cliente_nome: undefined }]);
      }
    }
    setEnviando(false);
    onAssociado();
    await carregarPendencias();
  }

  async function associarManualmente(id: string) {
    if (!clienteEscolhido) return;
    try {
      await api.faturas.pendentes.associar(id, clienteEscolhido);
      setVinculandoId(null);
      setClienteEscolhido("");
      onAssociado();
      await carregarPendencias();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function descartar(id: string) {
    if (!confirm("Descartar este PDF pendente?")) return;
    try {
      await api.faturas.pendentes.remover(id);
      await carregarPendencias();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const resumo = pendencias.length > 0 ? `${pendencias.length} pendente(s) de associação` : "nenhuma pendência";

  return (
    <SectionCard
      titulo="Upload de faturas avulsas"
      descricao="Suba PDFs soltos, sem precisar de planilha. O sistema casa cada um com um cliente já cadastrado pelo nome do arquivo; não achando, fica pendente e associa sozinho assim que esse cliente for cadastrado."
      acoes={
        <div className="flex items-center gap-2">
          {!aberto && <span className="text-subtle hidden text-xs sm:inline">{resumo}</span>}
          <button
            onClick={() => setAberto((v) => !v)}
            className="text-subtle hover:text-foreground focus-ring rounded p-1"
            aria-label={aberto ? "Recolher" : "Expandir"}
          >
            <Plus className={cn("size-4 transition-transform", aberto && "rotate-45")} />
          </button>
        </div>
      }
    >
      {!aberto ? (
        <p className="text-subtle text-xs sm:hidden">{resumo}</p>
      ) : (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastando(false);
              enviarArquivos(Array.from(e.dataTransfer.files ?? []));
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
              arrastando ? "border-primary bg-primary-soft" : "border-border hover:border-border-strong bg-surface-sunken",
            )}
          >
            <Upload className="text-primary-strong size-5" />
            <p className="text-sm font-medium">Arraste PDFs soltos aqui ou clique para selecionar</p>
            <p className="text-subtle text-xs">Cada arquivo é enviado e casado individualmente — sem planilha, sem zip.</p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) enviarArquivos(files);
                e.target.value = "";
              }}
            />
          </div>

          {enviando && <Aviso tone="info">Enviando e casando arquivos…</Aviso>}
          {erro && <Aviso tone="danger">{erro}</Aviso>}

          {resultados.length > 0 && (
            <div className="space-y-1.5 text-xs">
              {resultados.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.arquivo}</span>
                  {r.associado ? (
                    <StatusPill tone="success">Associado a {r.cliente_nome}</StatusPill>
                  ) : (
                    <StatusPill tone="warning">Aguardando cliente correspondente</StatusPill>
                  )}
                </div>
              ))}
            </div>
          )}

          {(carregandoPendencias || pendencias.length > 0) && (
            <div className="border-border border-t pt-3">
              <p className="text-subtle mb-2 text-xs font-medium">
                Pendentes de associação {pendencias.length > 0 && `(${pendencias.length})`}
              </p>
              {carregandoPendencias ? (
                <div className="bg-surface-sunken h-16 w-full animate-pulse rounded-md" />
              ) : (
                <div className="divide-border divide-y">
                  {pendencias.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <button
                        type="button"
                        onClick={() => abrirArquivoProtegido(p.pdf_url).catch(() => toast.error("Não foi possível abrir o PDF"))}
                        className="text-primary-strong flex min-w-0 items-center gap-1.5 text-xs hover:underline"
                      >
                        <FileText className="size-3.5 shrink-0" />
                        <span className="truncate">{p.arquivo}</span>
                      </button>
                      {vinculandoId === p.id ? (
                        <div className="flex items-center gap-1.5">
                          <Seletor value={clienteEscolhido} onChange={(e) => setClienteEscolhido(e.target.value)} className="w-auto min-w-[10rem]">
                            <option value="">Selecione um cliente</option>
                            {clientes.map((c) => (
                              <option key={c.id} value={c.id}>{c.nome}</option>
                            ))}
                          </Seletor>
                          <Botao tamanho="sm" variante="primary" onClick={() => associarManualmente(p.id)} disabled={!clienteEscolhido}>
                            Vincular
                          </Botao>
                          <Botao tamanho="sm" variante="ghost" onClick={() => { setVinculandoId(null); setClienteEscolhido(""); }}>
                            <X className="size-3.5" />
                          </Botao>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Botao tamanho="sm" variante="ghost" onClick={() => setVinculandoId(p.id)}>
                            <Link2 className="size-3.5" />
                            Vincular
                          </Botao>
                          <Botao tamanho="sm" variante="ghost" onClick={() => descartar(p.id)}>
                            <X className="size-3.5" />
                            Descartar
                          </Botao>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </SectionCard>
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
  // Chegada via link de /safras ("ver clientes desta safra", ?safra=YYYY-MM)
  // já pré-seleciona o filtro -- lido direto da URL (sem validateSearch
  // tipado na rota, único jeito hoje de receber esse parâmetro).
  const [filtroSafra, setFiltroSafra] = useState<string>(() => {
    if (typeof window === "undefined") return "todas";
    return new URLSearchParams(window.location.search).get("safra") ?? "todas";
  });
  // [layout] Vieram da ex-tela /faturas (agora unificada aqui) -- faixa de
  // vencimento, faixa de valor e ordenação. Mesma lógica de comparação de
  // antes (null sempre no fim, funciona pra crescente e decrescente).
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("nenhuma");
  // [layout] Faixa de data/valor + ordenação ficam atrás de "Mais filtros" em
  // vez de soltas na toolbar principal -- são usadas bem menos que
  // tag/safra/pix/disparo, e a barra já tinha 4 controles antes destes.
  const filtrosAvancadosAtivos = Boolean(de || ate || valorMin || valorMax || ordenacao !== "nenhuma");
  const [filtrosAvancadosAbertos, setFiltrosAvancadosAbertos] = useState(false);
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

  // [regra de negócio] Safras ativas presentes nesta carteira -- mesma
  // origem de dado que a tela /safras (coluna gerada `clientes.safra`, ver
  // backend/src/lib/safras.js), só que aqui filtrada client-side (a lista de
  // clientes já vem inteira do backend pra esta tela, mesmo padrão dos
  // outros filtros abaixo). Mais recente primeiro.
  const safrasDisponiveis = useMemo(() => {
    const distintas = new Set(clientesAgrupados.map((c) => c.safra).filter((s): s is string => Boolean(s)));
    return [...distintas].sort().reverse();
  }, [clientesAgrupados]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    // Campos "Valor mín/máx" aceitam vírgula (padrão BR) além de ponto.
    const min = valorMin.trim() ? Number(valorMin.trim().replace(",", ".")) : null;
    const max = valorMax.trim() ? Number(valorMax.trim().replace(",", ".")) : null;

    const resultado = clientesAgrupados.filter((c) => {
      if (q && !(c.nome.toLowerCase().includes(q) || c.telefones.some((t) => t.includes(q)))) return false;
      if (filtroTag !== "todas" && !c.tags.some((t) => t.id === filtroTag)) return false;
      if (filtroPix === "com_pix" && !c.pix_code) return false;
      if (filtroPix === "sem_pix" && c.pix_code) return false;
      if (filtroPix === "com_fatura" && !c.pdf_url) return false;
      if (filtroPix === "sem_fatura" && c.pdf_url) return false;
      if (filtroDisparo === "recebeu" && !(c.disparos_recebidos && c.disparos_recebidos > 0)) return false;
      if (filtroDisparo === "nao_recebeu" && (c.disparos_recebidos ?? 0) > 0) return false;
      if (filtroSafra !== "todas" && c.safra !== filtroSafra) return false;
      // [CRÍTICO] `de`/`ate` vêm do `<input type="date">` (sempre ISO), mas
      // `c.vencimento` é texto livre (BR ou ISO, ver dataBr.ts) -- comparar as
      // strings cruas dava resultado errado quase sempre (ex: "10/08/2026" <
      // "2026-08-01" é sempre verdadeiro por comparação lexicográfica, mesmo
      // quando a data real é posterior). Normaliza os dois lados pra ISO antes
      // de comparar.
      if (de || ate) {
        const vencIso = paraIso(c.vencimento);
        if (de && vencIso && vencIso < de) return false;
        if (ate && vencIso && vencIso > ate) return false;
      }
      if (min !== null || max !== null) {
        const v = valorNumero(c.valor);
        if (v === null) return false; // sem valor não entra num filtro de faixa
        if (min !== null && Number.isFinite(min) && v < min) return false;
        if (max !== null && Number.isFinite(max) && v > max) return false;
      }
      return true;
    });

    if (ordenacao === "nenhuma") return resultado;
    const comparadores: Record<Exclude<Ordenacao, "nenhuma">, (a: typeof resultado[number], b: typeof resultado[number]) => number> = {
      valor_asc: (a, b) => compararComNuloNoFim(valorNumero(a.valor), valorNumero(b.valor), 1),
      valor_desc: (a, b) => compararComNuloNoFim(valorNumero(a.valor), valorNumero(b.valor), -1),
      // [CRÍTICO] Comparar `vencimento` como string crua ordenava errado
      // (texto BR "DD/MM/AAAA" não ordena cronologicamente por comparação
      // lexicográfica) -- normaliza pra ISO antes de comparar.
      vencimento_asc: (a, b) => compararComNuloNoFim(paraIso(a.vencimento) || null, paraIso(b.vencimento) || null, 1),
      vencimento_desc: (a, b) => compararComNuloNoFim(paraIso(a.vencimento) || null, paraIso(b.vencimento) || null, -1),
    };
    return [...resultado].sort(comparadores[ordenacao]);
  }, [clientesAgrupados, busca, filtroTag, filtroPix, filtroDisparo, filtroSafra, de, ate, valorMin, valorMax, ordenacao]);

  // [paginação] Lista em memória inteira já vem filtrada/ordenada acima --
  // aqui só fatia pra exibição, 50 por página, pra não renderizar a carteira
  // inteira de uma vez. Qualquer mudança de filtro/busca/ordenação volta pra
  // página 1 (senão o usuário podia ficar "preso" numa página 5 vazia depois
  // de filtrar pra um resultado menor).
  const TAMANHO_PAGINA = 30;
  const [pagina, setPagina] = useState(1);
  useEffect(() => {
    setPagina(1);
  }, [busca, filtroTag, filtroPix, filtroDisparo, filtroSafra, de, ate, valorMin, valorMax, ordenacao]);
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAMANHO_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const paginados = useMemo(
    () => filtrados.slice((paginaSegura - 1) * TAMANHO_PAGINA, paginaSegura * TAMANHO_PAGINA),
    [filtrados, paginaSegura],
  );
  // [2026-08] Checkbox "marcar todos" do cabeçalho da tabela: só marca a
  // página atual (não a lista filtrada inteira, que pode ter centenas de
  // clientes fora de tela) e pula quem tem alguma tag com `permite_disparo:
  // false` (ex.: Pago/Cancelado) OU um status de tratativa que bloqueia
  // disparo (ex.: pagamento_confirmado/fraude -- ver aba Qualidade e
  // backend/src/lib/statusOperador.js) -- esses já saem do lote
  // automaticamente no backend (ver envios.routes.js, bloqueadosPorTag),
  // então marcá-los aqui só ia gerar um aviso confuso de "N ficaram de fora"
  // pro operador.
  const paginadosElegiveis = useMemo(
    () =>
      paginados.filter(
        (c) =>
          c.tags.every((t) => t.permite_disparo) &&
          !(c.status_operador && STATUS_OPERADOR_BLOQUEIA_DISPARO.has(c.status_operador)),
      ),
    [paginados],
  );
  const idsPaginaElegiveis = paginadosElegiveis.map((c) => c.id);
  function alternarSelecaoPagina() {
    const todosSelecionados = idsPaginaElegiveis.length > 0 && idsPaginaElegiveis.every((id) => selecionados.includes(id));
    if (todosSelecionados) {
      setSelecionados(selecionados.filter((id) => !idsPaginaElegiveis.includes(id)));
    } else {
      setSelecionados(Array.from(new Set([...selecionados, ...idsPaginaElegiveis])));
    }
  }

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
          <VerificacaoVencimentos onAtualizado={refreshClientes} />
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
        <UploadAvulsoFaturas onAssociado={refreshClientes} />

        <div className="toolbar flex flex-wrap items-center gap-2">
          {/* [2026-08] Busca é `flex-1` por padrão (Controls.tsx) pra crescer
              sozinha numa toolbar mais vazia -- aqui, com 2 seletores + 2
              grupos de chips na mesma linha, isso empurrava o próprio texto
              pra cima do seletor de tags em telas médias. `flex-none` +
              largura fixa tira a caixa de busca dessa disputa por espaço,
              igual ao padrão de busca de largura fixa do CRM da empresa. */}
          <Busca
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="flex-none w-full sm:w-52"
          />
          <Seletor
            value={filtroTag}
            onChange={(e) => setFiltroTag(e.target.value)}
            className="w-auto min-w-[8rem]"
          >
            <option value="todas">Todas as tags</option>
            {todasTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </Seletor>
          {safrasDisponiveis.length > 0 && (
            <Seletor
              value={filtroSafra}
              onChange={(e) => setFiltroSafra(e.target.value)}
              className="w-auto min-w-[8rem]"
            >
              <option value="todas">Todas as safras</option>
              {safrasDisponiveis.map((s) => (
                <option key={s} value={s}>
                  {rotuloSafra(s)}
                </option>
              ))}
            </Seletor>
          )}
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
            Mais filtros
            {filtrosAvancadosAtivos && <span className="bg-primary-strong size-1.5 rounded-full" />}
          </button>
        </div>

        {filtrosAvancadosAbertos && (
          <div className="toolbar flex flex-wrap items-end gap-3">
            <div>
              <Rotulo>Vencimento de</Rotulo>
              <Campo type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-auto" />
            </div>
            <div>
              <Rotulo>até</Rotulo>
              <Campo type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-auto" />
            </div>
            <div>
              <Rotulo>Valor de</Rotulo>
              <Campo
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0,00"
                value={valorMin}
                onChange={(e) => setValorMin(e.target.value)}
                className="w-24"
              />
            </div>
            <div>
              <Rotulo>até</Rotulo>
              <Campo
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0,00"
                value={valorMax}
                onChange={(e) => setValorMax(e.target.value)}
                className="w-24"
              />
            </div>
            <div>
              <Rotulo>Ordenar por</Rotulo>
              <Seletor value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as Ordenacao)} className="w-auto">
                <option value="nenhuma">Nome (padrão)</option>
                <option value="valor_asc">Valor: menor → maior</option>
                <option value="valor_desc">Valor: maior → menor</option>
                <option value="vencimento_asc">Vencimento: mais próximo</option>
                <option value="vencimento_desc">Vencimento: mais distante</option>
              </Seletor>
            </div>
            {filtrosAvancadosAtivos && (
              <Botao
                variante="ghost"
                tamanho="sm"
                onClick={() => { setDe(""); setAte(""); setValorMin(""); setValorMax(""); setOrdenacao("nenhuma"); }}
              >
                Limpar
              </Botao>
            )}
          </div>
        )}

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
                          checked={idsPaginaElegiveis.length > 0 && idsPaginaElegiveis.every((id) => selecionados.includes(id))}
                          onCheckedChange={alternarSelecaoPagina}
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
                      paginados.map((c) => (
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
                          <td className="td-cell font-medium">
                            <div className="flex flex-col items-start gap-1">
                              <span>{c.nome}</span>
                              <SafraTipoPill cliente={c} />
                            </div>
                          </td>
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
                            <div className="flex flex-col items-start gap-1">
                              {(c.disparos_recebidos ?? 0) > 0 ? (
                                <StatusPill tone="brand" dot>
                                  {c.disparos_recebidos}x
                                </StatusPill>
                              ) : (
                                <StatusPill tone="muted">Nunca</StatusPill>
                              )}
                              {c.ultimo_envio_em && (
                                <span className="text-subtle text-[11px]">
                                  último: {formatarData(c.ultimo_envio_em)}
                                  {c.ultimo_envio_status ? ` · ${c.ultimo_envio_status}` : ""}
                                </span>
                              )}
                            </div>
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
                  paginados.map((c) => (
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
                            <div className="mt-1">
                              <SafraTipoPill cliente={c} />
                            </div>
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
                              style={{ backgroundColor: `color-mix(in oklab, ${t.cor} 18%, transparent)`, color: t.cor }}
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

              {!clientesCarregando && (
                <Paginacao
                  paginaAtual={paginaSegura}
                  totalPaginas={totalPaginas}
                  totalItens={filtrados.length}
                  tamanhoPagina={TAMANHO_PAGINA}
                  onMudarPagina={setPagina}
                />
              )}
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
