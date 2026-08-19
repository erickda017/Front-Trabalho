import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Copy,
  FileText,
  KeyRound,
  Link2,
  RefreshCcw,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusPill } from "@/components/shared/StatusPill";
import { Aviso, Botao, LinhasEsqueleto, TabelaWrap } from "@/components/shared/Controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/api";
import { extrairDadosPixViaWorker } from "@/lib/pixWorkerClient";
import { casarClientePorArquivo } from "@/lib/clienteMatch";
import { useAppState } from "@/lib/app-state";
import type { PixExtracao, PixExtracaoStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pix")({
  head: () => ({
    meta: [
      { title: "Extrator de PIX — Veloce Faturas" },
      {
        name: "description",
        content: "Envie faturas em PDF e acompanhe a extração automática da chave PIX de cada cliente.",
      },
      { property: "og:title", content: "Extrator de PIX — Veloce Faturas" },
      {
        property: "og:description",
        content: "Upload de faturas em PDF com extração e vínculo automático da chave PIX.",
      },
    ],
  }),
  component: Pix,
});

const statusInfo: Record<PixExtracaoStatus, { label: string; tone: "muted" | "brand" | "success" | "warning" | "danger" }> = {
  aguardando: { label: "Aguardando", tone: "muted" },
  processando: { label: "Processando", tone: "brand" },
  encontrado: { label: "Encontrado", tone: "success" },
  nao_encontrado: { label: "Não encontrado", tone: "warning" },
  erro: { label: "Erro", tone: "danger" },
};

