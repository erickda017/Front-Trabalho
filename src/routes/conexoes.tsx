import { createFileRoute } from "@tanstack/react-router";
import { Loader2, QrCode, ShieldCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import { ptBR } from "date-fns/locale";
import { formatDistanceToNow } from "date-fns";

import { AppShell, statusConexao } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusPill } from "@/components/shared/StatusPill";
import { EmptyState } from "@/components/shared/EmptyState";
import { Aviso, Botao } from "@/components/shared/Controls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAppState } from "@/lib/app-state";
import { api } from "@/api";
import type { WhatsappConexao, WhatsappSlot } from "@/lib/types";

export const Route = createFileRoute("/conexoes")({
  head: () => ({
    meta: [
      { title: "Conexões — Veloce Faturas" },
      {
        name: "description",
        content: "Gerencie as duas conexões de WhatsApp usadas para o disparo de faturas.",
      },
      { property: "og:title", content: "Conexões — Veloce Faturas" },
      { property: "og:description", content: "Conectar, desconectar e acompanhar o status das duas sessões." },
    ],
  }),
  component: Conexoes,
});

function formatarData(iso: string | null) {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "—";
  }
}

function PainelConexao({ conexao }: { conexao: WhatsappConexao }) {
  const { refreshConexoes } = useAppState();
  const [acaoCarregando, setAcaoCarregando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const info = statusConexao[conexao.status] ?? statusConexao['disconnected']!;

  async function conectar() {
    setAcaoCarregando(true);
    setErroAcao(null);
    try {
      await api.whatsapp.conectar(conexao.slot);
      await refreshConexoes();
    } catch (e) {
      setErroAcao((e as Error).message);
    } finally {
      setAcaoCarregando(false);
    }
  }

  async function desconectar() {
    setAcaoCarregando(true);
    setErroAcao(null);
    try {
      await api.whatsapp.desconectar(conexao.slot);
      await refreshConexoes();
    } catch (e) {
      setErroAcao((e as Error).message);
    } finally {
      setAcaoCarregando(false);
    }
  }

  return (
    <SectionCard
      titulo={`WhatsApp ${conexao.slot}`}
      eyebrow="Sessão"
      acoes={
        <StatusPill tone={info.tone} dot pulse={conexao.status === "connected"}>
          {info.label}
        </StatusPill>
      }
    >
      <div className="flex flex-col gap-4">
        {!conexao.configurada ? (
          <EmptyState
            icon={Smartphone}
            titulo={`WhatsApp ${conexao.slot} não configurado`}
            descricao="Clique em conectar para iniciar a sessão e gerar o QR Code."
            compacto
          />
        ) : (
          <div className="text-muted-foreground grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
            <span>Telefone: {conexao.telefone ?? "—"}</span>
            <span>Nome: {conexao.nome ?? "—"}</span>
            <span>Última conexão: {formatarData(conexao.ultima_conexao)}</span>
            <span>Mensagens enviadas: {conexao.mensagens_enviadas ?? "—"}</span>
          </div>
        )}

        <div className="bg-surface-sunken flex min-h-40 flex-col items-center justify-center gap-2 rounded-md p-4">
          {conexao.status === "qr" && conexao.qr ? (
            <img src={conexao.qr} alt={`QR Code WhatsApp ${conexao.slot}`} className="size-40 rounded-md bg-white p-1" />
          ) : conexao.status === "connecting" ? (
            <>
              <Loader2 className="text-subtle size-6 animate-spin" />
              <p className="text-subtle text-xs">Conectando...</p>
            </>
          ) : conexao.status === "connected" ? (
            <>
              <ShieldCheck className="text-success size-6" />
              <p className="text-subtle text-xs">Sessão conectada</p>
            </>
          ) : (
            <>
              <QrCode className="text-subtle size-6" />
              <p className="text-subtle text-xs">Desconectado — clique em conectar</p>
            </>
          )}
        </div>

        {erroAcao && <Aviso tone="danger">{erroAcao}</Aviso>}

        <div className="flex flex-wrap gap-2">
          <Botao
            variante="primary"
            tamanho="sm"
            onClick={conectar}
            disabled={acaoCarregando || conexao.status === "connected"}
          >
            {acaoCarregando ? "Aguarde..." : "Conectar"}
          </Botao>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Botao variante="danger" tamanho="sm" disabled={acaoCarregando || conexao.status === "disconnected"}>
                Desconectar
              </Botao>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Desconectar WhatsApp {conexao.slot}?</AlertDialogTitle>
                <AlertDialogDescription>
                  A sessão atual será encerrada e será necessário escanear um novo QR Code para reconectar.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={desconectar}>Desconectar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </SectionCard>
  );
}

function Conexoes() {
  const { conexoes, conexoesErro, conexoesCarregando } = useAppState();

  return (
    <AppShell title="Conexões" subtitle="Gerenciamento das duas sessões de WhatsApp">
      <div className="flex flex-col gap-6">
        {conexoesErro && (
          <Aviso tone="danger">Não foi possível carregar as conexões: {conexoesErro}</Aviso>
        )}

        {conexoesCarregando && !conexoes.length ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[1, 2].map((i) => (
              <div key={i} className="panel h-64 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {conexoes.map((c) => (
              <PainelConexao key={c.slot} conexao={c} />
            ))}
          </div>
        )}

        <SectionCard titulo="Proteções de envio" eyebrow="Segurança" descricao="Mecanismos aplicados automaticamente pelo backend durante o disparo.">
          <ul className="text-muted-foreground list-inside list-disc space-y-1.5 text-xs">
            <li>Delay aleatório entre o envio de cada mensagem.</li>
            <li>Pausa automática a cada bloco de envios.</li>
            <li>Limite diário de disparos, com retomada à meia-noite no horário de Brasília.</li>
            <li>Número validado no WhatsApp antes do envio, evitando disparos para contatos inválidos.</li>
          </ul>
        </SectionCard>
      </div>
    </AppShell>
  );
}
