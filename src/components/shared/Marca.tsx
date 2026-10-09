import { cn } from "@/lib/utils";

/** Marca do sistema (fatura com visto). `sobreEscuro`: usa as cores da sidebar/painel escuro. */
export function Marca({ className, sobreEscuro = false }: { className?: string; sobreEscuro?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="7" className={sobreEscuro ? "fill-sidebar-primary" : "fill-primary"} />
      <g
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={sobreEscuro ? "stroke-sidebar-primary-foreground" : "stroke-primary-foreground"}
      >
        <path d="M9 10.5h14M9 16h14M9 21.5h8" />
        <path d="M20 19.5l2.5 2.5 4-4.5" />
      </g>
    </svg>
  );
}
