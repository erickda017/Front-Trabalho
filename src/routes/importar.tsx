import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  Download,
  FileArchive,
  FileSpreadsheet,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Aviso, Botao } from "@/components/shared/Controls";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { api } from "@/api";

export const Route = createFileRoute("/importar")({
  head: () => ({
    meta: [
      { title: "Importar planilha e PDFs — Veloce Faturas" },
      {
        name: "description",
        content:
          "Suba a planilha de cobrança e o zip com os PDFs: cada linha é casada com a fatura correta e o lote de disparo já sai pronto.",
      },
      { property: "og:title", content: "Importar planilha e PDFs — Veloce Faturas" },
      {
        property: "og:description",
        content: "Planilha + zip de PDFs casados automaticamente, com upsert por telefone.",
      },
    ],
  }),
  component: Importar,
});

type Resultado = {
  total: number;
  sucesso: unknown[];
  semPdf: unknown[];
  semDadosObrigatorios: unknown[];
  envio: { id: string } | null;
};

const COLUNAS_ESPERADAS = [
  "nome",
  "cliente",
  "telefone",
  "whatsapp",
  "celular",
  "valor",
  "vencimento",
  "arquivo",
  "mensagem",
];

function DropzoneArquivo({
  icon: Icon,
  titulo,
  formatos,
  accept,
  arquivo,
  onSelecionar,
}: {
  icon: typeof FileSpreadsheet;
  titulo: string;
  formatos: string;
  accept: string;
  arquivo: File | null;
  onSelecionar: (file: File | null) => void;
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
        const file = e.dataTransfer.files?.[0];
        if (file) onSelecionar(file);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2.5 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
        arrastando ? "border-primary bg-primary-soft" : "border-border hover:border-border-strong bg-surface-sunken",
      )}
    >
      <div className="bg-surface text-primary-strong grid size-10 place-items-center rounded-lg shadow-panel">
        <Icon className="size-4.5" />
      </div>
      <div>
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-subtle mt-0.5 text-xs">{formatos}</p>
      </div>
      {arquivo && (
        <span className="bg-surface text-muted-foreground inline-flex items-center gap-2 rounded px-2 py-1 font-mono text-[11px] shadow-panel">
          {arquivo.name}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelecionar(null);
            }}
            aria-label="Remover arquivo"
            className="text-subtle hover:text-destructive"
          >
            <X className="size-3" />
          </button>
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onSelecionar(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function Importar() {
  const { refreshClientes, setEnvioAtivoId } = useAppState();
  const navigate = useNavigate();
  const [planilha, setPlanilha] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [baixandoModelo, setBaixandoModelo] = useState(false);

  async function baixarModelo() {
    setBaixandoModelo(true);
    try {
      await api.importacao.baixarModelo();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBaixandoModelo(false);
    }
  }

  async function processar() {
    if (!planilha || !zip) {
      setErro("Selecione a planilha e o zip com os PDFs.");
      return;
    }
    setProcessando(true);
    setErro(null);
    try {
      const data: Resultado = await api.importacao.enviar({ planilha, zip, mensagem });
      setResultado(data);
      await refreshClientes();
      if (data.envio?.id) {
        setEnvioAtivoId(data.envio.id);
        navigate({ to: "/" });
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setProcessando(false);
    }
  }

  return (
    <AppShell title="Importar" subtitle="Planilha + ZIP de PDFs viram um lote pronto para disparo">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <SectionCard
            titulo="1. Baixar modelo"
            descricao="Use o modelo de planilha para garantir que as colunas fiquem no formato esperado."
            acoes={
              <Botao variante="outline" tamanho="sm" onClick={baixarModelo} disabled={baixandoModelo}>
                <Download className="size-3.5" />
                {baixandoModelo ? "Baixando…" : "Baixar modelo (.xlsx)"}
              </Botao>
            }
          >
            <div>
              <p className="text-muted-foreground mb-3 text-xs">Colunas esperadas na planilha:</p>
              <div className="flex flex-wrap gap-2">
                {COLUNAS_ESPERADAS.map((c) => (
                  <span
                    key={c}
                    className="bg-surface-sunken text-muted-foreground rounded px-2 py-1 font-mono text-[11px]"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <p className="text-subtle mt-3 text-xs text-pretty">
                Variações com acento e maiúsculas são aceitas. O telefone é normalizado antes de
                salvar e o cadastro é atualizado por telefone, sem duplicar cliente.
              </p>
            </div>
          </SectionCard>

          <SectionCard titulo="2. Enviar arquivos" descricao="Planilha de cobrança e o pacote (.zip) com os PDFs das faturas.">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DropzoneArquivo
                  icon={FileSpreadsheet}
                  titulo="Planilha de cobrança"
                  formatos=".xlsx, .xls ou .csv"
                  accept=".xlsx,.xls,.csv"
                  arquivo={planilha}
                  onSelecionar={setPlanilha}
                />
                <DropzoneArquivo
                  icon={FileArchive}
                  titulo="Pacote de faturas"
                  formatos=".zip com os PDFs"
                  accept=".zip"
                  arquivo={zip}
                  onSelecionar={setZip}
                />
              </div>

              <div>
                <label className="label-eyebrow mb-2 block">Mensagem (opcional)</label>
                <textarea
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  placeholder="Olá {{nome}}, tudo bem? Segue em anexo sua fatura no valor de {{valor}}, com vencimento em {{vencimento}}..."
                  rows={3}
                  className="focus-ring bg-surface text-foreground border-border placeholder:text-subtle w-full rounded-md border px-3 py-2 text-sm"
                />
                <p className="text-subtle mt-2 text-xs">
                  Deixe em branco para usar a mensagem padrão. Use {"{{nome}}"}, {"{{valor}}"} e{" "}
                  {"{{vencimento}}"} para personalizar por cliente.
                </p>
              </div>

              {erro && <Aviso tone="danger">{erro}</Aviso>}

              <div className="flex justify-end">
                <Botao
                  variante="primary"
                  onClick={processar}
                  disabled={processando || !planilha || !zip}
                >
                  {processando ? "Processando…" : "Processar importação"}
                </Botao>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="lg:col-span-4">
          <SectionCard titulo="3. Resultado" descricao="Aparece aqui depois de processar a importação.">
            {resultado ? (
              <div className="space-y-5">
                <dl className="space-y-3">
                  {[
                    { k: "Linhas lidas", v: resultado.total, icone: null },
                    { k: "Casadas com PDF", v: resultado.sucesso.length, tone: "text-success" },
                    { k: "Sem PDF no zip", v: resultado.semPdf.length, tone: "text-warning" },
                    {
                      k: "Sem nome/telefone",
                      v: resultado.semDadosObrigatorios.length,
                      tone: "text-destructive",
                    },
                  ].map((row) => (
                    <div key={row.k} className="flex items-center justify-between gap-4">
                      <dt className="text-muted-foreground text-sm">{row.k}</dt>
                      <dd className={cn("font-mono text-base font-medium", row.tone ?? "text-foreground")}>
                        {row.v}
                      </dd>
                    </div>
                  ))}
                </dl>

                {resultado.sucesso.length > 0 && (
                  <div className="bg-success/10 text-success flex items-start gap-2 rounded-md px-3 py-2 text-xs">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {resultado.sucesso.length} cliente(s) importado(s) com sucesso. O lote de
                      disparo foi criado quando aplicável.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon={FileSpreadsheet}
                titulo="Nenhuma importação ainda."
                descricao='Selecione os dois arquivos e clique em "Processar importação" para ver o resultado aqui.'
                compacto
              />
            )}
          </SectionCard>

          <SectionCard titulo="Como funciona" className="mt-6">
            <div className="flex gap-3">
              <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" />
              <p className="text-muted-foreground text-xs text-pretty">
                Linhas com problema ficam destacadas e não travam o resto do lote. Ao processar, o
                lote é criado já pronto e você é levado direto para a aba Disparo.
              </p>
            </div>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
