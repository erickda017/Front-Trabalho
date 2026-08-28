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
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusPill } from "@/components/shared/StatusPill";
import { Aviso, Botao, LinhasEsqueleto, Paginacao, TabelaWrap } from "@/components/shared/Controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, buscarBlobArquivoProtegido } from "@/api";
import { extrairDadosPix } from "@/lib/pixWorkerClient";
import { extrairPixLocal } from "@/lib/pixExtractor";
import { casarClientePorArquivo } from "@/lib/clienteMatch";
import { useAppState } from "@/lib/app-state";
import type { PixExtracao, PixExtracaoStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pix")({
  head: () => ({
    meta: [
      { title: "Extrator de PIX — Voxcel Faturas" },
      {
        name: "description",
        content: "Envie faturas em PDF e acompanhe a extração automática da chave PIX de cada cliente.",
      },
      { property: "og:title", content: "Extrator de PIX — Voxcel Faturas" },
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
// Processa em PACOTES de 10 (checkpoint visual de progresso -- ver
// `processarEmLotes` pro motivo de não processar os 10 de uma vez de
// verdade). Nada de esteira contínua -- é pacote fechado mesmo, do jeito
// que foi pedido: só avança pro próximo pacote quando o atual termina.
const TAMANHO_LOTE_EXTRACAO = 10;
// Dentro de cada pacote de 10, quantos PDFs são de fato lidos/processados ao
// mesmo tempo -- ver o comentário de `processarEmLotes` pra o motivo de não
// ser os 10 de uma vez (memória + fila do worker único de extração).
const CONCORRENCIA_REAL_DENTRO_DO_PACOTE = 3;

type ResumoEnvio = {
  total: number;
  processados: number;
  sucesso: number;
  falha: number;
};

type ResumoVerificacao = {
  total: number;
  processados: number;
  encontrados: number;
  semSucesso: number;
};

function Pix() {
  const { clientes, refreshClientes } = useAppState();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [resumoEnvio, setResumoEnvio] = useState<ResumoEnvio | null>(null);

  const [vinculando, setVinculando] = useState<PixExtracao | null>(null);
  const [clienteEscolhido, setClienteEscolhido] = useState("");
  const [salvandoVinculo, setSalvandoVinculo] = useState(false);
  const [erroVinculo, setErroVinculo] = useState<string | null>(null);

  const [verificando, setVerificando] = useState(false);
  const [resumoVerificacao, setResumoVerificacao] = useState<ResumoVerificacao | null>(null);
  const [erroVerificacao, setErroVerificacao] = useState<string | null>(null);

  // [perf] useQuery em vez de useEffect+useState -- cacheia entre trocas de
  // aba (não recarrega do zero toda vez que volta pra Extrator de PIX) e
  // ainda mantém o polling de 4s enquanto houver extração
  // aguardando/processando (`refetchInterval` dinâmico, baseado no último
  // resultado já cacheado -- mesmo comportamento de antes, só sem o
  // useEffect+setInterval manual).
  const {
    data: extracoesData,
    isLoading: carregando,
    error: erroListaObj,
    refetch: carregar,
  } = useQuery({
    queryKey: ["pix-extracoes"],
    queryFn: () => api.pix.listar(),
    refetchInterval: (query) => {
      const data = query.state.data;
      const pendente = Array.isArray(data) && data.some((e) => e.status === "aguardando" || e.status === "processando");
      return pendente ? 4000 : false;
    },
  });
  const extracoes = useMemo(() => (Array.isArray(extracoesData) ? extracoesData : []), [extracoesData]);
  const erroLista = erroListaObj ? (erroListaObj as Error).message : null;

  // [paginação] 50 extrações por página -- mesma ideia da tela Clientes.
  const TAMANHO_PAGINA = 50;
  const [pagina, setPagina] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(extracoes.length / TAMANHO_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const extracoesPaginadas = useMemo(
    () => extracoes.slice((paginaSegura - 1) * TAMANHO_PAGINA, paginaSegura * TAMANHO_PAGINA),
    [extracoes, paginaSegura],
  );

  // [2026-08] "Opção 2": extração rodando no BACKEND em vez do navegador --
  // útil quando o aparelho é fraco ou o navegador trava com muitos PDFs.
  // Mais lenta de propósito (1 arquivo por vez, esperando cada resposta
  // antes do próximo) -- é o que garante não faltar RAM no servidor (ver
  // backend/src/services/extratorServidorPix.js).
  const [modoExtracao, setModoExtracao] = useState<"navegador" | "servidor">("navegador");

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

  // Processa `itens` em PACOTES de `tamanhoLote` (checkpoint visual: só
  // avança pro próximo pacote quando TODOS os itens do atual terminaram,
  // com sucesso ou falha -- dá resultado parcial a cada pacote, não só no
  // fim dos 100). DENTRO de cada pacote, porém, a concorrência real é
  // limitada a `CONCORRENCIA_REAL_DENTRO_DO_PACOTE` (não os 10 de uma vez).
  //
  // [2026-08] Por quê: com 100 PDFs, os pacotes de 10 disparavam as 10
  // chamadas a `extrairDadosPix` TODAS de uma vez (`Promise.allSettled` com
  // o pacote inteiro). Isso travava a aba mesmo com o Web Worker de
  // extração do Pix (ver pixExtractor.worker.ts): o pool de workers (2, ver
  // `TAMANHO_POOL_WORKERS` em pixExtractor.ts) já dá algum paralelismo real
  // de CPU, mas 10 chamadas simultâneas ainda é MUITO mais que o pool
  // consegue processar ao mesmo tempo -- e cada uma das 10 lê o PDF inteiro
  // pra `ArrayBuffer` e mantém isso em memória até sua vez, então com 10
  // PDFs de ~5MB cada em voo ao mesmo tempo (mais o OCR em paralelo pelo
  // outro lado do Promise.all dentro de `extrairDadosPix`), a pressão de
  // memória + a fila de requests de rede do Worker Cloudflare é o que
  // trava a aba, não CPU de um render só. Reduzindo a concorrência REAL
  // dentro do pacote (poucos PDFs sendo lidos/processados ao mesmo tempo,
  // alinhado ao tamanho do pool), o pacote de 10 ainda é a unidade
  // "visível" de progresso, mas o trabalho de fato roda em ondas menores.
  async function processarEmLotes<T>(itens: T[], tamanhoLote: number, tarefa: (item: T) => Promise<void>) {
    for (let inicio = 0; inicio < itens.length; inicio += tamanhoLote) {
      const pacote = itens.slice(inicio, inicio + tamanhoLote);

      let proximoNoPacote = 0;
      async function processador() {
        while (proximoNoPacote < pacote.length) {
          const item = pacote[proximoNoPacote++];
          if (item === undefined) continue;
          try {
            await tarefa(item);
          } catch {
            // erro de um item não derruba os outros -- mesma garantia de
            // antes (Promise.allSettled), só que agora com concorrência
            // limitada em vez de todos de uma vez.
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCORRENCIA_REAL_DENTRO_DO_PACOTE, pacote.length) }, () => processador()),
      );
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
        const dados = await extrairDadosPix(arquivo, arquivo.name);
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

  // Mesma ideia de `extrair()` (mesmo pacote de arquivos, mesmo resumo de
  // progresso na tela), mas manda CADA PDF pro backend processar, UM DE CADA
  // VEZ -- espera a resposta de um antes de mandar o próximo (nunca em
  // paralelo, nem em pacotes de 10 como o modo navegador). É o próprio
  // front que garante isso aqui: o backend até tem uma fila interna também
  // (ver executarSequencial em extratorServidorPix.js), mas essa dupla
  // garantia é intencional -- não depende só do servidor se comportar bem.
  //
  // Diferença importante pro modo navegador: aqui o servidor só extrai o
  // Pix e já tenta casar/gravar no cliente pelo nome do arquivo -- ele NÃO
  // sobe o PDF em si pro Storage (evita todo tráfego/armazenamento extra
  // nesse modo, que já é mais pesado por natureza). Se também quiser
  // guardar o PDF anexado ao cliente, use "Upload de faturas avulsas" (aba
  // Faturas) depois, ou o modo navegador (que já faz os dois juntos).
  async function extrairNoServidor() {
    if (!arquivos.length || loteExcedeLimite) return;
    setEnviando(true);
    setErroEnvio(null);
    const total = arquivos.length;
    setResumoEnvio({ total, processados: 0, sucesso: 0, falha: 0 });

    for (const arquivo of arquivos) {
      try {
        const resultado = await api.pix.extrairNoServidor(arquivo);
        setResumoEnvio((prev) =>
          prev
            ? {
                ...prev,
                processados: prev.processados + 1,
                sucesso: prev.sucesso + (resultado?.encontrado ? 1 : 0),
                falha: prev.falha + (resultado?.encontrado ? 0 : 1),
              }
            : prev,
        );
      } catch (e) {
        setErroEnvio((e as Error).message);
        setResumoEnvio((prev) =>
          prev ? { ...prev, processados: prev.processados + 1, falha: prev.falha + 1 } : prev,
        );
      }
    }

    setArquivos([]);
    setEnviando(false);
    await carregar();
  }

  // "Rodar verificação": varre clientes que já têm PDF mas ficaram sem Pix
  // (Worker fora do ar na hora, boleto com layout raro, etc.) e tenta achar
  // o QR de novo, 100% local -- baixa o PDF já salvo (signed URL) e roda o
  // mesmo scanner de canto usado no upload normal (ver pixExtractor.ts). Achou:
  // grava só o Pix (propaga pra números vinculados do mesmo cliente, se
  // houver -- ver backend/src/lib/faturaPropagacao.js).
  async function rodarVerificacao() {
    setVerificando(true);
    setErroVerificacao(null);
    setResumoVerificacao(null);
    try {
      const semPix = await api.clientes.listar({ com_pdf: true, sem_pix: true });
      const lista: typeof clientes = Array.isArray(semPix) ? semPix : [];
      const total = lista.length;
      setResumoVerificacao({ total, processados: 0, encontrados: 0, semSucesso: 0 });

      await processarEmLotes(lista, TAMANHO_LOTE_EXTRACAO, async (cliente) => {
        try {
          if (!cliente.pdf_url) throw new Error("sem pdf_url");
          // `cliente.pdf_url` é um path do proxy autenticado (ver
          // arquivos.routes.js) -- exige Authorization: Bearer, que um
          // `fetch` cru não manda. Sem isso, cai em 401 na hora pra TODO
          // cliente (por isso a verificação parecia "instantânea" e nunca
          // achava nada -- ver api.js pro helper certo).
          const blob = await buscarBlobArquivoProtegido(cliente.pdf_url);
          const resultado = await extrairPixLocal(blob);

          if (resultado?.pixCopiaCola) {
            await api.clientes.atualizarPix(cliente.id, resultado.pixCopiaCola);
            setResumoVerificacao((prev) =>
              prev ? { ...prev, processados: prev.processados + 1, encontrados: prev.encontrados + 1 } : prev,
            );
          } else {
            setResumoVerificacao((prev) =>
              prev ? { ...prev, processados: prev.processados + 1, semSucesso: prev.semSucesso + 1 } : prev,
            );
          }
        } catch {
          setResumoVerificacao((prev) =>
            prev ? { ...prev, processados: prev.processados + 1, semSucesso: prev.semSucesso + 1 } : prev,
          );
        }
      });

      await refreshClientes();
    } catch (e) {
      setErroVerificacao((e as Error).message);
    } finally {
      setVerificando(false);
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
            descricao={`Selecione um ou mais PDFs de fatura para extrair a chave PIX. Até ${MAX_ARQUIVOS} arquivos (${MAX_TOTAL_MB}MB) por vez.`}
            acoes={
              <Botao
                variante="primary"
                onClick={modoExtracao === "servidor" ? extrairNoServidor : extrair}
                disabled={enviando || arquivos.length === 0 || loteExcedeLimite}
              >
                {enviando ? "Enviando…" : "Extrair PIX"}
              </Botao>
            }
          >
            <div className="space-y-4">
              {/* [2026-08] "Opção 2" de extração: no servidor, 1 PDF por vez --
                  ver comentário de extrairNoServidor() acima e CONTEXTO.md. */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-subtle font-medium">Onde processar:</span>
                <button
                  type="button"
                  onClick={() => setModoExtracao("navegador")}
                  disabled={enviando}
                  className={cn(
                    "rounded-full border px-3 py-1 font-medium transition-colors",
                    modoExtracao === "navegador"
                      ? "border-primary bg-primary-soft text-primary-strong"
                      : "border-border text-subtle hover:border-border-strong",
                  )}
                >
                  No navegador (recomendado)
                </button>
                <button
                  type="button"
                  onClick={() => setModoExtracao("servidor")}
                  disabled={enviando}
                  className={cn(
                    "rounded-full border px-3 py-1 font-medium transition-colors",
                    modoExtracao === "servidor"
                      ? "border-primary bg-primary-soft text-primary-strong"
                      : "border-border text-subtle hover:border-border-strong",
                  )}
                >
                  No servidor (1 por vez, mais lento)
                </button>
              </div>
              {modoExtracao === "servidor" && (
                <Aviso tone="warning">
                  Modo alternativo: cada PDF é processado no servidor, um de cada vez (o próximo só
                  começa quando o anterior terminar), pra não sobrecarregar a memória do servidor. É
                  mais lento que o modo navegador — use quando o aparelho não conseguir processar
                  localmente. Neste modo o PDF em si não é anexado ao cliente, só a chave PIX
                  encontrada.
                </Aviso>
              )}

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

          <SectionCard
            titulo="Rodar verificação"
            descricao="Revarre clientes que já têm PDF de fatura mas ficaram sem Pix (Worker fora do ar, layout raro etc.) e tenta achar o QR de novo, direto no seu navegador."
            acoes={
              <Botao variante="secondary" onClick={rodarVerificacao} disabled={verificando}>
                {verificando ? "Verificando…" : "Rodar verificação"}
              </Botao>
            }
          >
            <div className="space-y-2">
              {resumoVerificacao && (
                <>
                  <div className="bg-surface-sunken h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full transition-all"
                      style={{
                        width: `${resumoVerificacao.total ? (resumoVerificacao.processados / resumoVerificacao.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p className="text-subtle text-xs">
                    {resumoVerificacao.total === 0 ? (
                      "Nenhum cliente com PDF pendente de Pix no momento."
                    ) : (
                      <>
                        {resumoVerificacao.processados} / {resumoVerificacao.total} processado(s)
                        {resumoVerificacao.processados > 0 && (
                          <>
                            {" — "}
                            <span className="text-success">{resumoVerificacao.encontrados} achado(s)</span>
                            {resumoVerificacao.semSucesso > 0 && (
                              <>
                                {", "}
                                <span className="text-muted-foreground">
                                  {resumoVerificacao.semSucesso} sem sucesso
                                </span>
                              </>
                            )}
                          </>
                        )}
                        {!verificando &&
                          resumoVerificacao.processados === resumoVerificacao.total &&
                          resumoVerificacao.total > 0 &&
                          " — concluído."}
                      </>
                    )}
                  </p>
                </>
              )}
              {erroVerificacao && <Aviso tone="danger">{erroVerificacao}</Aviso>}
            </div>
          </SectionCard>

          <SectionCard titulo="Extrações" descricao="Status de extração da chave PIX por fatura enviada." flush bodyClassName="p-0">
            {erroLista ? (
              <div className="p-5">
                <Aviso tone="danger">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>{erroLista}</span>
                    <Botao tamanho="sm" variante="outline" onClick={() => carregar()}>
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
                  {extracoesPaginadas.map((e) => {
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
            <Paginacao
              paginaAtual={paginaSegura}
              totalPaginas={totalPaginas}
              totalItens={extracoes.length}
              tamanhoPagina={TAMANHO_PAGINA}
              onMudarPagina={setPagina}
            />
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
