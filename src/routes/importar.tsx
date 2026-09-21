import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Download, TriangleAlert, Upload, Wand2 } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { UploadAvulsoFaturas } from "@/components/shared/UploadAvulsoFaturas";
import { Aviso, Botao, TabelaWrap } from "@/components/shared/Controls";
import { StatusPill } from "@/components/shared/StatusPill";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { api } from "@/api";

// "2026-09-24" -> "24/09/2026" (mesmo padrão de exibição usado no resto do
// sistema, ver formatarDataIsoParaBr no backend).
function formatarPrazo(iso?: string | null) {
  if (!iso) return "—";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const [, ano, mes, dia] = match;
  return `${dia}/${mes}/${ano}`;
}

export const Route = createFileRoute("/importar")({
  head: () => ({
    meta: [
      { title: "Importar clientes e faturas — Voxcel Faturas" },
      {
        name: "description",
        content:
          "Cole a lista de clientes (sem precisar de planilha nem zip) e suba os PDFs das faturas soltos -- cada um é casado pelo nome do arquivo, sem passar por OCR.",
      },
      { property: "og:title", content: "Importar clientes e faturas — Voxcel Faturas" },
      {
        property: "og:description",
        content: "Dois passos independentes: lista crua de clientes, e upload de PDFs avulsos.",
      },
    ],
  }),
  component: Importar,
});

type ItemConvertido = {
  nome: string;
  numero: string;
  valor: number | null;
  arquivo: string;
  // [2026-08] Ver CONTEXTO.md ("Safras") -- vêm preenchidos quando a lista
  // crua trouxer "Fatura N" + data de prazo; null em listas sem essa info.
  tipo_fatura?: "FPD" | "SPD" | null;
  data_prazo?: string | null; // "YYYY-MM-DD"
  numero_contrato?: string | null;
};

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
  const [progressoImportacao, setProgressoImportacao] = useState<{ processados: number; total: number } | null>(null);

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

  // Manda em pedaços de 100 (em vez de 1 requisição só com os até 1000 itens)
  // pra dar progresso REAL: cada pedaço concluído é uma requisição que já
  // terminou de verdade no servidor, não uma estimativa de tempo. Sem isso,
  // uma lista grande ficava minutos presa em "Importando…" sem nenhuma pista
  // de quanto faltava nem se estava travada.
  const TAMANHO_LOTE_IMPORTACAO = 100;

  async function importarAgora() {
    if (!itens || itens.length === 0) return;
    setImportando(true);
    setErro(null);
    setImportado(null);
    setProgressoImportacao({ processados: 0, total: itens.length });
    try {
      let criados = 0;
      const erros: unknown[] = [];
      for (let i = 0; i < itens.length; i += TAMANHO_LOTE_IMPORTACAO) {
        const bloco = itens.slice(i, i + TAMANHO_LOTE_IMPORTACAO);
        const data = await api.clientes.importarLista(bloco);
        criados += data.criados;
        erros.push(...data.erros);
        setProgressoImportacao({ processados: Math.min(i + bloco.length, itens.length), total: itens.length });
      }
      setImportado({ criados, erros });
      await refreshClientes();
    } catch (e) {
      // Erro no meio do caminho: o que já foi importado nos blocos
      // anteriores continua salvo (cada bloco é sua própria transação no
      // backend) -- por isso mantemos o progresso visível na mensagem em vez
      // de escondê-lo, pra ficar claro que não é tudo-ou-nada.
      const processadosAteAqui = progressoImportacao?.processados ?? 0;
      setErro(
        `${(e as Error).message} (${processadosAteAqui} de ${itens.length} linha(s) já haviam sido importadas antes do erro)`,
      );
    } finally {
      setImportando(false);
      setProgressoImportacao(null);
    }
  }

  const clientesUnicos = itens ? new Set(itens.map((i) => i.nome)).size : 0;

  return (
    <SectionCard
      titulo="1. Cole a lista de clientes"
      descricao='Cole o texto solto (nome, contrato, CPF, telefone(s), fatura, valor) -- vira planilha no formato do modelo, uma linha por telefone. Não precisa de PDF nenhum aqui.'
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
                  {importando && progressoImportacao
                    ? `Importando ${progressoImportacao.processados}/${progressoImportacao.total}…`
                    : importando
                      ? "Importando…"
                      : "Importar clientes agora"}
                </Botao>
              </div>
            </div>

            {importando && progressoImportacao && (
              <div className="bg-surface-sunken rounded-md px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Salvando clientes no cadastro…</span>
                  <span className="text-subtle font-mono">
                    {progressoImportacao.processados}/{progressoImportacao.total}
                  </span>
                </div>
                <div className="bg-border h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full transition-all"
                    style={{
                      width: `${Math.round((progressoImportacao.processados / Math.max(progressoImportacao.total, 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {importado && (
              <div
                className={cn(
                  "flex items-start gap-2 rounded-md px-3 py-2 text-xs",
                  importado.erros.length > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
                )}
              >
                {importado.erros.length > 0 ? (
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                )}
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
                    <th className="th-cell">Fatura</th>
                    <th className="th-cell">Prazo</th>
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
                      <td className="td-cell">
                        {i.tipo_fatura ? (
                          <StatusPill tone={i.tipo_fatura === "FPD" ? "info" : "brand"}>
                            {i.tipo_fatura}
                          </StatusPill>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="td-cell font-mono">{formatarPrazo(i.data_prazo)}</td>
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
  const { refreshClientes } = useAppState();

  return (
    <AppShell
      title="Importar"
      subtitle="Dois passos independentes: cole a lista de clientes e suba os PDFs das faturas"
    >
      <div className="space-y-6">
        <ConversorLista />
        <UploadAvulsoFaturas onAssociado={refreshClientes} />
      </div>
    </AppShell>
  );
}
