import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { HelpTooltip } from "@/components/shared/HelpTooltip";

/** Painel com cabeçalho opcional — bloco estrutural padrão das telas. */
export function SectionCard({
  titulo,
  descricao,
  eyebrow,
  acoes,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  eyebrow?: string;
  acoes?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Remove o padding do corpo (para tabelas que ocupam a largura total). */
  flush?: boolean;
}) {
  return (
    <section className={cn("panel flex min-w-0 flex-col", className)}>
      {(titulo || acoes || eyebrow) && (
        <header className="border-border flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {eyebrow && <p className="label-eyebrow mb-1">{eyebrow}</p>}
            {(titulo || descricao) && (
              <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold">
                {titulo}
                {descricao && <HelpTooltip texto={descricao} />}
              </h2>
            )}
          </div>
          {acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
        </header>
      )}
      <div className={cn("min-w-0 flex-1", !flush && "p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
