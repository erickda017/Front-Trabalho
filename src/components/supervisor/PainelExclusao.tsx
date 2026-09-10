import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Aviso, Botao, LinhasEsqueleto, Rotulo, Seletor, TabelaWrap } from "@/components/shared/Controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/api";
import type { CriterioExclusao, FiltroExclusao, TipoFatura } from "@/lib/types";

// [2026-09] PAINEL DE EXCLUSÃO -- ver
// backend/docs/superpowers/specs/2026-09-10-painel-exclusao-design.md.
// Componente separado (não dentro de routes/supervisor.tsx, que já está
// grande) -- fluxo autocontido: resumo -> escolher critério -> preview
// obrigatório -> digitar "APAGAR" -> executar. Nunca pula o preview.

const ROTULOS_CRITERIO: Record<CriterioExclusao, string> = {
  pdfs_por_safra: "PDFs por safra",
  pdfs_por_tipo_fatura: "PDFs por FPD/SPD",
  pdfs_sem_safra: "PDFs sem safra (cadastros antigos)",
  clientes_por_tag: "Clientes por tag",
  historico_mensagens: "Histórico de mensagens",
};

function rotuloFiltro(criterio: CriterioExclusao, filtro: FiltroExclusao): string {
  switch (criterio) {
    case "pdfs_por_safra":
      return `Safra ${filtro.safra}`;
    case "pdfs_por_tipo_fatura":
      return `Tipo ${filtro.tipo_fatura}`;
    case "pdfs_sem_safra":
      return "Cadastros de antes do conceito de safra existir";
    case "clientes_por_tag":
      return `Tag "${filtro.tag_nome}"`;
    case "historico_mensagens": {
      const campanha = filtro.campanha === "chip_ativacao" ? "Ativação Chip" : filtro.campanha === "cobranca" ? "Cobrança" : "Todas as campanhas";
      const idade = filtro.dias_mais_antigo_que ? `, mais antigas que ${filtro.dias_mais_antigo_que} dias` : "";
      return `${campanha}${idade}`;
    }
  }
}

