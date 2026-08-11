import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Copy, FileText, FileWarning, KeyRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Aviso, Botao, Busca, Campo, FiltroChips, LinhasEsqueleto, Rotulo } from "@/components/shared/Controls";
import { StatusPill } from "@/components/shared/StatusPill";
import { api } from "@/api";

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

function formatarData(data: string | null): string {
  if (!data) return "—";
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return data;
  return format(d, "dd/MM/yyyy", { locale: ptBR });
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

type FiltroFatura = "todas" | "com_pdf" | "sem_pdf" | "com_pix" | "sem_pix";

function Faturas() {
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroFatura>("todas");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

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
    return faturas.filter((f) => {
      if (filtro === "com_pdf" && !f.pdf_url) return false;
      if (filtro === "sem_pdf" && f.pdf_url) return false;
      if (filtro === "com_pix" && !f.pix_code) return false;
      if (filtro === "sem_pix" && f.pix_code) return false;
      if (de && f.vencimento && f.vencimento < de) return false;
      if (ate && f.vencimento && f.vencimento > ate) return false;
      return true;
    });
  }, [faturas, filtro, de, ate]);

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
                      <LinhasEsqueleto colunas={7} />
                    ) : (
                      filtradas.map((f) => (
                        <tr key={f.id} className="border-border border-t">
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
                              <a
                                href={f.pdf_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary-strong inline-flex items-center gap-1.5 text-xs hover:underline"
                              >
                                <FileText className="size-3.5" />
                                Ver PDF
                              </a>
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
                        <td colSpan={7} className="text-muted-foreground px-5 py-10 text-center text-xs">
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
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{f.cliente_nome}</p>
                          <p className="text-muted-foreground font-mono text-xs">{f.telefone}</p>
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
                        <a
                          href={f.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary-strong mt-2 inline-flex items-center gap-1.5 text-xs hover:underline"
                        >
                          <FileText className="size-3.5" />
                          Ver PDF
                        </a>
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