function formatarTamanho(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatarData(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function CopiarChave({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valor);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        } catch {
          // silencioso: falha de permissão do navegador
        }
      }}
      className="focus-ring text-muted-foreground hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded"
      aria-label="Copiar chave PIX"
      title="Copiar chave PIX"
    >
      {copiado ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Dropzone({
  onFiles,
}: {
  onFiles: (files: File[]) => void;
}) {
  const [arrastando, setArrastando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type === "application/pdf");
        if (files.length) onFiles(files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2.5 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
        arrastando ? "border-primary bg-primary-soft" : "border-border hover:border-border-strong bg-surface-sunken",
      )}
    >
      <div className="bg-surface text-primary-strong grid size-10 place-items-center rounded-lg shadow-panel">
        <Upload className="size-4.5" />
      </div>
      <div>
        <p className="text-sm font-medium">Arraste as faturas em PDF aqui</p>
        <p className="text-subtle mt-0.5 text-xs">ou clique para selecionar um ou mais arquivos</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// Limites do lote de upload -- puramente de UX (evita selecionar centenas de
// PDFs de uma vez e travar a aba, já que o fatiamento + chamadas ao Worker
// rodam no navegador). Não é mais um limite HTTP do backend (ele nem recebe
// o PDF nesse fluxo).
const MAX_ARQUIVOS = 100;
const MAX_TOTAL_MB = 300;
// Processa em PACOTES de 10: sobe os 10 primeiros arquivos em paralelo,
// espera TODOS os 10 terminarem (sucesso ou falha, não interessa) e só então
// pega os próximos 10 da fila. Nada de esteira contínua -- é pacote fechado
// mesmo, do jeito que foi pedido. Isso também dá um resultado parcial visível
// a cada pacote, em vez de só no fim do arquivo 100.
const TAMANHO_LOTE_EXTRACAO = 10;

type ResumoEnvio = {
  total: number;
  processados: number;
  sucesso: number;
  falha: number;
};

function Pix() {
  const { clientes } = useAppState();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [resumoEnvio, setResumoEnvio] = useState<ResumoEnvio | null>(null);

  const [extracoes, setExtracoes] = useState<PixExtracao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState<PixExtracao | null>(null);
  const [clienteEscolhido, setClienteEscolhido] = useState("");
  const [salvandoVinculo, setSalvandoVinculo] = useState(false);
  const [erroVinculo, setErroVinculo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const data = await api.pix.listar();
      setExtracoes(Array.isArray(data) ? data : []);
      setErroLista(null);
    } catch (e) {
      setErroLista((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const temPendente = useMemo(
    () => extracoes.some((e) => e.status === "aguardando" || e.status === "processando"),
    [extracoes],
  );

  useEffect(() => {
    if (!temPendente) return;
    const interval = setInterval(carregar, 4000);
    return () => clearInterval(interval);
  }, [temPendente, carregar]);

  const tamanhoTotalMb = useMemo(() => arquivos.reduce((soma, f) => soma + f.size, 0) / (1024 * 1024), [arquivos]);
  const loteExcedeLimite = arquivos.length > MAX_ARQUIVOS || tamanhoTotalMb > MAX_TOTAL_MB;

  function adicionarArquivos(novos: File[]) {
    setArquivos((prev) => [...prev, ...novos]);
    setErroEnvio(null);
    setResumoEnvio(null);
  }

  function removerArquivo(idx: number) {
    setArquivos((prev) => prev.filter((_, i) => i !== idx));
  }

  // Processa `itens` em pacotes de `tamanhoLote`: dispara todos os itens do
  // pacote atual em paralelo (Promise.allSettled -- um item com erro não
  // derruba os outros do mesmo pacote) e só avança pro próximo pacote quando
  // TODOS os itens do atual já terminaram, com sucesso ou falha.
  async function processarEmLotes<T>(itens: T[], tamanhoLote: number, tarefa: (item: T) => Promise<void>) {
    for (let inicio = 0; inicio < itens.length; inicio += tamanhoLote) {
      const pacote = itens.slice(inicio, inicio + tamanhoLote);
      await Promise.allSettled(pacote.map((item) => tarefa(item)));
    }
  }

  // Pipeline 100% client-side: fatia cada PDF (pdf-lib) e manda página por
  // página pro Cloudflare Worker de OCR até achar o Pix, com fallback de
  // renderização local só quando necessário (ver src/lib/pixWorkerClient.ts)
  // -- o PDF em si NUNCA é enviado pro backend pra ser processado. O backend
  // só entra depois, pra: 1) guardar o PDF já pronto no Storage e associá-lo
  // ao cliente casado (POST /clientes/:id/pdf, repasse puro de bytes -- sem
  // OCR/render no servidor) e 2) registrar a extração na tabela de auditoria
  // (POST /boletos/salvar-pix, só JSON). Processa em pacotes de 10 -- ver
  // TAMANHO_LOTE_EXTRACAO/processarEmLotes.
  async function extrair() {
    if (!arquivos.length || loteExcedeLimite) return;
    setEnviando(true);
    setErroEnvio(null);
    const total = arquivos.length;
    setResumoEnvio({ total, processados: 0, sucesso: 0, falha: 0 });

    await processarEmLotes(arquivos, TAMANHO_LOTE_EXTRACAO, async (arquivo) => {
      try {
        const dados = await extrairDadosPixViaWorker(arquivo, arquivo.name);
        if (!dados) {
          setResumoEnvio((prev) =>
            prev ? { ...prev, processados: prev.processados + 1, falha: prev.falha + 1 } : prev,
          );
          return;
        }

        // Casa o arquivo com um cliente já cadastrado pelo nome (100% no
        // navegador, contra a lista de clientes já carregada -- ver
        // clienteMatch.ts). Achou: sobe o PDF pro Storage E grava
        // pix/valor/vencimento direto no cliente, num único passo (reusa
        // `dados`, não roda o Worker de novo pro mesmo arquivo).
        const clienteCasado = casarClientePorArquivo(arquivo.name, clientes);
        if (clienteCasado) {
          await api.clientes.uploadPdf(clienteCasado.id, arquivo, dados);
        }

        // Mantém o histórico na tela "Extrações" abaixo -- se já achamos o
        // cliente aqui, manda o id direto (evita o backend ter que adivinhar
        // de novo); sem casamento, a pessoa ainda pode vincular manualmente
        // na lista (botão "Vincular").
        await api.boletos.salvarPix({
          pixCopiaCola: dados.pixCopiaCola,
          valor: dados.valor,
          vencimento: dados.vencimento,
          linhaDigitavel: dados.linhaDigitavel,
          arquivo: arquivo.name,
          clienteId: clienteCasado?.id,
        });

        setResumoEnvio((prev) =>
          prev ? { ...prev, processados: prev.processados + 1, sucesso: prev.sucesso + 1 } : prev,
        );
      } catch (e) {
        // Um arquivo com erro (Worker fora do ar, PDF corrompido, falha ao
        // salvar) não derruba o resto do pacote -- só esse item conta como
        // falha e os demais do pacote continuam normalmente.
        setErroEnvio((e as Error).message);
        setResumoEnvio((prev) =>
          prev ? { ...prev, processados: prev.processados + 1, falha: prev.falha + 1 } : prev,
        );
      }
    });

    setArquivos([]);
    setEnviando(false);
    await carregar();
  }

  function abrirVinculo(extracao: PixExtracao) {
    setVinculando(extracao);
    setClienteEscolhido(extracao.cliente_id ?? "");
    setErroVinculo(null);
  }

  async function confirmarVinculo() {
    if (!vinculando || !clienteEscolhido) return;
    setSalvandoVinculo(true);
    setErroVinculo(null);
    try {
      await api.pix.aplicarNoCliente(vinculando.id, clienteEscolhido);
      setVinculando(null);
      await carregar();
    } catch (e) {
      setErroVinculo((e as Error).message);
    } finally {
      setSalvandoVinculo(false);
    }
  }

  return (
    <AppShell title="Extrator de PIX" subtitle="Envie faturas em PDF e a chave PIX de cada cliente é extraída automaticamente">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <SectionCard
            titulo="Enviar faturas"
            descricao={`Selecione um ou mais PDFs de fatura para extrair a chave PIX no seu navegador. Até ${MAX_ARQUIVOS} arquivos (${MAX_TOTAL_MB}MB) por vez.`}
            acoes={
              <Botao
                variante="primary"
                onClick={extrair}
                disabled={enviando || arquivos.length === 0 || loteExcedeLimite}
              >
                {enviando ? "Enviando…" : "Extrair PIX"}
              </Botao>
            }
          >
            <div className="space-y-4">
              <Dropzone onFiles={adicionarArquivos} />

              {arquivos.length > 0 && (
                <>
                  <p className="text-subtle text-xs">
                    {arquivos.length} arquivo(s) selecionado(s) — {tamanhoTotalMb.toFixed(1)} MB no total.
                  </p>
                  <ul className="divide-border border-border divide-y rounded-md border">
                    {arquivos.map((f, idx) => (
                      <li key={`${f.name}-${idx}`} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="text-subtle size-4 shrink-0" />
                          <span className="truncate text-sm">{f.name}</span>
                          <span className="text-subtle shrink-0 text-xs">{formatarTamanho(f.size)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removerArquivo(idx)}
                          className="focus-ring text-subtle hover:text-destructive shrink-0"
                          aria-label="Remover arquivo"
                        >
                          <X className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {loteExcedeLimite && (
                <Aviso tone="danger">
                  Lote grande demais ({arquivos.length} arquivos, {tamanhoTotalMb.toFixed(0)}MB). Limite: {MAX_ARQUIVOS}{" "}
                  arquivos ou {MAX_TOTAL_MB}MB no total. Remova alguns arquivos ou envie em partes.
                </Aviso>
              )}

              {resumoEnvio && (
                <div className="space-y-2">
                  <div className="bg-surface-sunken h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full transition-all"
                      style={{ width: `${resumoEnvio.total ? (resumoEnvio.processados / resumoEnvio.total) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-subtle text-xs">
                    {resumoEnvio.processados} / {resumoEnvio.total} processado(s)
                    {resumoEnvio.processados > 0 && (
                      <>
                        {" — "}
                        <span className="text-success">{resumoEnvio.sucesso} com sucesso</span>
                        {resumoEnvio.falha > 0 && (
                          <>
                            {", "}
                            <span className="text-destructive">{resumoEnvio.falha} com falha</span>
                          </>
                        )}
                      </>
                    )}
                    {!enviando && resumoEnvio.processados === resumoEnvio.total && resumoEnvio.total > 0 && " — concluído."}
                  </p>
                </div>
              )}

              {erroEnvio && (
                <Aviso tone="danger">{erroEnvio}</Aviso>
              )}
            </div>
          </SectionCard>

          <SectionCard titulo="Extrações" descricao="Status de extração da chave PIX por fatura enviada." flush bodyClassName="p-0">
            {erroLista ? (
              <div className="p-5">
                <Aviso tone="danger">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>{erroLista}</span>
                    <Botao tamanho="sm" variante="outline" onClick={carregar}>
                      <RefreshCcw className="size-3.5" />
                      Tentar novamente
                    </Botao>
                  </div>
                </Aviso>
              </div>
            ) : carregando ? (
              <TabelaWrap>
                <tbody>
                  <LinhasEsqueleto colunas={6} />
                </tbody>
              </TabelaWrap>
            ) : extracoes.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                titulo="Nenhuma fatura processada ainda."
                descricao="Envie um PDF de fatura acima para começar a extrair chaves PIX."
              />
            ) : (
              <TabelaWrap compact>
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[16%]" />
                  <col className="w-[22%]" />
                  <col className="w-[16%]" />
                  <col className="w-[11%]" />
                  <col className="w-[15%]" />
                </colgroup>
                <thead>
                  <tr className="border-border border-b">
                    <th className="th-cell whitespace-normal">Arquivo</th>
                    <th className="th-cell whitespace-normal">Cliente</th>
                    <th className="th-cell whitespace-normal">Chave PIX</th>
                    <th className="th-cell whitespace-normal">Status</th>
                    <th className="th-cell whitespace-normal">Data</th>
                    <th className="th-cell text-right whitespace-normal">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {extracoes.map((e) => {
                    const info = statusInfo[e.status] ?? statusInfo.aguardando;
                    return (
                      <tr key={e.id} className="border-border border-t align-top">
                        <td className="td-cell">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <FileText className="text-subtle size-3.5 shrink-0" />
                            <span className="min-w-0 truncate" title={e.arquivo}>{e.arquivo}</span>
                          </span>
                        </td>
                        <td className="td-cell">
                          <span className="block truncate" title={e.cliente_nome ?? undefined}>
                            {e.cliente_nome ?? <span className="text-subtle">Não vinculado</span>}
                          </span>
                        </td>
                        <td className="td-cell">
                          {e.pix_code ? (
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="min-w-0 truncate font-mono text-xs" title={e.pix_code}>
                                {e.pix_code}
                              </span>
                              <CopiarChave valor={e.pix_code} />
                            </span>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </td>
                        <td className="td-cell">
                          <div className="space-y-1">
                            <StatusPill tone={info.tone} dot pulse={e.status === "processando"}>
                              {info.label}
                            </StatusPill>
                            {e.erro && <p className="text-destructive text-[11px] text-pretty">{e.erro}</p>}
                          </div>
                        </td>
                        <td className="td-cell text-subtle text-xs">{formatarData(e.criado_em)}</td>
                        <td className="td-cell">
                          <div className="flex flex-wrap justify-end gap-2">
                            {!e.cliente_id && (
                              <Botao tamanho="sm" variante="ghost" onClick={() => abrirVinculo(e)} className="whitespace-nowrap">
                                <Link2 className="size-3.5" />
                                Vincular
                              </Botao>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TabelaWrap>
            )}
          </SectionCard>
        </div>

        <div className="lg:col-span-4">
          <SectionCard titulo="Como funciona" eyebrow="Documentação">
            <ol className="space-y-4">
              {[
                {
                  titulo: "1. Envie a fatura",
                  descricao: `Faça upload de um ou mais PDFs de fatura, um por cliente. Processado em pacotes de ${TAMANHO_LOTE_EXTRACAO}.`,
                },
                {
                  titulo: "2. Extração automática",
                  descricao: "O PDF é lido no seu navegador e enviado, página por página, ao serviço de OCR até localizar a chave PIX.",
                },
                {
                  titulo: "3. Vínculo com o cliente",
                  descricao: "Pelo nome do arquivo, o PIX e o próprio PDF são associados automaticamente ao cliente já cadastrado. Sem casamento, vincule manualmente na lista abaixo.",
                },
              ].map((passo) => (
                <li key={passo.titulo} className="flex gap-3">
                  <div className="bg-primary-soft text-primary-strong mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold">
                    {passo.titulo.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{passo.titulo}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs text-pretty">{passo.descricao}</p>
                  </div>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>

      <Dialog open={!!vinculando} onOpenChange={(open) => !open && setVinculando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular cliente</DialogTitle>
            <DialogDescription>
              Escolha o cliente que corresponde ao arquivo "{vinculando?.arquivo}".
            </DialogDescription>
          </DialogHeader>
          <select
            value={clienteEscolhido}
            onChange={(e) => setClienteEscolhido(e.target.value)}
            className="focus-ring bg-surface text-foreground border-border h-9 w-full rounded-md border px-2.5 text-sm"
          >
            <option value="">Selecione um cliente</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          {erroVinculo && <Aviso tone="danger">{erroVinculo}</Aviso>}
          <DialogFooter>
            <Botao variante="outline" onClick={() => setVinculando(null)}>
              Cancelar
            </Botao>
            <Botao
              variante="primary"
              onClick={confirmarVinculo}
              disabled={salvandoVinculo || !clienteEscolhido}
            >
              {salvandoVinculo ? "Salvando…" : "Vincular"}
            </Botao>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
