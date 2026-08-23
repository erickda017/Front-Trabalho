import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Camera, Trash2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusPill } from "@/components/shared/StatusPill";
import { Aviso, Botao } from "@/components/shared/Controls";
import { useAppState, type Perfil } from "@/lib/app-state";

// Tamanho máximo aceito para a foto de perfil, antes de converter pra base64
// e guardar no localStorage (que tem limite de alguns MB no total).
const TAMANHO_MAX_FOTO = 2 * 1024 * 1024; // 2MB

function PerfilOperador() {
  const { perfil, atualizarPerfil } = useAppState();
  const [nome, setNome] = useState(perfil.nome);
  const [fotoUrl, setFotoUrl] = useState(perfil.fotoUrl);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const alterado = nome !== perfil.nome || fotoUrl !== perfil.fotoUrl;

  function escolherFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (!arquivo) return;
    setErroFoto(null);

    if (!arquivo.type.startsWith("image/")) {
      setErroFoto("Escolha um arquivo de imagem (PNG, JPG, etc.).");
      return;
    }
    if (arquivo.size > TAMANHO_MAX_FOTO) {
      setErroFoto("Imagem muito grande — escolha uma foto de até 2MB.");
      return;
    }

    const leitor = new FileReader();
    leitor.onload = () => setFotoUrl(typeof leitor.result === "string" ? leitor.result : null);
    leitor.onerror = () => setErroFoto("Não foi possível ler essa imagem.");
    leitor.readAsDataURL(arquivo);
  }

  function salvar() {
    const proximo: Perfil = { nome: nome.trim(), fotoUrl };
    atualizarPerfil(proximo);
    toast.success("Perfil atualizado");
  }

  return (
    <SectionCard
      titulo="Perfil do operador"
      eyebrow="Conta"
      descricao="Nome e foto exibidos na barra lateral — só identificação de quem está operando o painel, guardado neste navegador."
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            {fotoUrl ? (
              <img src={fotoUrl} alt="" className="bg-surface-sunken size-20 rounded-full object-cover" />
            ) : (
              <div className="bg-surface-sunken text-subtle grid size-20 place-items-center rounded-full text-2xl font-semibold">
                {(nome.trim() || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-label="Escolher foto de perfil"
              title="Escolher foto de perfil"
              className="bg-primary text-primary-foreground border-background absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border-2 shadow-sm"
            >
              <Camera className="size-3.5" />
            </button>
          </div>
          <input ref={inputRef} type="file" accept="image/*" onChange={escolherFoto} className="hidden" />
          {fotoUrl && (
            <button
              type="button"
              onClick={() => setFotoUrl(null)}
              className="text-subtle hover:text-destructive flex items-center gap-1 text-[11px]"
            >
              <Trash2 className="size-3" /> Remover foto
            </button>
          )}
        </div>

        <div className="flex-1 space-y-3">
          <div>
            <label htmlFor="nome-operador" className="label-eyebrow mb-1.5 block">
              Nome do operador
            </label>
            <input
              id="nome-operador"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Ana Souza"
              maxLength={60}
              className="bg-surface text-foreground border-border focus-ring w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          {erroFoto && <Aviso tone="danger">{erroFoto}</Aviso>}

          <Botao variante="primary" tamanho="sm" onClick={salvar} disabled={!alterado}>
            Salvar perfil
          </Botao>
        </div>
      </div>
    </SectionCard>
  );
}

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Veloce Faturas" },
      {
        name: "description",
        content: "Perfil do operador e ambiente de integração do painel.",
      },
      { property: "og:title", content: "Configurações — Veloce Faturas" },
      { property: "og:description", content: "Perfil do operador, conexão ativa e ambiente da aplicação." },
    ],
  }),
  component: Configuracoes,
});

// [2026-08] MULTI-TENANT: seção de "Estratégia de envio" removida -- não
// existe mais round-robin/slot fixo pra escolher, cada usuário tem 1
// WhatsApp só (ver migration-13-multi-tenant.sql). O que sobra aqui é só um
// resumo do status da própria conexão, com link pra tela de Conexão.
function Configuracoes() {
  const { conexao, supabaseConfigurado } = useAppState();

  return (
    <AppShell title="Configurações" subtitle="Perfil do operador e ambiente do painel">
      <div className="flex flex-col gap-6">
        <PerfilOperador />

        <SectionCard
          titulo="Conexão do WhatsApp"
          eyebrow="Resumo"
          acoes={
            <Link to="/conexoes" className="text-xs font-medium text-primary hover:underline">
              Ver conexão
            </Link>
          }
        >
          {conexao.configurada ? (
            <StatusPill tone={conexao.status === "connected" ? "success" : "warning"} dot pulse={conexao.status === "connected"}>
              {conexao.status === "connected" ? "WhatsApp conectado" : "WhatsApp configurado, mas não conectado"}
            </StatusPill>
          ) : (
            <p className="text-muted-foreground text-xs">WhatsApp ainda não configurado — acesse a tela de Conexão para gerar o QR Code.</p>
          )}
        </SectionCard>

        <SectionCard titulo="Ambiente" eyebrow="Sistema" descricao="Variáveis de ambiente do frontend em uso (somente leitura).">
          <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="border-border rounded-md border px-3 py-2">
              <dt className="text-subtle label-eyebrow">VITE_API_URL</dt>
              <dd className="text-foreground mt-1 font-mono break-all">
                {import.meta.env['VITE_API_URL'] || "não definida (usando padrão local)"}
              </dd>
            </div>
            <div className="border-border rounded-md border px-3 py-2">
              <dt className="text-subtle label-eyebrow">Supabase</dt>
              <dd className="text-foreground mt-1">
                {supabaseConfigurado ? "Configurado" : "Não configurado"}
              </dd>
            </div>
          </dl>
        </SectionCard>
      </div>
    </AppShell>
  );
}
