import { FileText, Link2, Plus, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared/SectionCard";
import { VisualizadorPdf } from "@/components/shared/VisualizadorPdf";
import { Botao, Aviso, Seletor } from "@/components/shared/Controls";
import { StatusPill } from "@/components/shared/StatusPill";
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
import { useAppState } from "@/lib/app-state";
import { api } from "@/api";
import { cn } from "@/lib/utils";

// [2026-09] Extraída de routes/clientes.tsx pra ser reusada também em
// routes/importar.tsx -- ver CONTEXTO.md ("PDF sem planilha obrigatória")
// pro porquê: essa já era a forma de subir PDF que NÃO depende de planilha
// nem do Worker de OCR (o backend só casa pelo NOME do arquivo, nunca lê o
// conteúdo do PDF) -- "1 PDF (ou vários) subido direto, sem passar pela
// importação em massa (zip + planilha)". O backend tenta casar pelo nome do
// arquivo com um cliente já cadastrado; não achando, o PDF fica "pendente" e
// a associação acontece sozinha quando o cliente certo for criado depois
// (ver backend/src/lib/faturasPendentes.js).
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

export function UploadAvulsoFaturas({ onAssociado }: { onAssociado: () => void }) {
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
  const [pdfAberto, setPdfAberto] = useState<string | null>(null);
  const [descartando, setDescartando] = useState<PendenciaAvulsa | null>(null);
  const [descartandoAtivo, setDescartandoAtivo] = useState(false);

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

  async function confirmarDescarte() {
    if (!descartando) return;
    setDescartandoAtivo(true);
    try {
      await api.faturas.pendentes.remover(descartando.id);
      await carregarPendencias();
      setDescartando(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDescartandoAtivo(false);
    }
  }

  const resumo = pendencias.length > 0 ? `${pendencias.length} pendente(s) de associação` : "nenhuma pendência";

  return (
    <>
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
                        onClick={() => setPdfAberto(p.pdf_url)}
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
                          <Botao tamanho="sm" variante="ghost" onClick={() => setDescartando(p)}>
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
    <VisualizadorPdf url={pdfAberto} onClose={() => setPdfAberto(null)} />
    <AlertDialog open={!!descartando} onOpenChange={(open) => !open && setDescartando(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Descartar "{descartando?.arquivo}"?</AlertDialogTitle>
          <AlertDialogDescription>
            O PDF pendente é removido e deixa de aparecer nesta lista. Não tem como desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={descartandoAtivo}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              confirmarDescarte();
            }}
            disabled={descartandoAtivo}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {descartandoAtivo ? "Descartando…" : "Descartar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
