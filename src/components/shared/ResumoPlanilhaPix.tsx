import { CheckCircle2, Circle, Download, Loader2, Sheet, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Aviso, Botao } from "@/components/shared/Controls";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
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
function baixarRelatorioPlanilhaPix(resumo: ResultadoCasamento, nomeOriginal: string | undefined) {
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
//
// Roda em segundo plano no servidor, ABA POR ABA: o clique só inicia; esta
// tela consulta o andamento a cada 2s (barra de progresso, aba atual, erro
// por aba, Pix conferidos na planilha). Se já tiver uma rodando (clique de
// outra pessoa), acompanha essa em vez de dar erro.
export type AbaTarefa = {
  nome: string;
  linhas?: number;
  status: "pendente" | "rodando" | "ok" | "erro";
  preenchidas: number;
  verificadas: number;
  ignorada?: boolean;
  erro: string | null;
};
export type TarefaPlanilha = {
  id: string;
  status: "rodando" | "concluido" | "concluido_com_erros" | "erro";
  etapa: "buscando" | "listando" | "abas" | "fim";
  mensagem: string;
  iniciadoEm: string;
  terminadoEm: string | null;
  planilha: string | null;
  extracoesEnviadas: number;
  abas: AbaTarefa[];
  resumo:
    | (ResultadoCasamento & { escritas?: number; verificadas?: number; puladasNaHora?: number })
    | null;
  erro: string | null;
};

const INTERVALO_STATUS_MS = 2000;

function percentual(t: TarefaPlanilha): number {
  if (t.etapa === "fim") return 100;
  if (t.etapa === "buscando") return 3;
  if (t.etapa === "listando" || !t.abas.length) return 8;
  const feitas = t.abas.filter((a) => a.status === "ok" || a.status === "erro").length;
  return Math.round(10 + (90 * feitas) / t.abas.length);
}

function duracao(inicio: string, fim: string | null, agora: number): string {
  const ms = (fim ? new Date(fim).getTime() : agora) - new Date(inicio).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s`;
}

function IconeAba({ status }: { status: AbaTarefa["status"] }) {
  if (status === "rodando") return <Loader2 className="text-primary size-3.5 animate-spin" />;
  if (status === "ok") return <CheckCircle2 className="text-success size-3.5" />;
  if (status === "erro") return <XCircle className="text-destructive size-3.5" />;
  return <Circle className="text-subtle size-3.5" />;
}

export function BotaoAtualizarPlanilhaPix() {
  const [tarefa, setTarefa] = useState<TarefaPlanilha | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const rodando = tarefa?.status === "rodando";

  // Ao abrir a tela: mostra a última atualização (ou acompanha a que estiver rodando).
  useEffect(() => {
    api.integracao
      .statusPlanilha()
      .then((r) => setTarefa(r.tarefa))
      .catch(() => {});
  }, []);

  // Enquanto roda: consulta o andamento e atualiza o relógio.
  useEffect(() => {
    if (!rodando) return;
    let falhasSeguidas = 0;
    const id = setInterval(() => {
      setAgora(Date.now());
      api.integracao
        .statusPlanilha()
        .then((r) => {
          falhasSeguidas = 0;
          if (r.tarefa) setTarefa(r.tarefa);
          else
            setErro(
              "O servidor reiniciou e perdeu o andamento. Confira a aba Log Pix da planilha e, se preciso, clique de novo.",
            );
        })
        .catch((e) => {
          if (++falhasSeguidas >= 5) setErro(`Sem resposta do servidor: ${(e as Error).message}`);
        });
    }, INTERVALO_STATUS_MS);
    return () => clearInterval(id);
  }, [rodando]);

  async function atualizar() {
    setIniciando(true);
    setErro(null);
    try {
      const r = await api.integracao.atualizarPlanilha();
      setTarefa(r.tarefa);
      setAgora(Date.now());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setIniciando(false);
    }
  }

  const pct = tarefa ? percentual(tarefa) : 0;
  const terminouComErro = tarefa?.status === "erro" || tarefa?.status === "concluido_com_erros";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Botao variante="primary" onClick={atualizar} disabled={rodando || iniciando}>
          {rodando || iniciando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sheet className="size-4" />
          )}
          {rodando ? "Atualizando a planilha…" : "Atualizar Pix na planilha"}
        </Botao>
        <p className="text-subtle text-xs">
          Envia os Pix extraídos por todos os operadores pra planilha oficial (Google Sheets). Só
          preenche células de Pix vazias.
        </p>
      </div>

      {erro && <Aviso tone="danger">{erro}</Aviso>}

      {tarefa && (
        <div className="border-border space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">
              {rodando
                ? "Em andamento"
                : tarefa.status === "erro"
                  ? "Falhou"
                  : tarefa.status === "concluido_com_erros"
                    ? "Concluído com erros"
                    : "Concluído"}
              {tarefa.planilha && (
                <span className="text-subtle font-normal"> · {tarefa.planilha}</span>
              )}
            </span>
            <span className="text-subtle tabular-nums">
              {pct}% · {duracao(tarefa.iniciadoEm, tarefa.terminadoEm, agora)}
              {!rodando &&
                tarefa.terminadoEm &&
                ` · ${new Date(tarefa.terminadoEm).toLocaleString("pt-BR")}`}
            </span>
          </div>
          <Progress
            value={pct}
            {...(tarefa.status === "erro"
              ? { indicatorClassName: "bg-destructive" }
              : tarefa.status === "concluido_com_erros"
                ? { indicatorClassName: "bg-warning" }
                : {})}
          />
          <p className="text-sm">{tarefa.mensagem}</p>
          {tarefa.extracoesEnviadas > 0 && (
            <p className="text-subtle text-xs">
              {tarefa.extracoesEnviadas} Pix extraído(s) enviados pra conferência.
            </p>
          )}

          {tarefa.abas.length > 0 && (
            <ul className="divide-border divide-y rounded-md border text-xs">
              {tarefa.abas.map((a) => (
                <li key={a.nome} className="flex items-center gap-2 px-2 py-1.5">
                  <IconeAba status={a.status} />
                  <span className="min-w-0 flex-1 truncate font-medium">{a.nome}</span>
                  <span
                    className={cn(
                      "shrink-0 text-right",
                      a.status === "erro" ? "text-destructive" : "text-subtle",
                    )}
                  >
                    {a.status === "pendente" && "aguardando"}
                    {a.status === "rodando" && "processando…"}
                    {a.status === "ok" &&
                      (a.ignorada
                        ? "ignorada (sem OS/CLIENTE/VENCIMENTO)"
                        : `${a.verificadas} Pix gravado(s) e conferido(s)`)}
                    {a.status === "erro" && a.erro}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!rodando && tarefa.resumo && (
            <>
              {(tarefa.resumo.verificadas ?? 0) < (tarefa.resumo.escritas ?? 0) && (
                <Aviso tone="warning">
                  {(tarefa.resumo.escritas ?? 0) - (tarefa.resumo.verificadas ?? 0)} Pix foram
                  escritos mas não apareceram na releitura da planilha. Confira a aba Log Pix.
                </Aviso>
              )}
              {(tarefa.resumo.puladasNaHora ?? 0) > 0 && (
                <Aviso tone="info">
                  {tarefa.resumo.puladasNaHora} célula(s) foram preenchidas por alguém durante a
                  atualização e não foram mexidas.
                </Aviso>
              )}
              <ResultadoPlanilhaPix resultado={tarefa.resumo} nomeArquivo="planilha-oficial" />
            </>
          )}
          {!rodando && terminouComErro && !tarefa.resumo && tarefa.erro && (
            <Aviso tone="danger">{tarefa.erro}</Aviso>
          )}
        </div>
      )}
    </div>
  );
}
