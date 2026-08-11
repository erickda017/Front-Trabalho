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

function Pix() {
  const { clientes } = useAppState();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  const [extracoes, setExtracoes] = useState<PixExtracao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [reprocessando, setReprocessando] = useState<string | null>(null);

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

  function adicionarArquivos(novos: File[]) {
    setArquivos((prev) => [...prev, ...novos]);
    setErroEnvio(null);
  }

  function removerArquivo(idx: number) {
    setArquivos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function extrair() {
    if (!arquivos.length) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      await api.pix.enviarArquivos(arquivos);
      setArquivos([]);
      await carregar();
    } catch (e) {
      setErroEnvio((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function reprocessar(id: string) {
    setReprocessando(id);
    try {
      await api.pix.reprocessar(id);
      await carregar();
    } finally {
      setReprocessando(null);
    }
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
            descricao="Selecione um ou mais PDFs de fatura para extrair a chave PIX."
            acoes={
              <Botao
                variante="primary"
                onClick={extrair}
                disabled={enviando || arquivos.length === 0}
              >
                {enviando ? "Enviando…" : "Extrair PIX"}
              </Botao>
            }
          >
            <div className="space-y-4">
              <Dropzone onFiles={adicionarArquivos} />

              {arquivos.length > 0 && (
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
              )}

              {enviando && (
                <div className="bg-surface-sunken h-1.5 w-full overflow-hidden rounded-full">
                  <div className="bg-primary h-full w-1/3 animate-[loading_1.2s_ease-in-out_infinite] rounded-full" />
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
              <TabelaWrap>
                <thead>
                  <tr className="border-border border-b">
                    <th className="th-cell">Arquivo</th>
                    <th className="th-cell">Cliente</th>
                    <th className="th-cell">Chave PIX</th>
                    <th className="th-cell">Status</th>
                    <th className="th-cell">Data</th>
                    <th className="th-cell text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {extracoes.map((e) => {
                    const info = statusInfo[e.status] ?? statusInfo.aguardando;
                    return (
                      <tr key={e.id} className="border-border border-t align-top">
                        <td className="td-cell max-w-[12rem]">
                          <span className="flex items-center gap-1.5 truncate">
                            <FileText className="text-subtle size-3.5 shrink-0" />
                            <span className="truncate" title={e.arquivo}>{e.arquivo}</span>
                          </span>
                        </td>
                        <td className="td-cell">
                          {e.cliente_nome ?? <span className="text-subtle">Não vinculado</span>}
                        </td>
                        <td className="td-cell">
                          {e.pix_code ? (
                            <span className="flex items-center gap-1.5">
                              <span className="font-mono max-w-[9rem] truncate text-xs" title={e.pix_code}>
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
                            {e.erro && <p className="text-destructive max-w-[14rem] text-[11px] text-pretty">{e.erro}</p>}
                          </div>
                        </td>
                        <td className="td-cell text-subtle whitespace-nowrap text-xs">{formatarData(e.criado_em)}</td>
                        <td className="td-cell">
                          <div className="flex justify-end gap-2">
                            {(e.status === "erro" || e.status === "nao_encontrado") && (
                              <Botao
                                tamanho="sm"
                                variante="outline"
                                onClick={() => reprocessar(e.id)}
                                disabled={reprocessando === e.id}
                              >
                                <RefreshCcw className={cn("size-3.5", reprocessando === e.id && "animate-spin")} />
                                Tentar novamente
                              </Botao>
                            )}
                            {!e.cliente_id && (
                              <Botao tamanho="sm" variante="ghost" onClick={() => abrirVinculo(e)}>
                                <Link2 className="size-3.5" />
                                Vincular cliente
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
                  descricao: "Faça upload de um ou mais PDFs de fatura, um por cliente.",
                },
                {
                  titulo: "2. Extração automática",
                  descricao: "O sistema lê o PDF e localiza a chave PIX copia e cola.",
                },
                {
                  titulo: "3. Vínculo com o cliente",
                  descricao: "A chave encontrada é associada ao cliente correspondente para uso nos disparos.",
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
