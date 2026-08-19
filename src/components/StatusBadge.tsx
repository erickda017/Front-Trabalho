import { StatusPill, type Tone } from "@/components/shared/StatusPill";
import type { ItemStatus } from "@/lib/types";

const map: Record<ItemStatus, { label: string; tone: Tone }> = {
  pendente: { label: "Pendente", tone: "muted" },
  processando: { label: "Processando", tone: "brand" },
  enviado: { label: "Enviado", tone: "neutral" },
  entregue: { label: "Entregue", tone: "info" },
  lido: { label: "Lido", tone: "success" },
  erro: { label: "Erro", tone: "danger" },
  numero_invalido: { label: "Número inválido", tone: "warning" },
  cancelado: { label: "Cancelado", tone: "muted" },
};

export function StatusBadge({ status, className }: { status: ItemStatus; className?: string }) {
  const s = map[status] ?? map["pendente"]!;
  return (
    <StatusPill tone={s.tone} {...(className ? { className } : {})}>
      {s.label}
    </StatusPill>
  );
}
