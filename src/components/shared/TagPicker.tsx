import { Tag as TagIcon } from "lucide-react";

import { api } from "@/api";
import type { Tag } from "@/lib/app-state";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Seletor de tags de um cliente -- mostra as tags já atribuídas como pills e
 * abre um menu com todas as tags disponíveis (com check nas já atribuídas)
 * pra marcar/desmarcar. Extraído de routes/clientes.tsx pra também ser usado
 * na aba Chat (tag do cliente vinculado à conversa).
 *
 * [2026-08] Reescrito em cima do DropdownMenu (Radix, renderiza num Portal)
 * -- a versão anterior usava um painel `position: absolute` dentro da
 * própria célula da tabela. Quando a busca de Clientes filtrava pra um único
 * resultado, a tabela ficava baixa (só cabeçalho + 1 linha) e o wrapper
 * `overflow-x-auto` da tabela vira automaticamente um clipping container no
 * eixo Y também (regra do spec de CSS: overflow-x diferente de `visible` com
 * overflow-y `visible` força o Y pra `auto`) -- o painel, que abria alto o
 * bastante pra ultrapassar essa única linha, ficava cortado/invisível assim
 * que abria. Com poucas linhas na tela isso não acontecia porque a tabela
 * tinha altura de sobra abaixo do botão clicado. Um menu portalado escapa
 * desse clipping (some fora da árvore DOM da tabela) e resolve pra qualquer
 * quantidade de linhas.
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
        {todasTags.length === 0 ? (
          <DropdownMenuLabel className="text-subtle font-normal">Crie tags na aba Tags.</DropdownMenuLabel>
        ) : (
          todasTags.map((t) => (
            <DropdownMenuCheckboxItem
              key={t.id}
              checked={atribuidas.has(t.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => alternar(t)}
            >
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ backgroundColor: t.cor }} />
                {t.nome}
              </span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
