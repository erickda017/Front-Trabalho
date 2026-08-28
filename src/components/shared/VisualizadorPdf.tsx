import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertCircle, ExternalLink, Loader2, Minus, Plus, X } from "lucide-react";

import { abrirArquivoProtegido, buscarBlobArquivoProtegido } from "@/api";
import { cn } from "@/lib/utils";

const ESCALA_MIN = 0.6;
const ESCALA_MAX = 2.6;
const ESCALA_PASSO = 0.2;
const ESCALA_INICIAL = 1.2;

/** Mesmo padrão de `lib/pixExtractor.worker.ts` (carrega pdfjs-dist + aponta
 *  o worker do próprio pdfjs) -- duplicado de propósito em vez de
 *  compartilhado, porque lá é `OffscreenCanvas` dentro de um Worker e aqui é
 *  `<canvas>` do DOM na thread principal (ver comentário grande naquele
 *  arquivo sobre por que a duplicação é intencional). */
async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return pdfjsLib;
}

function nomeArquivo(url: string) {
  const semQuery = url.split("?")[0] ?? url;
  const ultimo = semQuery.split("/").pop();
  if (!ultimo) return "documento.pdf";
  try {
    return decodeURIComponent(ultimo);
  } catch {
    return ultimo;
  }
}

function BotaoIcone({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-foreground hover:bg-surface-raised grid size-8 shrink-0 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * Visualizador de PDF flutuante -- renderiza cada página num `<canvas>` via
 * `pdfjs-dist` (já é dependência do projeto, usada pelo extrator de Pix)
 * direto num Dialog do Radix (Portal cuida de Esc/clique-fora/foco), overlay
 * com blur. Substitui o antigo "abre PDF numa aba nova" (`abrirArquivoProtegido`)
 * como o jeito PADRÃO de ver uma fatura/documento -- esse continua existindo
 * só como fallback ("Abrir em nova aba" no cabeçalho, pra imprimir/baixar
 * pelos controles nativos do navegador).
 *
 * Componente fica montado o tempo todo em quem usa (`url` controla
 * aberto/fechado via `Dialog open`) -- mesmo padrão dos outros modais do
 * projeto (`FichaCliente`, `ClienteFormModal` em routes/clientes.tsx).
 */
export function VisualizadorPdf({ url, onClose }: { url: string | null; onClose: () => void }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [escala, setEscala] = useState(ESCALA_INICIAL);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);

  const renderizarPaginas = useCallback(async (doc: any, escalaAtual: number) => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    for (let numero = 1; numero <= doc.numPages; numero++) {
      const pagina = await doc.getPage(numero);
      const viewport = pagina.getViewport({ scale: escalaAtual });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = "max-w-full rounded-sm bg-white shadow-raised";
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await pagina.render({ canvasContext: ctx, viewport }).promise;
      container.appendChild(canvas);
    }
  }, []);

  // Carrega o documento sempre que `url` muda (modal abriu com um PDF novo).
  // Não depende de `escala` de propósito -- zoom só re-renderiza (efeito
  // abaixo), não rebusca o PDF do zero.
  useEffect(() => {
    if (!url) return;
    let cancelado = false;
    let docLocal: any = null;
    setCarregando(true);
    setErro(null);

    (async () => {
      try {
        const blob = await buscarBlobArquivoProtegido(url);
        if (!blob) throw new Error("PDF não encontrado.");
        const buffer = await blob.arrayBuffer();
        if (cancelado) return;
        const pdfjsLib = await carregarPdfjs();
        const doc: any = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelado) {
          doc.destroy();
          return;
        }
        docLocal = doc;
        docRef.current = doc;
        await renderizarPaginas(doc, escala);
        if (!cancelado) setCarregando(false);
      } catch (e) {
        if (!cancelado) {
          setErro((e as Error).message || "Não foi possível abrir o PDF.");
          setCarregando(false);
        }
      }
    })();

    return () => {
      cancelado = true;
      docRef.current = null;
      docLocal?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, renderizarPaginas]);

  // Zoom: só re-renderiza as páginas do doc já carregado, sem rebuscar o PDF.
  useEffect(() => {
    if (!docRef.current || carregando) return;
    renderizarPaginas(docRef.current, escala);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escala]);

  return (
    <DialogPrimitive.Root open={!!url} onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-overlay fixed inset-0 z-50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="border-border bg-surface shadow-overlay fixed top-1/2 left-1/2 z-50 flex h-[92vh] w-[min(100%-2rem,64rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <header className="border-border bg-surface flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5">
            <DialogPrimitive.Title className="truncate text-sm font-medium">
              {url ? nomeArquivo(url) : "Documento"}
            </DialogPrimitive.Title>
            <div className="flex shrink-0 items-center gap-1">
              <BotaoIcone
                label="Diminuir zoom"
                disabled={escala <= ESCALA_MIN}
                onClick={() => setEscala((v) => Math.max(ESCALA_MIN, +(v - ESCALA_PASSO).toFixed(2)))}
              >
                <Minus className="size-4" />
              </BotaoIcone>
              <span className="text-subtle tabular w-11 text-center text-xs">{Math.round(escala * 100)}%</span>
              <BotaoIcone
                label="Aumentar zoom"
                disabled={escala >= ESCALA_MAX}
                onClick={() => setEscala((v) => Math.min(ESCALA_MAX, +(v + ESCALA_PASSO).toFixed(2)))}
              >
                <Plus className="size-4" />
              </BotaoIcone>
              <div className="bg-border mx-1 h-5 w-px" />
              <BotaoIcone label="Abrir em nova aba" onClick={() => url && void abrirArquivoProtegido(url)}>
                <ExternalLink className="size-4" />
              </BotaoIcone>
              <DialogPrimitive.Close asChild>
                <BotaoIcone label="Fechar" onClick={() => {}}>
                  <X className="size-4" />
                </BotaoIcone>
              </DialogPrimitive.Close>
            </div>
          </header>

          <div className="bg-surface-sunken relative flex-1 overflow-auto">
            <div ref={containerRef} className={cn("flex flex-col items-center gap-4 p-4 sm:p-6", erro && "hidden")} />
            {carregando && !erro && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="text-subtle size-5 animate-spin" />
              </div>
            )}
            {erro && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <AlertCircle className="text-destructive size-6" />
                <p className="text-sm">{erro}</p>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
