import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Ícone "?" que mostra um texto explicativo só ao passar o mouse (ou focar,
 * via teclado) -- usado no lugar de parágrafos de explicação sempre visíveis,
 * pra manter a tela limpa. Ver SectionCard, que usa isso pra `descricao`.
 */
export function HelpTooltip({ texto, className }: { texto: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Ajuda"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "text-muted-foreground hover:text-foreground focus-ring inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle",
            className,
          )}
        >
          <HelpCircle className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">{texto}</TooltipContent>
    </Tooltip>
  );
}
