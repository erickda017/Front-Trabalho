import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive, Layers, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Aviso, Botao, LinhasEsqueleto, TabelaWrap } from "@/components/shared/Controls";
import { MetricCard } from "@/components/shared/MetricCard";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import type { SafraResumo } from "@/lib/types";

// [2026-08] Ver CONTEXTO.md, seção "Safras (FPD/SPD) e histórico
// consolidado", e README_CLAUDE_BACKEND.md seção 11.
export const Route = createFileRoute("/safras")({
  head: () => ({
    meta: [
      { title: "Safras — Veloce Faturas" },
      {
        name: "description",
        content: "Acompanhamento por safra mensal (FPD/SPD): quantos pagaram, quantos receberam disparo e o histórico consolidado.",
      },
      { property: "og:title", content: "Safras — Veloce Faturas" },
      { property: "og:description", content: "Totais por safra, incluindo as já arquivadas." },
    ],
  }),
  component: Safras,
});

const formatoMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function Safras() {
  const [safras, setSafras] = useState<SafraResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [consolidando, setConsolidando] = useState<string | null>(null);

  async function carregar() {
    setErro(null);
    try {
      const data = await api.safras.listar();
      setSafras(data);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function consolidarAgora(safra: string) {
    setConsolidando(safra);
    try {
      await api.safras.consolidar(safra);
      toast.success(`Safra ${safra} consolidada no histórico.`);
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConsolidando(null);
    }
  }

  const carregando = safras === null && !erro;
  const totalGeral = safras?.reduce((soma, s) => soma + s.total_clientes, 0) ?? 0;
  const pagosGeral = safras?.reduce((soma, s) => soma + s.pagos, 0) ?? 0;
  const disparoGeral = safras?.reduce((soma, s) => soma + s.receberam_disparo, 0) ?? 0;

  return (
    <AppShell
      title="Safras"
      subtitle="Cada safra é o mês/ano de vencimento (PRAZO) das faturas em acompanhamento — FPD é a primeira fatura, SPD a segunda."
    >
      <div className="flex flex-col gap-4">
        {erro && <Aviso tone="danger">{erro}</Aviso>}

        {!carregando && safras && safras.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Safras" valor={safras.length} icon={Layers} />
            <MetricCard label="Clientes (todas as safras)" valor={totalGeral} />
            <MetricCard label="Pagaram" valor={pagosGeral} />
            <MetricCard label="Receberam disparo" valor={disparoGeral} />
          </div>
        )}

        <SectionCard
          titulo="Safras"
          descricao="FPD/SPD e prazo vêm da lista crua colada em Importar → Converter lista. Uma safra fica “arquivada” quando não há mais cliente ativo nela — os números continuam disponíveis pelo histórico consolidado."
          flush
        >
          {carregando ? (
            <TabelaWrap>
              <tbody>
                <LinhasEsqueleto colunas={9} linhas={4} />
              </tbody>
            </TabelaWrap>
          ) : !safras || safras.length === 0 ? (
            <EmptyState
              icon={Layers}
              titulo="Nenhuma safra ainda"
              descricao="Assim que clientes forem importados pela lista crua com Fatura 1/2 e data de prazo, eles aparecem aqui agrupados por mês de vencimento."
              acao={
                <Link to="/importar">
                  <Botao variante="primary">Ir para Importar</Botao>
                </Link>
              }
            />
          ) : (
            <TabelaWrap>
              <thead>
                <tr className="border-border text-subtle border-b">
                  <th className="th-cell">Safra</th>
                  <th className="th-cell">Clientes</th>
                  <th className="th-cell">FPD</th>
                  <th className="th-cell">SPD</th>
                  <th className="th-cell">Pagaram</th>
                  <th className="th-cell">Receberam disparo</th>
                  <th className="th-cell">Valor total</th>
                  <th className="th-cell">Duplicidades</th>
                  <th className="th-cell" />
                </tr>
              </thead>
              <tbody>
                {safras.map((s) => (
                  <tr key={s.safra} className="border-border border-t">
                    <td className="td-cell font-medium">
                      <div className="flex items-center gap-2">
                        <Link
                          to="/clientes"
                          search={{ safra: s.safra }}
                          className="hover:underline"
                          title="Ver clientes desta safra"
                        >
                          {s.rotulo}
                        </Link>
                        {s.arquivada && (
                          <span className="bg-surface-sunken text-subtle inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
                            <Archive className="size-3" /> arquivada
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="td-cell">{s.total_clientes}</td>
                    <td className="td-cell">{s.total_fpd}</td>
                    <td className="td-cell">{s.total_spd}</td>
                    <td className="td-cell">
                      {s.pagos} <span className="text-subtle">/ {s.nao_pagos} pendente(s)</span>
                    </td>
                    <td className="td-cell">
                      {s.receberam_disparo} <span className="text-subtle">/ {s.nao_receberam_disparo} sem disparo</span>
                    </td>
                    <td className="td-cell font-mono">{formatoMoeda.format(s.valor_total || 0)}</td>
                    <td className="td-cell">
                      {s.duplicidades_detectadas > 0 ? (
                        <span className="text-destructive font-medium">{s.duplicidades_detectadas}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="td-cell">
                      {!s.arquivada && (
                        <Botao
                          variante="ghost"
                          tamanho="sm"
                          disabled={consolidando === s.safra}
                          onClick={() => consolidarAgora(s.safra)}
                          title="Grava agora um snapshot dessa safra no histórico (sem apagar nada)"
                        >
                          <RefreshCw className={cn("size-3.5", consolidando === s.safra && "animate-spin")} />
                          Consolidar
                        </Botao>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TabelaWrap>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
