import { createFileRoute } from "@tanstack/react-router";
import { LogOut, RefreshCw } from "lucide-react";
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
          "Status da sessão do WhatsApp: QR Code de vínculo, instância ativa, uptime e desconexão segura do dispositivo.",
      },
      { property: "og:title", content: "Conexão do WhatsApp — Veloce Faturas" },
      {
        property: "og:description",
        content: "QR Code de vínculo, instância ativa, uptime e desconexão da sessão.",
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

function Conexao() {
  const { whatsappStatus, whatsappQr } = useAppState();
  const [acao, setAcao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const info = statusInfo[whatsappStatus] ?? statusInfo.disconnected;

  // Não existe endpoint dedicado a "gerar novo QR" -- o backend gera um QR novo
  // automaticamente sempre que a sessão é desconectada (logout limpa e reinicia).
  async function gerarNovoQr() {
    setAcao(true);
    setErro(null);
    try {
      await api.whatsapp.logout();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAcao(false);
    }
  }

  return (
    <AppShell
      title="Conexão"
      subtitle="Sessão do WhatsApp vinculada por QR Code"
      actions={
        <button
          onClick={gerarNovoQr}
          disabled={acao || whatsappStatus === "connected"}
          className="bg-surface-raised text-foreground hover:bg-surface-raised/70 inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium ring-1 ring-white/10 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={acao ? "size-3.5 animate-spin" : "size-3.5"} />
          Gerar novo QR
        </button>
      }
    >
      {erro && (
        <div className="mb-6 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400 ring-1 ring-red-500/20">
          {erro}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <section className="panel lg:col-span-5 p-6">
          <h3 className="font-display mb-4 text-sm font-medium">Vincular dispositivo</h3>
          <div className="bg-foreground mb-4 aspect-square rounded-lg p-4">
            {whatsappStatus === "qr" && whatsappQr ? (
              <img src={whatsappQr} alt="QR Code do WhatsApp" className="h-full w-full rounded bg-white object-contain p-2" />
            ) : (
              <div className="grid h-full w-full place-items-center rounded bg-white/90 outline-1 -outline-offset-1 outline-black/5">
                <span className="text-subtle px-4 text-center text-[10px] font-medium tracking-[0.15em] uppercase">
                  {whatsappStatus === "connected"
                    ? "Dispositivo conectado"
                    : whatsappStatus === "connecting"
                      ? "Conectando..."
                      : "Aguardando QR Code"}
                </span>
              </div>
            )}
          </div>
          <p className="text-subtle text-xs text-pretty">
            Abra o WhatsApp no celular, vá em Aparelhos conectados e escaneie. A sessão fica salva em
            disco e sobrevive a reinícios do servidor.
          </p>
        </section>

        <div className="space-y-6 lg:col-span-7">
          <section className="panel p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <h3 className="font-display text-sm font-medium">Sessão atual</h3>
              <span
                className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold tracking-wider uppercase ring-1 ${info.className}`}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {info.label}
              </span>
            </div>
            <p className="text-subtle text-xs text-pretty">
              O status acima é atualizado automaticamente a cada 3 segundos, refletindo a conexão real
              do backend com o WhatsApp (Baileys).
            </p>
            <button
              onClick={gerarNovoQr}
              disabled={acao || whatsappStatus === "disconnected"}
              className="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground mt-6 inline-flex h-9 items-center gap-2 rounded-md border px-4 text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40"
            >
              <LogOut className="size-3.5" />
              Desconectar
            </button>
          </section>

          <section className="panel p-6">
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
        </div>
      </div>
    </AppShell>
  );
}
