import { Download, Loader2, Sheet } from "lucide-react";
import { useState } from "react";

import { Aviso, Botao } from "@/components/shared/Controls";
import { api } from "@/api";
import { paraBr } from "@/lib/dataBr";
import type { ResumoPlanilhaPix, StatusLinha } from "@/lib/casarPlanilhaPix";

// [2026-10] Resultado do casamento planilha x Pix -- usado pelo upload manual
// (Supervisor > Planilha de PIX) e pelo botão "Atualizar Pix na planilha"
// (Google Sheets oficial, via backend /integracao/planilha/atualizar + Apps
// Script em integracoes/google-sheets/). Os dois devolvem o mesmo formato.
export type ResultadoCasamento = Omit<ResumoPlanilhaPix, "escritas"> & {
  extracoesEnviadas?: number;
};

const ROTULO_STATUS: Record<StatusLinha, string> = {
  preenchida: "preenchida",
  ja_tinha_pix: "já tinha Pix",
  ocupada: "célula com outro texto",
  sem_extracao: "sem PDF extraído",
  divergente: "OS bate, vencimento não (ou ambíguo)",
};

// Relatório "por que cada linha recebeu (ou não) Pix". `;` + BOM pro Excel
// BR abrir com acento e colunas certas.
function baixarRelatorioPlanilhaPix(
  resumo: ResultadoCasamento,
  nomeOriginal: string | undefined,
) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [
    ["Aba", "Linha", "OS", "Cliente", "Vencimento", "Status", "Detalhe"],
    ...resumo.detalhes.map((d) => [
      d.aba,
      d.linha,
      d.os,
      d.cliente,
      paraBr(d.vencimento),
      ROTULO_STATUS[d.status],
      d.motivo,
    ]),
  ];
  const csv = "\uFEFF" + linhas.map((l) => l.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download =
    (nomeOriginal ?? "planilha").replace(/\.(xlsx|xlsm|xls|csv)$/i, "") + "-relatorio-pix.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ResultadoPlanilhaPix({
  resultado,
  nomeArquivo,
}: {
  resultado: ResultadoCasamento;
  nomeArquivo?: string | undefined;
}) {
  return (
    <div className="space-y-3">
      <Aviso tone={resultado.preenchidas === 0 ? "warning" : "info"}>
        <div className="space-y-1">
          <p>
            <strong>{resultado.preenchidas}</strong> de {resultado.linhas} linha(s) receberam Pix (
            {resultado.abas.length} aba(s)).
          </p>
          <ul className="list-disc pl-5">
            <li>
              Pix disponíveis no sistema: {resultado.extracoesRecebidas} extração(ões),{" "}
              {resultado.extracoesComOs} com OS lida no PDF (só essas podem casar).
            </li>
            {resultado.semExtracao > 0 && (
              <li>{resultado.semExtracao} sem nenhum PDF extraído com aquela OS.</li>
            )}
            {resultado.divergentes > 0 && (
              <li>
                {resultado.divergentes} com a OS encontrada, mas vencimento diferente ou ambíguo
                (ver abaixo).
              </li>
            )}
            {resultado.jaTinhamPix > 0 && (
              <li>{resultado.jaTinhamPix} já tinham um código Pix na célula.</li>
            )}
            {resultado.ocupadas > 0 && (
              <li>{resultado.ocupadas} com outro texto na célula de Pix (não foi sobrescrito).</li>
            )}
            {resultado.colunasRedirecionadas.map((c) => (
              <li key={c.aba}>
                {c.aba}: a coluna {c.de} tem nome de Pix mas guarda outra coisa (ex.: "PAGO…") --
                Pix foi pra coluna nova {c.para} ("COD PIX").
              </li>
            ))}
            {resultado.puladas.length > 0 && (
              <li>
                Abas ignoradas: {resultado.puladas.map((p) => `${p.aba} (${p.motivo})`).join(", ")}.
              </li>
            )}
          </ul>
        </div>
      </Aviso>
      <Botao
        tamanho="sm"
        variante="outline"
        onClick={() => baixarRelatorioPlanilhaPix(resultado, nomeArquivo)}
      >
        <Download className="size-3.5" />
        Baixar relatório linha a linha (CSV)
      </Botao>
      {resultado.detalhes.some((d) => d.status === "divergente") && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-surface-sunken text-left">
              <tr>
                <th className="px-2 py-1">Aba</th>
                <th className="px-2 py-1">Linha</th>
                <th className="px-2 py-1">OS</th>
                <th className="px-2 py-1">Cliente</th>
                <th className="px-2 py-1">Vencimento</th>
                <th className="px-2 py-1">Por que não preencheu</th>
              </tr>
            </thead>
            <tbody>
              {resultado.detalhes
                .filter((d) => d.status === "divergente")
                .slice(0, 100)
                .map((d) => (
                  <tr key={`${d.aba}-${d.linha}`} className="border-t">
                    <td className="px-2 py-1">{d.aba}</td>
                    <td className="px-2 py-1">{d.linha}</td>
                    <td className="px-2 py-1">{d.os}</td>
                    <td className="px-2 py-1">{d.cliente}</td>
                    <td className="px-2 py-1">{paraBr(d.vencimento) || "-"}</td>
                    <td className="px-2 py-1">{d.motivo}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// [2026-10] Botão "Atualizar Pix na planilha": o backend manda os Pix de
// TODOS os operadores pro Apps Script da planilha oficial (Google Sheets), que
// preenche só as células vazias da coluna COD PIX. Uso manual (1x por mês,
// no fechamento de pagamento) -- não tem agendamento.
export function BotaoAtualizarPlanilhaPix() {
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCasamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function atualizar() {
    setRodando(true);
    setErro(null);
    setResultado(null);
    try {
      setResultado(await api.integracao.atualizarPlanilha());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Botao variante="primary" onClick={atualizar} disabled={rodando}>
          {rodando ? <Loader2 className="size-4 animate-spin" /> : <Sheet className="size-4" />}
          {rodando ? "Atualizando a planilha… (pode levar até 2 min)" : "Atualizar Pix na planilha"}
        </Botao>
        <p className="text-subtle text-xs">
          Envia os Pix extraídos por todos os operadores pra planilha oficial (Google Sheets). Só
          preenche células de Pix vazias.
        </p>
      </div>
      {erro && <Aviso tone="danger">{erro}</Aviso>}
      {resultado && <ResultadoPlanilhaPix resultado={resultado} nomeArquivo="planilha-oficial" />}
    </div>
  );
}