function ConfirmarExclusaoDialog({
  aberto,
  criterio,
  filtro,
  onOpenChange,
  onExcluido,
}: {
  aberto: boolean;
  criterio: CriterioExclusao | null;
  filtro: FiltroExclusao;
  onOpenChange: (v: boolean) => void;
  onExcluido: () => void;
}) {
  const [palavra, setPalavra] = useState("");
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const { data: preview, isLoading: carregandoPreview } = useQuery({
    queryKey: ["exclusao-preview", criterio, filtro],
    queryFn: () => api.exclusao.preview(criterio as CriterioExclusao, filtro),
    enabled: aberto && !!criterio,
  });

  async function confirmar() {
    if (!criterio || palavra !== "APAGAR") return;
    setExecutando(true);
    setErro(null);
    try {
      const { apagados } = await api.exclusao.executar(criterio, filtro, palavra);
      toast.success(`${apagados} item(ns) apagado(s).`);
      setPalavra("");
      onExcluido();
      onOpenChange(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setExecutando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) {
          setPalavra("");
          setErro(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            <AlertTriangle className="size-4" /> {criterio && ROTULOS_CRITERIO[criterio]}
          </DialogTitle>
          <DialogDescription>{criterio && rotuloFiltro(criterio, filtro)} -- ação irreversível.</DialogDescription>
        </DialogHeader>

        {erro && <Aviso tone="danger">{erro}</Aviso>}

        {carregandoPreview ? (
          <div className="text-subtle flex items-center gap-2 py-4 text-xs">
            <Loader2 className="size-3.5 animate-spin" /> Calculando quantos itens seriam apagados...
          </div>
        ) : preview ? (
          <>
            <Aviso tone={preview.quantidade === 0 ? "info" : "warning"}>
              {preview.quantidade === 0
                ? "Nada encontrado com esse filtro -- nenhum item seria apagado."
                : `${preview.quantidade} item(ns) serão apagados permanentemente.`}
            </Aviso>
            {preview.amostra.length > 0 && (
              <ul className="text-muted-foreground list-inside list-disc space-y-0.5 text-xs">
                {preview.amostra.map((linha, i) => (
                  <li key={i}>{linha}</li>
                ))}
              </ul>
            )}

            {preview.quantidade > 0 && (
              <div>
                <Rotulo htmlFor="exclusao-confirmacao">
                  Digite <span className="text-destructive font-mono font-semibold">APAGAR</span> pra confirmar
                </Rotulo>
                <input
                  id="exclusao-confirmacao"
                  value={palavra}
                  onChange={(e) => setPalavra(e.target.value)}
                  placeholder="APAGAR"
                  autoComplete="off"
                  className="border-border bg-surface focus-ring w-full rounded-md border px-3 py-2 font-mono text-sm"
                />
              </div>
            )}
          </>
        ) : null}

        <DialogFooter>
          <Botao variante="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Botao>
          <Botao
            variante="danger"
            onClick={confirmar}
            disabled={!preview || preview.quantidade === 0 || palavra !== "APAGAR" || executando}
          >
            {executando ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Apagar definitivamente
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CAMPOS_POR_CRITERIO: CriterioExclusao[] = [
  "pdfs_por_safra",
  "pdfs_por_tipo_fatura",
  "pdfs_sem_safra",
  "clientes_por_tag",
  "historico_mensagens",
];

function FormularioManual({ onSolicitar }: { onSolicitar: (criterio: CriterioExclusao, filtro: FiltroExclusao) => void }) {
  const [criterio, setCriterio] = useState<CriterioExclusao>("pdfs_por_safra");
  const [safra, setSafra] = useState("");
  const [tipoFatura, setTipoFatura] = useState<TipoFatura>("FPD");
  const [tagNome, setTagNome] = useState("");
  const [campanha, setCampanha] = useState<"cobranca" | "chip_ativacao" | "todas">("cobranca");
  const [dias, setDias] = useState("0");

  function solicitar() {
    if (criterio === "pdfs_por_safra") {
      if (!safra.trim()) return;
      onSolicitar(criterio, { safra: safra.trim() });
    } else if (criterio === "pdfs_por_tipo_fatura") {
      onSolicitar(criterio, { tipo_fatura: tipoFatura });
    } else if (criterio === "pdfs_sem_safra") {
      onSolicitar(criterio, {});
    } else if (criterio === "clientes_por_tag") {
      if (!tagNome.trim()) return;
      onSolicitar(criterio, { tag_nome: tagNome.trim() });
    } else {
      onSolicitar(criterio, { campanha, dias_mais_antigo_que: Number(dias) || 0 });
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Rotulo htmlFor="exclusao-criterio">Critério</Rotulo>
        <Seletor id="exclusao-criterio" value={criterio} onChange={(e) => setCriterio(e.target.value as CriterioExclusao)}>
          {CAMPOS_POR_CRITERIO.map((c) => (
            <option key={c} value={c}>
              {ROTULOS_CRITERIO[c]}
            </option>
          ))}
        </Seletor>
      </div>

      {criterio === "pdfs_por_safra" && (
        <div>
          <Rotulo htmlFor="exclusao-safra">Safra (formato AAAA-MM)</Rotulo>
          <input
            id="exclusao-safra"
            value={safra}
            onChange={(e) => setSafra(e.target.value)}
            placeholder="2026-06"
            className="border-border bg-surface focus-ring w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      )}

      {criterio === "pdfs_por_tipo_fatura" && (
        <div>
          <Rotulo htmlFor="exclusao-tipo">Tipo</Rotulo>
          <Seletor id="exclusao-tipo" value={tipoFatura} onChange={(e) => setTipoFatura(e.target.value as TipoFatura)}>
            <option value="FPD">FPD</option>
            <option value="SPD">SPD</option>
          </Seletor>
        </div>
      )}

      {criterio === "clientes_por_tag" && (
        <div>
          <Rotulo htmlFor="exclusao-tag">Nome da tag</Rotulo>
          <input
            id="exclusao-tag"
            value={tagNome}
            onChange={(e) => setTagNome(e.target.value)}
            placeholder="Pago"
            className="border-border bg-surface focus-ring w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      )}

      {criterio === "historico_mensagens" && (
        <div className="flex gap-3">
          <div className="flex-1">
            <Rotulo htmlFor="exclusao-campanha">Campanha</Rotulo>
            <Seletor id="exclusao-campanha" value={campanha} onChange={(e) => setCampanha(e.target.value as typeof campanha)}>
              <option value="cobranca">Cobrança</option>
              <option value="chip_ativacao">Ativação Chip</option>
              <option value="todas">Todas</option>
            </Seletor>
          </div>
          <div className="flex-1">
            <Rotulo htmlFor="exclusao-dias">Mais antigas que (dias, 0 = todas)</Rotulo>
            <input
              id="exclusao-dias"
              type="number"
              min={0}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              className="border-border bg-surface focus-ring w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      <Botao variante="danger" onClick={solicitar}>
        <Trash2 className="size-4" /> Pré-visualizar exclusão
      </Botao>
    </div>
  );
}

export function PainelExclusao() {
  const [criterioAberto, setCriterioAberto] = useState<CriterioExclusao | null>(null);
  const [filtroAberto, setFiltroAberto] = useState<FiltroExclusao>({});

  const {
    data: resumo,
    error: erroObj,
    refetch: recarregar,
    isLoading: carregando,
  } = useQuery({
    queryKey: ["exclusao-resumo"],
    queryFn: () => api.exclusao.resumo(),
    staleTime: 10_000,
  });
  const erro = erroObj ? (erroObj as Error).message : null;
  const itens = resumo?.itens ?? [];

  function abrirExclusao(criterio: CriterioExclusao, filtro: FiltroExclusao) {
    setCriterioAberto(criterio);
    setFiltroAberto(filtro);
  }

  return (
    <div className="flex flex-col gap-4">
      <Aviso tone="warning">
        Ação destrutiva e irreversível -- não existe lixeira nem desfazer. Cada exclusão fica registrada em auditoria
        (quem, quando, qual critério).
      </Aviso>
      {erro && <Aviso tone="danger">{erro}</Aviso>}

      <SectionCard
        titulo="O que mais está ocupando espaço"
        descricao="Contagem de linhas/arquivos por critério (não é o tamanho real em bytes) -- ordenado do maior pro menor. Clicar numa linha já pré-preenche a exclusão."
        flush
      >
        {carregando ? (
          <TabelaWrap>
            <tbody>
              <LinhasEsqueleto colunas={3} linhas={5} />
            </tbody>
          </TabelaWrap>
        ) : itens.length === 0 ? (
          <EmptyState icon={Trash2} titulo="Nada pra limpar" descricao="Não há PDFs, tags aplicadas ou histórico de mensagens no sistema no momento." compacto />
        ) : (
          <TabelaWrap>
            <thead>
              <tr className="border-border text-subtle border-b">
                <th className="th-cell">Item</th>
                <th className="th-cell">Quantidade</th>
                <th className="th-cell" />
              </tr>
            </thead>
            <tbody>
              {itens.map((item, i) => (
                <tr key={i} className="border-border border-t">
                  <td className="td-cell">
                    <p className="font-medium">{item.rotulo}</p>
                    <p className="text-subtle text-xs">{item.detalhe}</p>
                  </td>
                  <td className="td-cell font-mono tabular-nums">{item.quantidade.toLocaleString("pt-BR")}</td>
                  <td className="td-cell">
                    <Botao variante="danger" tamanho="sm" onClick={() => abrirExclusao(item.criterio, item.filtro)}>
                      <Trash2 className="size-3.5" /> Apagar
                    </Botao>
                  </td>
                </tr>
              ))}
            </tbody>
          </TabelaWrap>
        )}
      </SectionCard>

      <SectionCard
        titulo="Exclusão manual"
        descricao="Pra um filtro que não apareceu na lista acima (ex: outra safra)."
      >
        <FormularioManual onSolicitar={abrirExclusao} />
      </SectionCard>

      <ConfirmarExclusaoDialog
        aberto={!!criterioAberto}
        criterio={criterioAberto}
        filtro={filtroAberto}
        onOpenChange={(v) => {
          if (!v) setCriterioAberto(null);
        }}
        onExcluido={() => recarregar()}
      />
    </div>
  );
}
