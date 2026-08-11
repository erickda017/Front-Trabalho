import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * Cartão de indicador. `valor === null` significa "sem dado da API ainda"
 * e renderiza um traço — nunca um número inventado.
 */
export function MetricCard({
  label,
  valor,
  carregando = false,
  icon: Icon,
  hint,
  destaque = false,
  className,
}: {
  label: string;
  valor: number | string | null | undefined;
  carregando?: boolean;
  icon?: ComponentType<{ className?: string }>;
  hint?: string;
  destaque?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "panel flex min-w-0 flex-col gap-2 p-4",
        destaque && "border-primary/25 bg-primary-soft/40",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="label-eyebrow truncate">{label}</p>
        {Icon && <Icon className={cn("size-4 shrink-0", destaque ? "text-primary" : "text-subtle")} />}
      </div>
      {carregando ? (
        <div className="bg-surface-sunken h-7 w-16 animate-pulse rounded" />
      ) : (
        <p
          className={cn(
            "metric-value truncate",
            valor === null || valor === undefined ? "text-subtle" : destaque && "text-primary-strong",
          )}
        >
          {valor === null || valor === undefined ? "—" : valor}
        </p>
      )}
      {hint && <p className="text-subtle truncate text-[11px]">{hint}</p>}
    </div>
  );
}
