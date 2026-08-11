import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type Tone = "neutral" | "muted" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-secondary-foreground ring-border-strong",
  muted: "bg-surface-sunken text-subtle ring-border",
  brand: "bg-primary-soft text-primary-strong ring-primary/20",
  success: "bg-success/10 text-success ring-success/25",
  warning: "bg-warning/10 text-warning ring-warning/25",
  danger: "bg-destructive/10 text-destructive ring-destructive/25",
  info: "bg-info/10 text-info ring-info/25",
};

export function StatusPill({
  tone = "neutral",
  dot = false,
  pulse = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span className={cn("size-1.5 shrink-0 rounded-full bg-current", pulse && "animate-pulse")} />
      )}
      {children}
    </span>
  );
}
