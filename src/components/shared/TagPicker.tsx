import { useState } from "react";
import { Tag as TagIcon } from "lucide-react";

import { api } from "@/api";
import type { Tag } from "@/lib/app-state";

/**
 * Seletor de tags de um cliente -- mostra as tags já atribuídas como pills e
 * abre um dropdown com todas as tags disponíveis (com check nas já
 * atribuídas) pra marcar/desmarcar. Extraído de routes/clientes.tsx pra
 * também ser usado na aba Chat (tag do cliente vinculado à conversa).
 */
export function TagPicker({
  cliente,
  todasTags,
  onChange,
}: {
  cliente: { id: string; tags: Tag[] };
  todasTags: Tag[];
  onChange: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const atribuidas = new Set(cliente.tags.map((t) => t.id));

  async function alternar(tag: Tag) {
    if (atribuidas.has(tag.id)) {
      await api.tags.remover_do_cliente(tag.id, cliente.id);
    } else {
      await api.tags.atribuir(tag.id, cliente.id);
    }
    onChange();
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex flex-wrap items-center gap-1.5 text-left"
      >
        {cliente.tags.length === 0 && (
          <span className="text-subtle inline-flex items-center gap-1 text-xs hover:text-foreground">
            <TagIcon className="size-3" /> Adicionar
          </span>
        )}
        {cliente.tags.map((t) => (
          <span
            key={t.id}
            className="rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-border"
            style={{ backgroundColor: `color-mix(in oklab, ${t.cor} 18%, transparent)`, color: t.cor }}
          >
            {t.nome}
          </span>
        ))}
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="panel absolute top-full left-0 z-20 mt-2 w-48 space-y-1 p-2">
            {todasTags.length === 0 && (
              <p className="text-subtle px-2 py-1 text-xs">Crie tags na aba Tags.</p>
            )}
            {todasTags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => alternar(t)}
                className="hover:bg-surface-raised flex w-full items-center justify-between rounded px-2 py-1.5 text-xs"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: t.cor }} />
                  {t.nome}
                </span>
                {atribuidas.has(t.id) && <span className="text-primary-strong">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
