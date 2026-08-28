import { createFileRoute } from "@tanstack/react-router";
import { LogOut, Plug, RefreshCw } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAppState } from "@/lib/app-state";
import { api } from "@/api";

export const Route = createFileRoute("/conexao")({
  head: () => ({
    meta: [
      { title: "Conexão do WhatsApp — Veloce Faturas" },
      {
        name: "description",
        content:
          "Status da sua sessão do WhatsApp: QR Code de vínculo, instância ativa, uptime e desconexão segura.",
      },
      { property: "og:title", content: "Conexão do WhatsApp — Veloce Faturas" },
      {
        property: "og:description",
        content: "QR Code de vínculo, instância ativa, uptime e desconexão da sua sessão.",
      },
    ],
  }),
  component: Conexao,
});

const statusInfo = {
  connected: { label: "Conectado", className: "bg-success/10 text-success ring-success/25" },
  qr: { label: "Aguardando QR Code", className: "bg-warning/10 text-warning ring-warning/25" },
  connecting: { label: "Conectando", className: "bg-warning/10 text-warning ring-warning/25" },
  disconnected: {
    label: "Desconectado",
    className: "bg-destructive/10 text-destructive ring-destructive/25",
  },
} as const;

// [2026-08] MULTI-TENANT: 1 sessão de WhatsApp por usuário logado -- não
// existe mais grade de slots, só o card da sua própria conexão.
function Conexao() {
  const { conexao, refreshConexao } = useAppState();
  const [acao, setAcao] = useState<"conectar" | "desconectar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const info = statusInfo[conexao.status] ?? statusInfo.disconnected;

  async function conectar() {
    setAcao("conectar");
    setErro(null);
    try {
      await api.whatsapp.conectar();
      await refreshConexao();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAcao(null);
    }
  }

  async function desconectar() {
    setAcao("desconectar");
    setErro(null);
    try {
      await api.whatsapp.desconectar();
      await refreshConexao();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAcao(null);
    }
  }

  const podeConectar = conexao.status === "disconnected";
  const podeDesconectar = conexao.status !== "disconnected";

  return (
    <AppShell title="Conexão" subtitle="Sua sessão do WhatsApp vinculada por QR Code">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="panel p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h3 className="font-display text-sm font-medium">Seu WhatsApp</h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold tracking-wider uppercase ring-1 ${info.className}`}
            >
              <span className="size-1.5 rounded-full bg-current" />
              {info.label}
            </span>
          </div>

          <div className="bg-foreground mb-4 aspect-square max-w-52 rounded-lg p-4">
            {conexao.status === "qr" && conexao.qr ? (
              <img src={conexao.qr} alt="QR Code do WhatsApp" className="bg-qr-surface h-full w-full rounded object-contain p-2" />
            ) : (
              <div className="bg-qr-surface/90 grid h-full w-full place-items-center rounded outline-1 -outline-offset-1 outline-black/5">
                <span className="text-subtle px-4 text-center text-[10px] font-medium tracking-[0.15em] uppercase">
                  {conexao.status === "connected"
                    ? "Dispositivo conectado"
                    : conexao.status === "connecting"
                      ? "Conectando..."
                      : "Sem QR ativo"}
                </span>
              </div>
            )}
          </div>

          {conexao.telefone && (
            <p className="text-subtle mb-3 font-mono text-xs">
              {conexao.telefone}
              {conexao.nome ? ` — ${conexao.nome}` : ""}
            </p>
          )}

          {erro && (
            <div className="bg-destructive/10 text-destructive ring-destructive/20 mb-3 rounded-md px-3 py-2 text-xs ring-1">
              {erro}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={conectar}
              disabled={acao !== null || !podeConectar}
              className="bg-surface-raised text-foreground hover:bg-surface-raised/70 ring-border inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium ring-1 transition-colors disabled:opacity-50"
            >
              {acao === "conectar" ? <RefreshCw className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
              {conexao.status === "qr" || conexao.status === "connecting" ? "Gerar novo QR" : "Conectar"}
            </button>
            <button
              onClick={desconectar}
              disabled={acao !== null || !podeDesconectar}
              className="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground inline-flex h-9 items-center gap-2 rounded-md border px-4 text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40"
            >
              {acao === "desconectar" ? <RefreshCw className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
              Desconectar
            </button>
          </div>
        </section>
      </div>

      <section className="panel mt-6 p-6">
        <h3 className="font-display mb-4 text-sm font-medium">Proteções de envio</h3>
        <ul className="text-muted-foreground space-y-3 text-xs">
          <li className="flex gap-3">
            <span className="text-primary-strong shrink-0 font-mono">01</span>
            Delay aleatório entre mensagens, simulando digitação humana.
          </li>
          <li className="flex gap-3">
            <span className="text-primary-strong shrink-0 font-mono">02</span>
            Pausa longa a cada bloco de mensagens enviadas.
          </li>
          <li className="flex gap-3">
            <span className="text-primary-strong shrink-0 font-mono">03</span>
            Limite diário (por operador) com retomada à meia-noite (Brasília).
          </li>
          <li className="flex gap-3">
            <span className="text-primary-strong shrink-0 font-mono">04</span>
            Número validado no WhatsApp antes de tentar o envio.
          </li>
        </ul>
      </section>
    </AppShell>
  );
}
