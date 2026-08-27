import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Copy, FileText, FileWarning, KeyRound, Link2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Aviso, Botao, Busca, Campo, FiltroChips, LinhasEsqueleto, Rotulo, Seletor } from "@/components/shared/Controls";
import { StatusPill } from "@/components/shared/StatusPill";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppState } from "@/lib/app-state";
import { api, abrirArquivoProtegido } from "@/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/faturas")({
  head: () => ({
    meta: [
      { title: "Faturas — Veloce Faturas" },
      {
        name: "description",
        content: "Lista de faturas com valor, vencimento, chave PIX e PDF anexado por cliente.",
      },
      { property: "og:title", content: "Faturas — Veloce Faturas" },
      { property: "og:description", content: "Valor, vencimento, PIX e PDF de cada fatura em um só lugar." },
    ],
  }),
  component: Faturas,
});

type Fatura = {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  telefone: string;
  valor: string | null;
  vencimento: string | null;
  pdf_url: string | null;
  pix_code: string | null;
  ultimo_envio_em: string | null;
  ultimo_envio_status: string | null;
};

const formatoMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatarValor(valor: string | null): string {
  if (!valor) return "—";
  const numero = Number(String(valor).replace(",", "."));
  if (Number.isFinite(numero)) return formatoMoeda.format(numero);
  return valor;
}

function valorNumero(valor: string | null): number | null {
  if (!valor) return null;
  const numero = Number(String(valor).replace(",", "."));
  return Number.isFinite(numero) ? numero : null;
}

// Compara 2 valores (número ou string comparável, ex: data ISO) que podem
// ser `null` -- `null` sempre vai pro fim, nas duas direções (`direcao` só
// controla a ordem entre os valores presentes: 1 = crescente, -1 =
// decrescente).
function compararComNuloNoFim<T extends number | string>(a: T | null, b: T | null, direcao: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return -1 * direcao;
  if (a > b) return 1 * direcao;
  return 0;
}

function formatarData(data: string | null): string {
  if (!data) return "—";
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return data;
  return format(d, "dd/MM/yyyy", { locale: ptBR });
}

