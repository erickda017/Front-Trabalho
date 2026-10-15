import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Aviso, Botao, Campo, Rotulo, Seletor } from "@/components/shared/Controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/api";
import type { ModoLimpezaPix } from "@/lib/types";

// [2026-10] A lista do Extrator de PIX acumulava mais de mil linhas e não
// havia como apagar em massa. Fluxo: escolher o que limpar -> ver quantas
// seriam apagadas (preview, nunca apaga) -> digitar APAGAR. Só mexe na lista
// de extrações do próprio operador; o Pix já aplicado num cliente fica.
const OPCOES: { modo: ModoLimpezaPix; label: string; ajuda: string }[] = [
  { modo: "sem_cliente", label: "Sem cliente vinculado", ajuda: "Chaves que não casaram com ninguém." },
  { modo: "com_erro", label: "Com erro ou não encontradas", ajuda: "PDFs em que o QR não foi lido." },
  { modo: "antes_de", label: "Anteriores a uma data", ajuda: "Tudo que foi extraído antes do dia escolhido." },
  { modo: "todas", label: "Todas", ajuda: "Esvazia a lista inteira (menos as que ainda estão processando)." },
];

export function LimparExtracoesPix() {
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<ModoLimpezaPix>("sem_cliente");
  const [antesDe, setAntesDe] = useState("");
  const [palavra, setPalavra] = useState("");
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const pronto = modo !== "antes_de" || Boolean(antesDe);
  const { data: preview, isFetching } = useQuery({
    queryKey: ["pix-limpar-preview", modo, antesDe],
    queryFn: () => api.pix.limpar.preview({ modo, antes_de: modo === "antes_de" ? antesDe : undefined }),
    enabled: aberto && pronto,
  });

  function fechar() {
    setAberto(false);
    setPalavra("");
    setErro(null);
  }

  async function confirmar() {
    if (palavra !== "APAGAR" || !pronto) return;
    setExecutando(true);
    setErro(null);
    try {
      const { apagadas } = await api.pix.limpar.executar(
        { modo, antes_de: modo === "antes_de" ? antesDe : undefined },
        palavra,
      );
      toast.success(`${apagadas} extração(ões) apagada(s).`);
      await queryClient.invalidateQueries({ queryKey: ["pix-extracoes"] });
      fechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setExecutando(false);
    }
  }

  const ajuda = OPCOES.find((o) => o.modo === modo)?.ajuda;

  return (
    <>
      <Botao variante="outline" tamanho="sm" onClick={() => setAberto(true)}>
        <Trash2 className="size-3.5" />
        Limpar lista
      </Botao>
      <Dialog open={aberto} onOpenChange={(v) => (v ? setAberto(true) : fechar())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limpar extrações de Pix</DialogTitle>
            <DialogDescription>
              Remove linhas da lista. O Pix que já foi aplicado num cliente continua no cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Rotulo htmlFor="limpar-pix-modo">O que apagar</Rotulo>
              <Seletor id="limpar-pix-modo" value={modo} onChange={(e) => setModo(e.target.value as ModoLimpezaPix)}>
                {OPCOES.map((o) => (
                  <option key={o.modo} value={o.modo}>
                    {o.label}
                  </option>
                ))}
              </Seletor>
              {ajuda && <p className="text-subtle mt-1 text-xs">{ajuda}</p>}
            </div>
            {modo === "antes_de" && (
              <div>
                <Rotulo htmlFor="limpar-pix-data">Antes do dia</Rotulo>
                <Campo id="limpar-pix-data" type="date" value={antesDe} onChange={(e) => setAntesDe(e.target.value)} />
              </div>
            )}

            {erro && <Aviso tone="danger">{erro}</Aviso>}

            {pronto && isFetching ? (
              <div className="text-subtle flex items-center gap-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Contando…
              </div>
            ) : pronto && preview ? (
              <>
                <Aviso tone={preview.quantidade === 0 ? "info" : "warning"}>
                  {preview.quantidade === 0
                    ? "Nada encontrado com esse filtro."
                    : `${preview.quantidade} extração(ões) serão apagadas permanentemente.`}
                </Aviso>
                {preview.quantidade > 0 && (
                  <div>
                    <Rotulo htmlFor="limpar-pix-confirmacao">
                      Digite <span className="text-destructive font-mono font-semibold">APAGAR</span> pra confirmar
                    </Rotulo>
                    <Campo
                      id="limpar-pix-confirmacao"
                      value={palavra}
                      onChange={(e) => setPalavra(e.target.value)}
                      placeholder="APAGAR"
                      autoComplete="off"
                      className="font-mono"
                    />
                  </div>
                )}
              </>
            ) : null}
          </div>

          <DialogFooter>
            <Botao variante="outline" onClick={fechar}>
              Cancelar
            </Botao>
            <Botao
              variante="danger"
              onClick={confirmar}
              disabled={!preview || preview.quantidade === 0 || palavra !== "APAGAR" || executando || !pronto}
            >
              {executando ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Apagar definitivamente
            </Botao>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
