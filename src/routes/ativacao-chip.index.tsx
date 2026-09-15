import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  ClipboardList,
  Cpu,
  History,
  ImagePlus,
  Loader2,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
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
  Campo,
  LinhasEsqueleto,
  Paginacao,
  Rotulo,
  Seletor,
  TabelaWrap,
} from "@/components/shared/Controls";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, buscarBlobUrlProtegida } from "@/api";
import { paraBr } from "@/lib/dataBr";
import type { Cliente, StatusChip } from "@/lib/types";

// [2026-09] ATIVAÇÃO CHIP: campanha nova, EM PARALELO à de cobrança -- os
// clientes ficam separados (campanha='chip_ativacao' em `clientes`, ver
// backend/migration-25-ativacao-chip.sql), com planilha, gerenciamento e chat
// (ver /ativacao-chip/chat) próprios. Ver CONTEXTO.md.
//
// [2026-09] É a rota ÍNDICE de /ativacao-chip (não mais o arquivo
// ativacao-chip.tsx) -- ver esse arquivo pra entender por quê: precisa
// existir como layout puro com <Outlet/> pra /ativacao-chip/chat conseguir
// renderizar de verdade em vez de sempre cair nesta lista de clientes.
export const Route = createFileRoute("/ativacao-chip/")({
  head: () => ({
    meta: [
      { title: "Ativação Chip — Voxcel Faturas" },
      {
        name: "description",
        content: "Clientes da campanha de ativação de chip -- separados da carteira de cobrança.",
      },
    ],
  }),
  component: AtivacaoChip,
});

const TAMANHO_PAGINA = 20;

function tonePorStatus(valor: StatusChip | null | undefined, bloqueiaDisparo: boolean): Tone {
  if (!valor) return "muted";
  if (valor === "chip_ativado") return "success";
  if (valor === "recusado" || valor === "numero_invalido") return "danger";
  if (bloqueiaDisparo) return "warning";
  return "info";
}

