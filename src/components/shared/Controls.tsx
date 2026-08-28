import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Botões                                                                     */
/* -------------------------------------------------------------------------- */

type Variante = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Tamanho = "sm" | "md";

const variantes: Record<Variante, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-strong disabled:hover:bg-primary shadow-panel",
  secondary:
    "bg-surface text-foreground border border-border-strong hover:bg-surface-raised shadow-panel",
  outline: "border border-border-strong text-foreground hover:bg-surface-raised",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-surface-raised",
  danger: "border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground",
};

const tamanhos: Record<Tamanho, string> = {
  sm: "h-8 gap-1.5 rounded-md px-2.5 text-xs",
  md: "h-9 gap-2 rounded-md px-3.5 text-sm",
};

export function Botao({
  variante = "secondary",
  tamanho = "md",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tamanho?: Tamanho }) {
  return (
    <button
      {...props}
      className={cn(
        "focus-ring inline-flex shrink-0 items-center justify-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variantes[variante],
        tamanhos[tamanho],
        className,
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Campos                                                                     */
/* -------------------------------------------------------------------------- */

export function Campo({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "focus-ring bg-surface text-foreground border-border placeholder:text-subtle h-9 w-full rounded-md border px-3 text-sm",
        className,
      )}
    />
  );
}

export function Seletor({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "focus-ring bg-surface text-foreground border-border h-9 w-full rounded-md border px-2.5 text-sm",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Busca({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative min-w-0 flex-1 sm:max-w-xs", className)}>
      <Search className="text-subtle pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <Campo type="search" {...props} className="pl-8" />
    </div>
  );
}

export function Rotulo({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn("label-eyebrow mb-1.5 block", className)}>{children}</label>;
}

/* -------------------------------------------------------------------------- */
/* Filtros em pílula                                                          */
/* -------------------------------------------------------------------------- */

export function FiltroChips<T extends string>({
  valor,
  opcoes,
  onChange,
  className,
}: {
  valor: T;
  opcoes: readonly { valor: T; label: string; contagem?: number | null }[];
  onChange: (valor: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "bg-surface-sunken border-border flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-md border p-0.5",
        className,
      )}
    >
      {opcoes.map((o) => (
        <button
          key={o.valor}
          role="tab"
          aria-selected={valor === o.valor}
          onClick={() => onChange(o.valor)}
          className={cn(
            "focus-ring shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-colors",
            valor === o.valor
              ? "bg-surface text-foreground shadow-panel"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
          {typeof o.contagem === "number" && (
            <span className="text-subtle ml-1.5 tabular-nums">{o.contagem}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Avisos                                                                     */
/* -------------------------------------------------------------------------- */

export function Aviso({
  tone = "danger",
  children,
  className,
}: {
  tone?: "danger" | "warning" | "info";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    danger: "bg-destructive/8 text-destructive ring-destructive/20",
    warning: "bg-warning/10 text-warning ring-warning/20",
    info: "bg-info/8 text-info ring-info/20",
  } as const;
  return (
    <div
      role="status"
      className={cn("rounded-md px-3 py-2 text-xs ring-1 ring-inset", tones[tone], className)}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabelas                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Container de tabela.
 *
 * Por padrão tem scroll horizontal em telas estreitas (min-w-[46rem] força o
 * scroll quando não cabe tudo). Em espaços mais apertados (ex: SectionCard
 * mais estreito, painel lateral do histórico) isso fazia colunas inteiras
 * "fugirem" pra fora da área visível, dependendo do usuário arrastar a
 * barrinha horizontal pra ver o resto.
 *
 * `compact`: usa table-fixed + largura 100% do container (sem min-width nem
 * overflow-x), então as colunas sempre cabem no espaço disponível -- células
 * fazem truncate/wrap em vez de estourar a largura. Use em tabelas dentro de
 * containers estreitos (sidebars, cards menores).
 */
export function TabelaWrap({
  children,
  className,
  compact = false,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("min-w-0", compact ? "overflow-hidden" : "overflow-x-auto", className)}>
      <table
        className={cn(
          "w-full border-collapse text-left",
          compact ? "table-fixed" : "min-w-[46rem]",
        )}
      >
        {children}
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Paginação                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Paginação client-side (a lista completa já está em memória -- fatia só na
 * exibição). Usada em listas grandes (Clientes, Extrações de PIX) pra não
 * renderizar centenas/milhares de linhas de uma vez.
 */
export function Paginacao({
  paginaAtual,
  totalPaginas,
  totalItens,
  tamanhoPagina,
  onMudarPagina,
  className,
}: {
  paginaAtual: number;
  totalPaginas: number;
  totalItens: number;
  tamanhoPagina: number;
  onMudarPagina: (pagina: number) => void;
  className?: string;
}) {
  if (totalPaginas <= 1) return null;

  const inicio = (paginaAtual - 1) * tamanhoPagina + 1;
  const fim = Math.min(paginaAtual * tamanhoPagina, totalItens);

  return (
    <div
      className={cn(
        "border-border bg-surface-raised/40 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3",
        className,
      )}
    >
      <p className="text-subtle text-xs">
        Mostrando <span className="text-foreground font-medium tabular-nums">{inicio}–{fim}</span> de{" "}
        <span className="text-foreground font-medium tabular-nums">{totalItens}</span>
      </p>
      <div className="flex items-center gap-2">
        <Botao
          variante="outline"
          tamanho="sm"
          onClick={() => onMudarPagina(paginaAtual - 1)}
          disabled={paginaAtual <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-3.5" />
          Anterior
        </Botao>
        <span className="text-subtle px-1 text-xs tabular-nums">
          Página {paginaAtual} de {totalPaginas}
        </span>
        <Botao
          variante="outline"
          tamanho="sm"
          onClick={() => onMudarPagina(paginaAtual + 1)}
          disabled={paginaAtual >= totalPaginas}
          aria-label="Próxima página"
        >
          Próxima
          <ChevronRight className="size-3.5" />
        </Botao>
      </div>
    </div>
  );
}

export function LinhasEsqueleto({ colunas, linhas = 5 }: { colunas: number; linhas?: number }) {
  return (
    <>
      {Array.from({ length: linhas }).map((_, i) => (
        <tr key={i} className="border-border border-t">
          {Array.from({ length: colunas }).map((__, j) => (
            <td key={j} className="td-cell">
              <div className="bg-surface-sunken h-3.5 animate-pulse rounded" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