function BotaoCopiar({ texto }: { texto: string }) {  const [copiado, setCopiado] = useState(false);
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

type FiltroFatura = "todas" | "com_pdf" | "sem_pdf" | "com_pix" | "sem_pix";

// "nenhuma" mantém a ordem que a API já devolve (mais recente primeiro).
// Faturas sem valor/vencimento sempre vão pro fim da lista, não importa a
// direção -- senão "sem valor" (null) apareceria misturado no meio como se
// fosse zero, o que confunde mais do que ajuda.
type Ordenacao = "nenhuma" | "valor_asc" | "valor_desc" | "vencimento_asc" | "vencimento_desc";

type ResultadoAvulso = { arquivo: string; associado: boolean; cliente_nome?: string };

type Pendencia = {
  id: string;
  arquivo: string;
  pdf_url: string;
  pix_code: string | null;
  valor: string | null;
  vencimento: string | null;
  criado_em: string;
};

// [2026-08] "Upload de PDFs avulsos, sem depender de planilha" -- 1 PDF (ou
// vários, um de cada vez) é subido direto, sem passar pela importação em
// massa (zip + planilha). O backend tenta casar pelo nome do arquivo com um
// cliente já cadastrado; achando, associa na hora; não achando, o PDF fica
// "pendente" e a associação acontece sozinha quando o cliente certo for
// criado depois (ver backend/src/lib/faturasPendentes.js). Esta seção
// também lista as pendências pra vínculo manual, se necessário.
function UploadAvulsoFaturas({ onAssociado }: { onAssociado: () => void }) {
  const { clientes } = useAppState();
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoAvulso[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [carregandoPendencias, setCarregandoPendencias] = useState(false);
  const [vinculandoId, setVinculandoId] = useState<string | null>(null);
  const [clienteEscolhido, setClienteEscolhido] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);

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
        setResultados((prev) => [...prev, { arquivo: file.name, associado: false }]);
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

  return (
    <SectionCard
      titulo="Upload de faturas avulsas"
      descricao="Suba PDFs soltos, sem precisar de planilha. O sistema casa cada um com um cliente já cadastrado pelo nome do arquivo; não achando, fica pendente e associa sozinho assim que esse cliente for cadastrado."
    >
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
    </SectionCard>
  );
}

function Faturas() {
  const { selecionados, toggleSelecionado, setSelecionados, limparSelecionados } = useAppState();
  const navigate = useNavigate();
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroFatura>("todas");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("nenhuma");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = busca.trim() ? { busca: busca.trim() } : undefined;
      const data = await api.faturas.listar(params);
      setFaturas(Array.isArray(data) ? data : []);
      setErro(null);
    } catch (e) {
      setFaturas([]);
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [busca]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const filtradas = useMemo(() => {
    // Campos "Valor mín/máx" aceitam vírgula (padrão BR) além de ponto.
    const min = valorMin.trim() ? Number(valorMin.trim().replace(",", ".")) : null;
    const max = valorMax.trim() ? Number(valorMax.trim().replace(",", ".")) : null;

    const resultado = faturas.filter((f) => {
      if (filtro === "com_pdf" && !f.pdf_url) return false;
      if (filtro === "sem_pdf" && f.pdf_url) return false;
      if (filtro === "com_pix" && !f.pix_code) return false;
      if (filtro === "sem_pix" && f.pix_code) return false;
      if (de && f.vencimento && f.vencimento < de) return false;
      if (ate && f.vencimento && f.vencimento > ate) return false;
      if (min !== null || max !== null) {
        const v = valorNumero(f.valor);
        if (v === null) return false; // sem valor não entra num filtro de faixa
        if (min !== null && Number.isFinite(min) && v < min) return false;
        if (max !== null && Number.isFinite(max) && v > max) return false;
      }
      return true;
    });

    if (ordenacao === "nenhuma") return resultado;

    const comparadores: Record<Exclude<Ordenacao, "nenhuma">, (a: Fatura, b: Fatura) => number> = {
      valor_asc: (a, b) => compararComNuloNoFim(valorNumero(a.valor), valorNumero(b.valor), 1),
      valor_desc: (a, b) => compararComNuloNoFim(valorNumero(a.valor), valorNumero(b.valor), -1),
      vencimento_asc: (a, b) => compararComNuloNoFim(a.vencimento, b.vencimento, 1),
      vencimento_desc: (a, b) => compararComNuloNoFim(a.vencimento, b.vencimento, -1),
    };
    return [...resultado].sort(comparadores[ordenacao]);
  }, [faturas, filtro, de, ate, valorMin, valorMax, ordenacao]);

  function selecionarTodasFiltradas() {
    setSelecionados(Array.from(new Set([...selecionados, ...filtradas.map((f) => f.cliente_id)])));
  }

  const contagens = {
    todas: faturas.length,
    com_pdf: faturas.filter((f) => f.pdf_url).length,
    sem_pdf: faturas.filter((f) => !f.pdf_url).length,
    com_pix: faturas.filter((f) => f.pix_code).length,
    sem_pix: faturas.filter((f) => !f.pix_code).length,
  };

  return (
    <AppShell title="Faturas" subtitle="Valor, vencimento, chave PIX e PDF por cliente">
      <div className="space-y-4">
        <UploadAvulsoFaturas onAssociado={carregar} />

        <div className="toolbar flex flex-wrap items-end gap-3">
          <Busca value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por cliente ou telefone" />
          <div>
            <Rotulo>De</Rotulo>
            <Campo type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-auto" />
          </div>
          <div>
            <Rotulo>Até</Rotulo>
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
              <option value="nenhuma">Mais recentes</option>
              <option value="valor_asc">Valor: menor → maior</option>
              <option value="valor_desc">Valor: maior → menor</option>
              <option value="vencimento_asc">Vencimento: mais próximo</option>
              <option value="vencimento_desc">Vencimento: mais distante</option>
            </Seletor>
          </div>
          <FiltroChips
            valor={filtro}
            onChange={setFiltro}
            opcoes={[
              { valor: "todas", label: "Todas", contagem: contagens.todas },
              { valor: "com_pdf", label: "Com PDF", contagem: contagens.com_pdf },
              { valor: "sem_pdf", label: "Sem PDF", contagem: contagens.sem_pdf },
              { valor: "com_pix", label: "Com PIX", contagem: contagens.com_pix },
              { valor: "sem_pix", label: "Sem PIX", contagem: contagens.sem_pix },
            ]}
          />
        </div>

        {selecionados.length > 0 && (
          <div className="bg-surface-raised border-border sticky top-16 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-2.5">
            <span className="text-sm font-medium">{selecionados.length} selecionado(s)</span>
            <div className="flex flex-wrap items-center gap-2">
              <Botao variante="ghost" tamanho="sm" onClick={selecionarTodasFiltradas}>
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
          {erro ? (
            <div className="p-5">
              <Aviso tone="danger">
                {erro}
                <button onClick={carregar} className="ml-3 font-medium underline">
                  Tentar novamente
                </button>
              </Aviso>
            </div>
          ) : !carregando && faturas.length === 0 ? (
            <EmptyState
              icon={FileWarning}
              titulo="Nenhuma fatura encontrada"
              descricao="Importe clientes com faturas em PDF ou extraia chaves PIX para começar."
              acao={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link to="/importar">
                    <Botao variante="primary">Importar clientes</Botao>
                  </Link>
                  <Link to="/pix">
                    <Botao variante="secondary">Extrator de PIX</Botao>
                  </Link>
                </div>
              }
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
                  <thead className="bg-surface-raised sticky top-0 z-[1]">
                    <tr>
                      <th className="th-cell w-10">
                        <Checkbox
                          checked={filtradas.length > 0 && filtradas.every((f) => selecionados.includes(f.cliente_id))}
                          onCheckedChange={() => {
                            const todasSelecionadas = filtradas.every((f) => selecionados.includes(f.cliente_id));
                            if (todasSelecionadas) {
                              setSelecionados(selecionados.filter((id) => !filtradas.some((f) => f.cliente_id === id)));
                            } else {
                              selecionarTodasFiltradas();
                            }
                          }}
                        />
                      </th>
                      <th className="th-cell">Cliente</th>
                      <th className="th-cell">Telefone</th>
                      <th className="th-cell">Valor</th>
                      <th className="th-cell">Vencimento</th>
                      <th className="th-cell">Chave PIX</th>
                      <th className="th-cell">PDF</th>
                      <th className="th-cell">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carregando ? (
                      <LinhasEsqueleto colunas={8} />
                    ) : (
                      filtradas.map((f) => (
                        <tr key={f.id} className="border-border border-t">
                          <td className="td-cell">
                            <Checkbox
                              checked={selecionados.includes(f.cliente_id)}
                              onCheckedChange={() => toggleSelecionado(f.cliente_id)}
                            />
                          </td>
                          <td className="td-cell font-medium">{f.cliente_nome}</td>
                          <td className="td-cell text-muted-foreground tabular font-mono text-xs">{f.telefone}</td>
                          <td className="td-cell tabular">{formatarValor(f.valor)}</td>
                          <td className="td-cell text-muted-foreground tabular">{formatarData(f.vencimento)}</td>
                          <td className="td-cell">
                            {f.pix_code ? (
                              <div className="flex max-w-[12rem] items-center gap-1.5">
                                <KeyRound className="text-muted-foreground size-3.5 shrink-0" />
                                <span className="truncate font-mono text-xs">{f.pix_code}</span>
                                <BotaoCopiar texto={f.pix_code} />
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="td-cell">
                            {f.pdf_url ? (
                              <button
                                type="button"
                                onClick={() => abrirArquivoProtegido(f.pdf_url).catch(() => toast.error("Não foi possível abrir o PDF"))}
                                className="text-primary-strong inline-flex items-center gap-1.5 text-xs hover:underline"
                              >
                                <FileText className="size-3.5" />
                                Ver PDF
                              </button>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="td-cell">
                            {f.ultimo_envio_status ? (
                              <StatusPill tone="info">{f.ultimo_envio_status}</StatusPill>
                            ) : (
                              <StatusPill tone="muted">Sem envio</StatusPill>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                    {!carregando && filtradas.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-muted-foreground px-5 py-10 text-center text-xs">
                          Nenhuma fatura encontrada para os filtros aplicados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="divide-border divide-y md:hidden">
                {carregando ? (
                  <div className="space-y-3 p-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="bg-surface-sunken h-24 animate-pulse rounded-md" />
                    ))}
                  </div>
                ) : (
                  filtradas.map((f) => (
                    <div key={f.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <Checkbox
                            checked={selecionados.includes(f.cliente_id)}
                            onCheckedChange={() => toggleSelecionado(f.cliente_id)}
                            className="mt-0.5 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{f.cliente_nome}</p>
                            <p className="text-muted-foreground font-mono text-xs">{f.telefone}</p>
                          </div>
                        </div>
                        {f.ultimo_envio_status ? (
                          <StatusPill tone="info">{f.ultimo_envio_status}</StatusPill>
                        ) : (
                          <StatusPill tone="muted">Sem envio</StatusPill>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="tabular">{formatarValor(f.valor)}</span>
                        <span className="text-muted-foreground tabular">{formatarData(f.vencimento)}</span>
                      </div>
                      {f.pix_code && (
                        <div className="bg-surface-sunken mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5">
                          <KeyRound className="text-muted-foreground size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.pix_code}</span>
                          <BotaoCopiar texto={f.pix_code} />
                        </div>
                      )}
                      {f.pdf_url && (
                        <button
                          type="button"
                          onClick={() => abrirArquivoProtegido(f.pdf_url).catch(() => toast.error("Não foi possível abrir o PDF"))}
                          className="text-primary-strong mt-2 inline-flex items-center gap-1.5 text-xs hover:underline"
                        >
                          <FileText className="size-3.5" />
                          Ver PDF
                        </button>
                      )}
                    </div>
                  ))
                )}
                {!carregando && filtradas.length === 0 && (
                  <p className="text-muted-foreground px-4 py-10 text-center text-xs">
                    Nenhuma fatura encontrada para os filtros aplicados.
                  </p>
                )}
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