function ImportarPlanilhaDialog({
  aberto,
  onOpenChange,
  onImportado,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  onImportado: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ criados: number; erros: number; total: number } | null>(null);

  async function importar() {
    if (!arquivo) return;
    setImportando(true);
    setErro(null);
    try {
      const r = await api.ativacaoChip.importar(arquivo);
      setResultado({ criados: r.criados, erros: r.erros.length, total: r.total });
      toast.success(`${r.criados} cliente(s) importado(s).`);
      onImportado();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setImportando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) {
          setArquivo(null);
          setErro(null);
          setResultado(null);
          if (inputRef.current) inputRef.current.value = "";
        }
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar planilha de Ativação Chip</DialogTitle>
          <DialogDescription>
            Colunas esperadas: OPERADORA, OS, CLIENTE, CPF, cidade, BKO (RESPONSÁVEL), VENDEDOR,
            TEL 1/2/3. Reimportar atualiza quem já existe (por telefone), sem duplicar.
          </DialogDescription>
        </DialogHeader>

        {erro && <Aviso tone="danger">{erro}</Aviso>}
        {resultado && (
          <Aviso tone={resultado.erros ? "warning" : "info"}>
            {resultado.criados} de {resultado.total} linha(s) importada(s)
            {resultado.erros ? `, ${resultado.erros} com problema (confira nome/telefone na planilha)` : ""}.
          </Aviso>
        )}

        <div>
          <Rotulo htmlFor="ativacao-chip-arquivo">Arquivo (.xlsx, .xls ou .csv)</Rotulo>
          <input
            ref={inputRef}
            id="ativacao-chip-arquivo"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setArquivo(e.target.files?.[0] || null)}
            className="border-border bg-surface w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <DialogFooter>
          <Botao variante="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Botao>
          <Botao variante="primary" onClick={importar} disabled={!arquivo || importando}>
            {importando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Importar
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoricoStatusChip({
  clienteId,
  statusCatalogo,
}: {
  clienteId: string;
  statusCatalogo: { valor: StatusChip; rotulo: string; bloqueia_disparo: boolean }[];
}) {
  const { data: historico, isLoading } = useQuery({
    queryKey: ["ativacao-chip-historico", clienteId],
    queryFn: () => api.ativacaoChip.historico(clienteId),
  });
  const rotuloPorValor = new Map(statusCatalogo.map((s) => [s.valor, s.rotulo]));

  if (isLoading) return <p className="text-subtle text-xs">Carregando histórico…</p>;
  if (!historico || historico.length === 0) {
    return <p className="text-subtle text-xs">Nenhum status registrado ainda para este cliente.</p>;
  }
  return (
    <ol className="border-border max-h-48 space-y-3 overflow-y-auto border-t pt-3 text-xs">
      {historico.map((t) => (
        <li key={t.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{rotuloPorValor.get(t.status as StatusChip) || t.status}</span>
            <span className="text-subtle">{paraBr(t.criado_em)}</span>
          </div>
          {t.observacao && <p className="text-muted-foreground">{t.observacao}</p>}
        </li>
      ))}
    </ol>
  );
}

function RegistrarStatusDialog({
  cliente,
  statusCatalogo,
  onOpenChange,
  onRegistrado,
}: {
  cliente: Cliente | null;
  statusCatalogo: { valor: StatusChip; rotulo: string; bloqueia_disparo: boolean }[];
  onOpenChange: (v: boolean) => void;
  onRegistrado: () => void;
}) {
  const [status, setStatus] = useState<StatusChip | "">("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!cliente || !status) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.ativacaoChip.registrarStatus(cliente.id, { status, observacao: observacao.trim() || undefined });
      toast.success(`Status atualizado para ${cliente.nome}.`);
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
          <DialogTitle>Registrar status — {cliente?.nome}</DialogTitle>
          <DialogDescription>{cliente?.telefone}</DialogDescription>
        </DialogHeader>

        {erro && <Aviso tone="danger">{erro}</Aviso>}

        <div className="space-y-3">
          <div>
            <Rotulo htmlFor="ativacao-chip-status">Status</Rotulo>
            <Seletor id="ativacao-chip-status" value={status} onChange={(e) => setStatus(e.target.value as StatusChip)}>
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
            <Rotulo htmlFor="ativacao-chip-observacao">Observação (opcional)</Rotulo>
            <textarea
              id="ativacao-chip-observacao"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: pediu pra ligar amanhã, chip já ativado por telefone…"
              rows={3}
              className="bg-surface text-foreground border-border focus-ring w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          {cliente && (
            <div>
              <p className="label-eyebrow mb-2 flex items-center gap-1.5">
                <History className="size-3.5" /> Histórico
              </p>
              <HistoricoStatusChip clienteId={cliente.id} statusCatalogo={statusCatalogo} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Botao variante="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Botao>
          <Botao variante="primary" onClick={salvar} disabled={!status || salvando}>
            {salvando ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Registrar
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// [2026-09] Miniatura da foto recém-anexada ao lote -- `url` é um path do
// proxy de arquivos (bucket privado chat-midia, ver
// backend/migration-26-disparo-foto.sql), não uma URL pública: precisa de
// fetch autenticado + Blob antes de virar `src` de `<img>` (mesmo padrão de
// MidiaProtegida em routes/chat.tsx, versão local aqui pra não acoplar as
// duas telas).
function PreviaFoto({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let urlCriada: string | null = null;
    buscarBlobUrlProtegida(url)
      .then((u) => {
        if (cancelado) {
          if (u) URL.revokeObjectURL(u);
          return;
        }
        urlCriada = u;
        setBlobUrl(u);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
  }, [url]);

  if (!blobUrl) return <div className="bg-foreground/10 size-12 shrink-0 animate-pulse rounded-md" />;
  return <img src={blobUrl} alt="Foto do disparo" className="size-12 shrink-0 rounded-md object-cover" />;
}

type FotoLote = { path: string; mimetype: string; nome: string; url: string };

// [2026-09] Disparo simplificado, direto desta tela -- diferente da tela de
// Disparos normal (que tem variações de mensagem, janela de tempo,
// agendamento etc.), essa aqui manda 1 texto pra quem foi marcado na tabela e
// já dispara na hora. A tela de Disparos completa não foi estendida pra chip
// nesta primeira leva porque a seleção de clientes de lá é acoplada ao estado
// global da carteira de cobrança (useAppState) -- misturar as duas exigiria
// mexer em estado usado em várias telas, risco maior do que o "por enquanto"
// pedido. Server-side já filtra elegibilidade certa pra campanha de chip
// (nunca exige PDF/Pix, ver backend/src/routes/envios.routes.js).
//
// [2026-09] FOTO ANEXADA: pedido explícito pra ficar AQUI (Ativação Chip) e
// não na tela de Disparos normal (Safra/cobrança) -- cliente de chip nunca
// tem fatura em PDF cadastrada, então uma imagem (print de instrução,
// propaganda etc) junto do texto é o equivalente do PDF pra essa campanha.
// Upload acontece na hora (antes do lote existir de verdade, ver
// POST /envios/anexo-foto) -- o path só é gravado no envio quando
// `api.envios.criar()` roda de fato, logo abaixo.
function DispararDialog({
  aberto,
  quantidade,
  clienteIds,
  onOpenChange,
  onDisparado,
}: {
  aberto: boolean;
  quantidade: number;
  clienteIds: string[];
  onOpenChange: (v: boolean) => void;
  onDisparado: () => void;
}) {
  const [mensagem, setMensagem] = useState("");
  const [foto, setFoto] = useState<FotoLote | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputFotoRef = useRef<HTMLInputElement>(null);

  async function selecionarFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois de remover
    if (!arquivo) return;
    setEnviandoFoto(true);
    setErro(null);
    try {
      const r = await api.envios.enviarFoto(arquivo);
      setFoto({ path: r.foto_path, mimetype: r.foto_mimetype, nome: r.foto_nome, url: r.foto_url });
    } catch (e2) {
      setErro((e2 as Error).message);
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function disparar() {
    if (!mensagem.trim() || !clienteIds.length) return;
    setEnviando(true);
    setErro(null);
    try {
      const envio = await api.envios.criar({
        cliente_ids: clienteIds,
        mensagem: mensagem.trim(),
        campanha: "chip_ativacao",
        livre: true,
        ...(foto ? { foto_path: foto.path, foto_mimetype: foto.mimetype, foto_nome: foto.nome } : {}),
      });
      await api.envios.disparar(envio.id);
      toast.success(`Disparo iniciado para ${clienteIds.length} cliente(s).`);
      setMensagem("");
      setFoto(null);
      onDisparado();
      onOpenChange(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) setErro(null);
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disparar para {quantidade} cliente(s)</DialogTitle>
          <DialogDescription>
            Mensagem de texto simples -- use {"{{nome}}"} e {"{{telefone}}"} se quiser personalizar.
          </DialogDescription>
        </DialogHeader>

        {erro && <Aviso tone="danger">{erro}</Aviso>}

        <div>
          <Rotulo htmlFor="ativacao-chip-mensagem">Mensagem</Rotulo>
          <textarea
            id="ativacao-chip-mensagem"
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            placeholder="Ex.: Olá {{nome}}, tudo bem? Vamos ativar seu chip novo, pode falar agora?"
            rows={4}
            className="bg-surface text-foreground border-border focus-ring w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <Rotulo>Foto (opcional)</Rotulo>
          <input ref={inputFotoRef} type="file" accept="image/*" onChange={selecionarFoto} className="hidden" />
          {foto ? (
            <div className="border-border flex items-center gap-3 rounded-md border px-3 py-2">
              <PreviaFoto url={foto.url} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{foto.nome}</p>
                <p className="text-subtle text-xs">Anexada em todas as mensagens deste disparo.</p>
              </div>
              <Botao variante="ghost" tamanho="sm" onClick={() => setFoto(null)}>
                <X className="size-3.5" />
                Remover
              </Botao>
            </div>
          ) : (
            <Botao
              variante="outline"
              tamanho="sm"
              onClick={() => inputFotoRef.current?.click()}
              disabled={enviandoFoto}
            >
              {enviandoFoto ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
              Escolher foto
            </Botao>
          )}
        </div>

        <DialogFooter>
          <Botao variante="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Botao>
          <Botao variante="primary" onClick={disparar} disabled={!mensagem.trim() || enviando}>
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Disparar
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AtivacaoChip() {
  const [busca, setBusca] = useState("");
  // [2026-09] Filtro por DATA DE CADASTRO (quando o cliente foi adicionado a
  // esta campanha) -- mesmo pedido/critério do filtro equivalente na tela de
  // Clientes normal (routes/clientes.tsx), só que aqui é filtro DE SERVIDOR
  // (`GET /clientes?cadastrado_de=...&cadastrado_ate=...`), não em memória --
  // esta lista é paginada no backend, diferente da de cobrança que já traz
  // tudo de uma vez. Escolher o mesmo dia nos dois campos filtra só aquele dia.
  const [cadastradoDe, setCadastradoDe] = useState("");
  const [cadastradoAte, setCadastradoAte] = useState("");
  const [pagina, setPagina] = useState(1);
  const [importarAberto, setImportarAberto] = useState(false);
  const [clienteEmStatus, setClienteEmStatus] = useState<Cliente | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [dispararAberto, setDispararAberto] = useState(false);

  const { data: statusCatalogo } = useQuery({
    queryKey: ["ativacao-chip-status"],
    queryFn: () => api.ativacaoChip.status(),
    staleTime: 5 * 60_000,
  });

  const {
    data: lista,
    error: erroObj,
    refetch: recarregar,
    isLoading: carregando,
  } = useQuery({
    queryKey: ["ativacao-chip-clientes", busca, cadastradoDe, cadastradoAte, pagina],
    queryFn: () =>
      api.clientes.listar({
        busca: busca.trim() || undefined,
        cadastrado_de: cadastradoDe || undefined,
        cadastrado_ate: cadastradoAte || undefined,
        campanha: "chip_ativacao",
        page: pagina,
        per_page: TAMANHO_PAGINA,
      }),
    staleTime: 10_000,
  });
  const erro = erroObj ? (erroObj as Error).message : null;

  const rotuloPorValor = new Map((statusCatalogo || []).map((s) => [s.valor, s.rotulo]));
  const bloqueiaPorValor = new Map((statusCatalogo || []).map((s) => [s.valor, s.bloqueia_disparo]));

  const itens = lista?.itens ?? [];
  const total = lista?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA));

  function alternarSelecao(id: string) {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  const todosDaPaginaSelecionados = itens.length > 0 && itens.every((c) => selecionados.has(c.id));

  function alternarSelecaoPagina() {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      if (todosDaPaginaSelecionados) {
        for (const c of itens) proximo.delete(c.id);
      } else {
        for (const c of itens) proximo.add(c.id);
      }
      return proximo;
    });
  }

  async function remover(cliente: Cliente) {
    if (!confirm(`Remover ${cliente.nome} da Ativação Chip? Isso apaga o histórico de status dele.`)) return;
    try {
      await api.clientes.remover(cliente.id);
      toast.success(`${cliente.nome} removido.`);
      setSelecionados((prev) => {
        const proximo = new Set(prev);
        proximo.delete(cliente.id);
        return proximo;
      });
      recarregar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <AppShell
      title="Ativação Chip"
      subtitle="Campanha separada da carteira de cobrança -- clientes, planilha e status próprios."
      actions={
        <div className="flex items-center gap-2">
          {selecionados.size > 0 && (
            <Botao variante="secondary" onClick={() => setDispararAberto(true)}>
              <Send className="size-4" /> Disparar ({selecionados.size})
            </Botao>
          )}
          <Botao variante="primary" onClick={() => setImportarAberto(true)}>
            <Upload className="size-4" /> Importar planilha
          </Botao>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {erro && <Aviso tone="danger">{erro}</Aviso>}

        <SectionCard
          titulo="Clientes"
          descricao="Carteira exclusiva desta campanha -- não aparece na tela de Clientes normal (cobrança) e vice-versa."
          acoes={
            <>
              <Busca
                placeholder="Buscar por nome ou telefone…"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setPagina(1);
                }}
              />
              <div className="flex items-end gap-2">
                <div>
                  <Rotulo>Adicionado de</Rotulo>
                  <Campo
                    type="date"
                    value={cadastradoDe}
                    onChange={(e) => {
                      setCadastradoDe(e.target.value);
                      setPagina(1);
                    }}
                    className="w-auto"
                  />
                </div>
                <div>
                  <Rotulo>até</Rotulo>
                  <Campo
                    type="date"
                    value={cadastradoAte}
                    onChange={(e) => {
                      setCadastradoAte(e.target.value);
                      setPagina(1);
                    }}
                    className="w-auto"
                  />
                </div>
                {(cadastradoDe || cadastradoAte) && (
                  <Botao
                    variante="ghost"
                    tamanho="sm"
                    onClick={() => {
                      setCadastradoDe("");
                      setCadastradoAte("");
                      setPagina(1);
                    }}
                  >
                    Limpar
                  </Botao>
                )}
              </div>
            </>
          }
          flush
        >
          {carregando ? (
            <TabelaWrap>
              <tbody>
                <LinhasEsqueleto colunas={8} linhas={6} />
              </tbody>
            </TabelaWrap>
          ) : itens.length === 0 ? (
            <EmptyState
              icon={Cpu}
              titulo={busca ? "Nada encontrado" : "Nenhum cliente ainda"}
              descricao={
                busca
                  ? "Ninguém bate com essa busca."
                  : "Importe a planilha de Ativação Chip pra começar (botão no topo da tela)."
              }
              acao={
                !busca ? (
                  <Botao variante="primary" onClick={() => setImportarAberto(true)}>
                    <Upload className="size-4" /> Importar planilha
                  </Botao>
                ) : undefined
              }
            />
          ) : (
            <>
              <TabelaWrap>
                <thead>
                  <tr className="border-border text-subtle border-b">
                    <th className="th-cell w-8">
                      <Checkbox checked={todosDaPaginaSelecionados} onCheckedChange={alternarSelecaoPagina} aria-label="Selecionar todos desta página" />
                    </th>
                    <th className="th-cell">Cliente</th>
                    <th className="th-cell">Telefone</th>
                    <th className="th-cell">Operadora</th>
                    <th className="th-cell">Cidade</th>
                    <th className="th-cell">OS</th>
                    <th className="th-cell">Status</th>
                    <th className="th-cell" />
                  </tr>
                </thead>
                <tbody>
                  {itens.map((c) => (
                    <tr key={c.id} className="border-border border-t">
                      <td className="td-cell">
                        <Checkbox checked={selecionados.has(c.id)} onCheckedChange={() => alternarSelecao(c.id)} aria-label={`Selecionar ${c.nome}`} />
                      </td>
                      <td className="td-cell font-medium">{c.nome}</td>
                      <td className="td-cell font-mono text-xs">
                        {c.telefone}
                        {(c.telefone_2 || c.telefone_3) && (
                          <span className="text-subtle ml-1">
                            (+{[c.telefone_2, c.telefone_3].filter(Boolean).length})
                          </span>
                        )}
                      </td>
                      <td className="td-cell">{c.operadora || "—"}</td>
                      <td className="td-cell">{c.cidade || "—"}</td>
                      <td className="td-cell">{c.os_numero || "—"}</td>
                      <td className="td-cell">
                        <StatusPill
                          tone={tonePorStatus(
                            c.status_operador as StatusChip | null,
                            Boolean(c.status_operador && bloqueiaPorValor.get(c.status_operador as StatusChip)),
                          )}
                        >
                          {c.status_operador
                            ? rotuloPorValor.get(c.status_operador as StatusChip) || c.status_operador
                            : "Pendente"}
                        </StatusPill>
                      </td>
                      <td className="td-cell">
                        <div className="flex items-center gap-1">
                          <Botao variante="ghost" tamanho="sm" onClick={() => setClienteEmStatus(c)}>
                            <ClipboardList className="size-3.5" /> Status
                          </Botao>
                          <Botao variante="ghost" tamanho="sm" onClick={() => remover(c)}>
                            <Trash2 className="text-destructive size-3.5" />
                          </Botao>
                        </div>
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

      <ImportarPlanilhaDialog
        aberto={importarAberto}
        onOpenChange={setImportarAberto}
        onImportado={() => {
          setImportarAberto(false);
          recarregar();
        }}
      />
      <RegistrarStatusDialog
        cliente={clienteEmStatus}
        statusCatalogo={statusCatalogo || []}
        onOpenChange={(v) => {
          if (!v) setClienteEmStatus(null);
        }}
        onRegistrado={recarregar}
      />
      <DispararDialog
        aberto={dispararAberto}
        quantidade={selecionados.size}
        clienteIds={[...selecionados]}
        onOpenChange={setDispararAberto}
        onDisparado={() => {
          setSelecionados(new Set());
          recarregar();
        }}
      />
    </AppShell>
  );
}
