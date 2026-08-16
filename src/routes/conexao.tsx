import { createFileRoute } from "@tanstack/react-router";
import { LogOut, Plug, RefreshCw } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAppState } from "@/lib/app-state";
import { api } from "@/api";
import type { WhatsappConexao, WhatsappSlot } from "@/lib/types";

export const Route = createFileRoute("/conexao")({
  head: () => ({
    meta: [
      { title: "Conexão do WhatsApp — Veloce Faturas" },
      {
        name: "description",
        content:
          "Status das sessões do WhatsApp: QR Code de vínculo, instância ativa, uptime e desconexão segura de cada dispositivo.",
      },
      { property: "og:title", content: "Conexão do WhatsApp — Veloce Faturas" },
      {
        property: "og:description",
        content: "QR Code de vínculo, instância ativa, uptime e desconexão de cada sessão.",
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

// Cada slot é uma sessão WhatsApp independente -- se o slot 1 cair, o slot 2
// continua intacto (e vice-versa). Antes esta tela mostrava um status "agregado"
// (o melhor entre os dois), então quando um slot caía mas o outro seguia
// conectado, os botões de conectar/desconectar ficavam bloqueados ou agiam na
// sessão errada. Agora cada slot tem seu próprio card, QR e ações.
function CardSlot({ conexao }: { conexao: WhatsappConexao }) {
  const { refreshConexoes } = useAppState();
  const [acao, setAcao] = useState<"conectar" | "desconectar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const info = statusInfo[conexao.status] ?? statusInfo.disconnected;

  async function conectar() {
    setAcao("conectar");
    setErro(null);
    try {
      await api.whatsapp.conectar(conexao.slot);
      await refreshConexoes();
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
      await api.whatsapp.desconectar(conexao.slot);
      await refreshConexoes();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAcao(null);
    }
  }

  const podeConectar = conexao.status === "disconnected";
  const podeDesconectar = conexao.status !== "disconnected";

  return (
    <section className="panel p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h3 className="font-display text-sm font-medium">WhatsApp {conexao.slot}</h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold tracking-wider uppercase ring-1 ${info.className}`}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {info.label}
        </span>
      </div>

      <div className="bg-foreground mb-4 aspect-square max-w-52 rounded-lg p-4">
        {conexao.status === "qr" && conexao.qr ? (
          <img src={conexao.qr} alt={`QR Code WhatsApp ${conexao.slot}`} className="h-full w-full rounded bg-white object-contain p-2" />
        ) : (
          <div className="grid h-full w-full place-items-center rounded bg-white/90 outline-1 -outline-offset-1 outline-black/5">
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
        <div className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/20">
          {erro}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={conectar}
          disabled={acao !== null || !podeConectar}
          className="bg-surface-raised text-foreground hover:bg-surface-raised/70 inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium ring-1 ring-white/10 transition-colors disabled:opacity-50"
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
  );
}

function Conexao() {
  const { conexoes } = useAppState();
  const slots: WhatsappSlot[] = [1, 2];

  return (
    <AppShell title="Conexão" subtitle="Sessões do WhatsApp vinculadas por QR Code (2 conexões independentes)">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {slots.map((slot) => {
          const conexao = conexoes.find((c) => c.slot === slot) ?? {
            slot,
            configurada: false,
            status: "disconnected" as const,
            qr: null,
            telefone: null,
            nome: null,
            ultima_conexao: null,
            mensagens_enviadas: null,
          };
          return <CardSlot key={slot} conexao={conexao} />;
        })}
      </div>

      <section className="panel mt-6 p-6">
        <h3 className="font-display mb-4 text-sm font-medium">Proteções de envio</h3>
        <ul className="text-muted-foreground space-y-3 text-xs">
          <li className="flex gap-3">
            <span className="text-primary-glow shrink-0 font-mono">01</span>
            Delay aleatório entre mensagens, simulando digitação humana.
          </li>
          <li className="flex gap-3">
            <span className="text-primary-glow shrink-0 font-mono">02</span>
            Pausa longa a cada bloco de mensagens enviadas.
          </li>
          <li className="flex gap-3">
            <span className="text-primary-glow shrink-0 font-mono">03</span>
            Limite diário global com retomada à meia-noite (Brasília).
          </li>
          <li className="flex gap-3">
            <span className="text-primary-glow shrink-0 font-mono">04</span>
            Número validado no WhatsApp antes de tentar o envio.
          </li>
        </ul>
      </section>
    </AppShell>
  );
}
