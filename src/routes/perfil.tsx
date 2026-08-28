import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Camera, Trash2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusPill } from "@/components/shared/StatusPill";
import { Aviso, Botao } from "@/components/shared/Controls";
import { useAppState } from "@/lib/app-state";

// Tamanho máximo aceito para a foto de perfil (mesmo limite validado de novo
// no backend, ver perfil.routes.js -- aqui só evita a viagem de rede à toa).
const TAMANHO_MAX_FOTO = 2 * 1024 * 1024; // 2MB

// [2026-08] PERFIL: nome + foto agora vivem no banco (perfis.nome/avatar_path,
// ver migration-21-perfil-avatar.sql e app-state.tsx) -- antes ficavam só no
// localStorage deste navegador. `foto` guarda o File novo escolhido (ainda
// não salvo) -- a pré-visualização usa um Object URL local, revogado ao
// trocar/desmontar; só ao clicar em "Salvar perfil" o arquivo de verdade sobe.
function PerfilOperador() {
  const { perfil, atualizarPerfil } = useAppState();
  const [nome, setNome] = useState(perfil.nome);
  const [foto, setFoto] = useState<File | "remover" | null>(null);
  const [previaUrl, setPreviaUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mantém o nome do campo em dia se o perfil recarregar de fora (ex.: login).
  useEffect(() => setNome(perfil.nome), [perfil.nome]);

  useEffect(() => {
    if (!(foto instanceof File)) {
      setPreviaUrl(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setPreviaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  const fotoExibida = previaUrl ?? (foto === "remover" ? null : perfil.fotoUrl);
  const alterado = nome.trim() !== perfil.nome || foto !== null;

  function escolherFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (!arquivo) return;
    setErro(null);

    if (!arquivo.type.startsWith("image/")) {
      setErro("Escolha um arquivo de imagem (PNG, JPG, etc.).");
      return;
    }
    if (arquivo.size > TAMANHO_MAX_FOTO) {
      setErro("Imagem muito grande — escolha uma foto de até 2MB.");
      return;
    }
    setFoto(arquivo);
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await atualizarPerfil({
        nome: nome.trim(),
        ...(foto !== null ? { foto } : {}),
      });
      setFoto(null);
      toast.success("Perfil atualizado");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SectionCard
      titulo="Perfil do operador"
      eyebrow="Conta"
      descricao="Nome e foto exibidos na barra lateral -- salvos na sua conta, aparecem em qualquer navegador em que você entrar."
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            {fotoExibida ? (
              <img src={fotoExibida} alt="" className="bg-surface-sunken size-20 rounded-full object-cover" />
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
          {fotoExibida && (
            <button
              type="button"
              onClick={() => setFoto("remover")}
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

          {erro && <Aviso tone="danger">{erro}</Aviso>}

          <Botao variante="primary" tamanho="sm" onClick={salvar} disabled={!alterado || salvando}>
            {salvando ? "Salvando…" : "Salvar perfil"}
          </Botao>
        </div>
      </div>
    </SectionCard>
  );
}

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil — Voxcel Faturas" },
      {
        name: "description",
        content: "Nome, foto e conexão do WhatsApp do operador.",
      },
      { property: "og:title", content: "Perfil — Voxcel Faturas" },
      { property: "og:description", content: "Perfil do operador e status da conexão." },
    ],
  }),
  component: Perfil,
});

// [2026-08] Unificado com a ex-tela "Configurações": o card "Ambiente"
// (variáveis de ambiente do frontend) era informação de debug de
// desenvolvedor, não config de operador -- removido. "Conexão do WhatsApp"
// virou um status de uma linha em vez de card duplicando o que /conexoes já
// mostra por completo.
function Perfil() {
  const { conexao } = useAppState();

  return (
    <AppShell title="Perfil" subtitle="Sua conta e a conexão do WhatsApp">
      <div className="flex flex-col gap-6">
        <PerfilOperador />

        <div className="flex items-center gap-2 text-sm">
          {conexao.configurada ? (
            <StatusPill tone={conexao.status === "connected" ? "success" : "warning"} dot pulse={conexao.status === "connected"}>
              {conexao.status === "connected" ? "WhatsApp conectado" : "WhatsApp configurado, mas não conectado"}
            </StatusPill>
          ) : (
            <span className="text-muted-foreground text-xs">WhatsApp ainda não configurado.</span>
          )}
          <Link to="/conexoes" className="text-primary text-xs font-medium hover:underline">
            Ver conexão
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
