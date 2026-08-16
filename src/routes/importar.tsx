import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  Download,
  FileArchive,
  FileSpreadsheet,
  TriangleAlert,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";

import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Aviso, Botao, TabelaWrap } from "@/components/shared/Controls";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { processarImportacaoNoBrowser, type ProgressoImportacao } from "@/lib/importacaoBrowser";

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
  erroUpload: { nome: string; numero: string; motivoErro: string }[];
  envio: { id: string } | null;
};

type ItemConvertido = { nome: string; numero: string; valor: number | null; arquivo: string };

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

// Converte texto cru (formato NOME/contrato/CPF/telefone(s)/Fatura/valor, ver
// backend/src/lib/parseListaClientes.js) em linhas prontas pro layout da
// planilha modelo. O parse roda no servidor (mais robusto/testado); aqui só
// mostra o preview e oferece baixar o .xlsx ou já criar os clientes.
function ConversorLista() {
  const { refreshClientes } = useAppState();
  const [texto, setTexto] = useState("");
  const [convertendo, setConvertendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemConvertido[] | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [importado, setImportado] = useState<{ criados: number; erros: unknown[] } | null>(null);

  async function converter() {
    if (!texto.trim()) {
      setErro("Cole a lista de clientes no campo de texto.");
      return;
    }
    setConvertendo(true);
    setErro(null);
    setImportado(null);
    try {
      const data = await api.clientes.converterLista(texto);
      setItens(data.itens);
      setAvisos(data.avisos);
      if (data.itens.length === 0) {
        setErro("Nenhum cliente reconhecido nesse texto. Confira o formato (nome, telefone(s), valor).");
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setConvertendo(false);
    }
  }

  function baixarPlanilha() {
    if (!itens || itens.length === 0) return;
    // Mesmas colunas do modelo (nome, numero, mensagem, valor, vencimento, arquivo)
    const linhas = itens.map((i) => ({
      nome: i.nome,
      numero: i.numero,
      mensagem: "",
      valor: i.valor ?? "",
      vencimento: "",
      arquivo: i.arquivo,
    }));
    const planilha = XLSX.utils.json_to_sheet(linhas);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, planilha, "clientes");
    XLSX.writeFile(workbook, "clientes-convertidos.xlsx");
  }

  async function importarAgora() {
    if (!itens || itens.length === 0) return;
    setImportando(true);
    setErro(null);
    try {
      const data = await api.clientes.importarLista(itens);
      setImportado({ criados: data.criados, erros: data.erros });
      await refreshClientes();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setImportando(false);
    }
  }

  const clientesUnicos = itens ? new Set(itens.map((i) => i.nome)).size : 0;

  return (
    <SectionCard
      titulo="0. Converter lista crua de clientes"
      descricao='Cole o texto solto (nome, contrato, CPF, telefone(s), fatura, valor) -- vira planilha no formato do modelo, uma linha por telefone.'
    >
      <div className="space-y-4">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={"IRANDIR GONCALVES ALVES\n1512993\nCPF 233.228.379-04\n41985083040\nFatura 2\nR$ 122,39\n\n..."}
          rows={6}
          className="focus-ring bg-surface text-foreground border-border placeholder:text-subtle w-full rounded-md border px-3 py-2 font-mono text-xs"
        />

        {erro && <Aviso tone="danger">{erro}</Aviso>}

        <div className="flex justify-end">
          <Botao variante="primary" tamanho="sm" onClick={converter} disabled={convertendo || !texto.trim()}>
            <Wand2 className="size-3.5" />
            {convertendo ? "Convertendo…" : "Converter"}
          </Botao>
        </div>

        {itens && itens.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                <span className="text-foreground font-mono font-medium">{clientesUnicos}</span> cliente(s),{" "}
                <span className="text-foreground font-mono font-medium">{itens.length}</span> linha(s) (1 por telefone)
                {avisos.length > 0 && <span className="text-warning"> · {avisos.length} linha(s) ignorada(s)</span>}
              </p>
              <div className="flex gap-2">
                <Botao variante="outline" tamanho="sm" onClick={baixarPlanilha}>
                  <Download className="size-3.5" />
                  Baixar planilha (.xlsx)
                </Botao>
                <Botao variante="primary" tamanho="sm" onClick={importarAgora} disabled={importando}>
                  <Upload className="size-3.5" />
                  {importando ? "Importando…" : "Importar clientes agora"}
                </Botao>
              </div>
            </div>

            {importado && (
              <div className="bg-success/10 text-success flex items-start gap-2 rounded-md px-3 py-2 text-xs">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {importado.criados} cliente(s) criado(s)/atualizado(s) no cadastro.
                  {importado.erros.length > 0 && ` ${importado.erros.length} com erro (veja o console).`}
                </span>
              </div>
            )}

            <TabelaWrap>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-border text-subtle border-b">
                    <th className="th-cell">Nome</th>
                    <th className="th-cell">Telefone</th>
                    <th className="th-cell">Valor</th>
                    <th className="th-cell">Arquivo esperado</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.slice(0, 30).map((i, idx) => (
                    <tr key={idx} className="border-border border-t">
                      <td className="td-cell max-w-[12rem] truncate">{i.nome}</td>
                      <td className="td-cell font-mono">{i.numero}</td>
                      <td className="td-cell font-mono">
                        {i.valor != null ? i.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                      </td>
                      <td className="td-cell font-mono text-[11px]">{i.arquivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabelaWrap>
            {itens.length > 30 && (
              <p className="text-subtle text-xs">Mostrando 30 de {itens.length} linhas.</p>
            )}

            {avisos.length > 0 && (
              <details className="text-subtle text-xs">
                <summary className="cursor-pointer select-none">Ver linhas ignoradas</summary>
                <ul className="mt-2 space-y-1">
                  {avisos.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function Importar() {
  const { refreshClientes, setEnvioAtivoId } = useAppState();
  const navigate = useNavigate();
  const [planilha, setPlanilha] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [nomePacote, setNomePacote] = useState("");
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState<ProgressoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [envioIdCriado, setEnvioIdCriado] = useState<string | null>(null);
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
    setProgresso(null);
    setEnvioIdCriado(null);
    try {
      // Etapa 1 -- roda no NAVEGADOR (RAM/CPU de quem está importando, não do
      // servidor): parse da planilha e do zip, casamento PDF<->cliente,
      // extração do código Pix de cada PDF e upload de cada um pro Storage.
      // Pode levar alguns minutos com muitos PDFs -- por isso o progresso
      // aparece na tela em vez de travar num spinner sem explicação.
      const { itens, linhasSemDados, linhasComErroUpload } = await processarImportacaoNoBrowser(
        planilha,
        zip,
        setProgresso,
      );

      // Etapa 2 -- manda pro servidor só texto já pronto (nome, telefone, URLs,
      // código Pix): upsert de cliente + criação do lote de envio. Isso é leve
      // o bastante pra nunca chegar perto de estourar a RAM do servidor, mesmo
      // com 100+ clientes de uma vez.
      const data: Resultado = await api.importacao.enviarLote({ itens, mensagem, lote: nomePacote });
      setResultado({
        ...data,
        // o backend não vê as linhasSemDados que já ficaram de fora no navegador
        // (ex: telefone inválido) -- soma aqui pra não sumir do resumo
        semDadosObrigatorios: [...(data.semDadosObrigatorios as unknown[]), ...linhasSemDados],
        erroUpload: linhasComErroUpload.map((l) => ({
          nome: l.nome,
          numero: l.numero,
          motivoErro: l.motivoErro,
        })),
        total: data.total + linhasSemDados.length + linhasComErroUpload.length,
      });
      await refreshClientes();
      // Não navega mais sozinho: o pacote já fica salvo (é um lote 'pendente'
      // esperando no histórico, com o nome que você deu), e o botão "Disparar
      // agora" abaixo leva pra aba Disparo só quando você quiser -- em vez de
      // sair da tela de resultado antes de dar tempo de ler o resumo.
      if (data.envio?.id) {
        setEnvioIdCriado(data.envio.id);
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setProcessando(false);
      setProgresso(null);
    }
  }

  function dispararAgora() {
    if (!envioIdCriado) return;
    setEnvioAtivoId(envioIdCriado);
    navigate({ to: "/disparos" });
  }

  return (
    <AppShell title="Importar" subtitle="Planilha + ZIP de PDFs viram um lote pronto para disparo">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <ConversorLista />

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
                <label className="label-eyebrow mb-2 block">Nome do pacote (opcional)</label>
                <input
                  type="text"
                  value={nomePacote}
                  onChange={(e) => setNomePacote(e.target.value)}
                  placeholder="Ex: Faturas agosto - safra nova"
                  maxLength={120}
                  className="focus-ring bg-surface text-foreground border-border placeholder:text-subtle w-full rounded-md border px-3 py-2 text-sm"
                />
                <p className="text-subtle mt-2 text-xs">
                  Identifica esse lote no Histórico, pra você achar e disparar depois sem precisar
                  reimportar. Se deixar em branco, fica só com o número do lote.
                </p>
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

              {processando && progresso && (
                <div className="bg-surface-sunken rounded-md px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Processando no seu navegador: {progresso.etapa}
                    </span>
                    <span className="text-subtle font-mono">
                      {progresso.processados}/{progresso.total}
                    </span>
                  </div>
                  <div className="bg-border h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round((progresso.processados / Math.max(progresso.total, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Botao
                  variante="primary"
                  onClick={processar}
                  disabled={processando || !planilha || !zip}
                >
                  {processando
                    ? progresso
                      ? `Processando ${progresso.processados}/${progresso.total}…`
                      : "Preparando…"
                    : "Processar importação"}
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
                    {
                      k: "Erro no upload do PDF",
                      v: resultado.erroUpload.length,
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

                {resultado.erroUpload.length > 0 && (
                  <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs">
                    <p className="mb-1 font-medium">Falha ao subir PDF (veja o console pro erro completo):</p>
                    <ul className="space-y-1">
                      {resultado.erroUpload.slice(0, 5).map((e, i) => (
                        <li key={i} className="font-mono">
                          {e.nome}: {e.motivoErro}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {resultado.sucesso.length > 0 && (
                  <div className="bg-success/10 text-success flex items-start gap-2 rounded-md px-3 py-2 text-xs">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {resultado.sucesso.length} cliente(s) importado(s) com sucesso. O pacote já
                      está salvo{nomePacote ? ` como "${nomePacote}"` : ""} e aparece no Histórico.
                    </span>
                  </div>
                )}

                {envioIdCriado && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Botao variante="primary" onClick={dispararAgora} className="flex-1">
                      Disparar agora
                    </Botao>
                    <Botao variante="outline" onClick={() => navigate({ to: "/historico" })} className="flex-1">
                      Ver no histórico depois
                    </Botao>
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
                O processamento dos PDFs (achar o código Pix, montar o pacote de envio) roda no seu
                navegador, não no servidor -- por isso pode levar alguns minutos com muitos arquivos,
                mas não trava nem sobrecarrega o sistema para outros usuários. Linhas com problema
                ficam destacadas e não travam o resto do lote. Ao processar, o pacote já fica salvo
                e pendente -- você escolhe se quer disparar na hora ou só depois, pelo Histórico.
              </p>
            </div>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
