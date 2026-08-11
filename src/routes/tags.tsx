import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Pencil, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Aviso, Botao, Campo, Rotulo } from "@/components/shared/Controls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/api";
import type { Tag } from "@/lib/app-state";

export const Route = createFileRoute("/tags")({
  head: () => ({
    meta: [
      { title: "Tags — Veloce Faturas" },
      { name: "description", content: "Crie e organize tags para segmentar clientes." },
      { property: "og:title", content: "Tags — Veloce Faturas" },
      { property: "og:description", content: "Crie, renomeie e exclua tags usadas para segmentar clientes." },
    ],
  }),
  component: Tags,
});

/** Paleta restrita aos tokens semânticos do design system. */
const CORES = [
  { valor: "var(--color-primary)", nome: "Primária" },
  { valor: "var(--color-success)", nome: "Sucesso" },
  { valor: "var(--color-warning)", nome: "Aviso" },
  { valor: "var(--color-destructive)", nome: "Destrutiva" },
  { valor: "var(--color-info)", nome: "Info" },
  { valor: "var(--color-muted-foreground)", nome: "Neutra" },
] as const;

type TagComContagem = Tag & { clientes_count?: number | null };

function Tags() {
  const [tags, setTags] = useState<TagComContagem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);

  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<TagComContagem | null>(null);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState<string>(CORES[0].valor);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const [excluindo, setExcluindo] = useState<TagComContagem | null>(null);
  const [removendo, setRemovendo] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const data = await api.tags.listar();
      setTags(Array.isArray(data) ? data : []);
      setErroLista(null);
    } catch (e) {
      setErroLista((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  function abrirCriacao() {
    setEditando(null);
    setNome("");
    setCor(CORES[0].valor);
    setErroForm(null);
    setDialogAberto(true);
  }

  function abrirEdicao(tag: TagComContagem) {
    setEditando(tag);
    setNome(tag.nome);
    setCor(tag.cor || CORES[0].valor);
    setErroForm(null);
    setDialogAberto(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSalvando(true);
    setErroForm(null);
    try {
      if (editando) {
        await api.tags.atualizar(editando.id, { nome, cor });
      } else {
        await api.tags.criar({ nome, cor });
      }
      setDialogAberto(false);
      await carregar();
    } catch (err) {
      setErroForm((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setRemovendo(true);
    try {
      await api.tags.remover(excluindo.id);
      setExcluindo(null);
      await carregar();
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <AppShell
      title="Tags"
      subtitle="Crie tags para segmentar e filtrar clientes"
      actions={
        <Botao variante="primary" onClick={abrirCriacao}>
          <Plus className="size-4" />
          Nova tag
        </Botao>
      }
    >
      <SectionCard titulo="Tags cadastradas" descricao="Atribuição de tags aos clientes é feita na tela Clientes.">
        {erroLista ? (
          <Aviso tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{erroLista}</span>
              <Botao tamanho="sm" variante="outline" onClick={carregar}>
                Tentar novamente
              </Botao>
            </div>
          </Aviso>
        ) : carregando ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface-sunken h-20 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : tags.length === 0 ? (
          <EmptyState
            icon={TagIcon}
            titulo="Nenhuma tag criada ainda."
            descricao="Crie a primeira tag para começar a segmentar seus clientes."
            acao={
              <Botao variante="primary" onClick={abrirCriacao}>
                <Plus className="size-4" />
                Nova tag
              </Botao>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tags.map((t) => (
              <div
                key={t.id}
                className="border-border bg-surface flex items-start justify-between gap-3 rounded-lg border p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="mt-0.5 size-3.5 shrink-0 rounded-full"
                    style={{ backgroundColor: t.cor }}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.nome}</p>
                    <p className="text-subtle mt-0.5 text-xs">
                      {typeof t.clientes_count === "number"
                        ? `${t.clientes_count} cliente(s)`
                        : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => abrirEdicao(t)}
                    aria-label="Editar tag"
                    className="focus-ring text-subtle hover:text-foreground grid size-7 place-items-center rounded"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => setExcluindo(t)}
                    aria-label="Excluir tag"
                    className="focus-ring text-subtle hover:text-destructive grid size-7 place-items-center rounded"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? "Editar tag" : "Nova tag"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Rotulo>Nome</Rotulo>
              <Campo
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: VIP, Inadimplente, Renegociado"
                autoFocus
              />
            </div>
            <div>
              <Rotulo>Cor</Rotulo>
              <div className="flex flex-wrap gap-2">
                {CORES.map((c) => (
                  <button
                    key={c.valor}
                    type="button"
                    onClick={() => setCor(c.valor)}
                    style={{ backgroundColor: c.valor }}
                    className={`focus-ring size-8 rounded-full ring-2 ring-offset-2 ring-offset-background transition-transform ${
                      cor === c.valor ? "ring-ring scale-110" : "ring-transparent"
                    }`}
                    aria-label={c.nome}
                    title={c.nome}
                  />
                ))}
              </div>
            </div>
            {erroForm && <Aviso tone="danger">{erroForm}</Aviso>}
            <DialogFooter>
              <Botao type="button" variante="outline" onClick={() => setDialogAberto(false)}>
                Cancelar
              </Botao>
              <Botao type="submit" variante="primary" disabled={salvando || !nome.trim()}>
                {salvando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {editando ? "Salvar" : "Criar tag"}
              </Botao>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!excluindo} onOpenChange={(open) => !open && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tag "{excluindo?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              A tag será removida de todos os clientes que a possuem. Essa ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removendo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmarExclusao();
              }}
              disabled={removendo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removendo ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
