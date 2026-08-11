import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Estado vazio padrão do sistema.
 * Usado sempre que a API ainda não devolveu dados — nunca substituímos
 * a ausência de dados por conteúdo fictício.
 */
export function EmptyState({
  icon: Icon,
  titulo,
  descricao,
  acao,
  className,
  compacto = false,
}: {
  icon?: ComponentType<{ className?: string }>;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  className?: string;
  compacto?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compacto ? "py-8" : "py-14",
        className,
      )}
    >
      {Icon && (
        <div className="bg-surface-sunken text-subtle mb-4 grid size-11 place-items-center rounded-lg">
          <Icon className="size-5" />
        </div>
      )}
      <p className="text-foreground text-sm font-semibold">{titulo}</p>
      {descricao && (
        <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-pretty">
          {descricao}
        </p>
      )}
      {acao && <div className="mt-5 flex flex-wrap justify-center gap-2">{acao}</div>}
    </div>
  );
}
