import { Link, useRouterState } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Gauge,
  History,
  KeyRound,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeft,
  Send,
  Settings,
  Smartphone,
  Tag,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { StatusPill, type Tone } from "@/components/shared/StatusPill";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

const nav = [
  { to: "/", label: "Dashboard", icon: Gauge, grupo: "Operação" },
  { to: "/disparos", label: "Disparos", icon: Send, grupo: "Operação" },
  { to: "/historico", label: "Histórico", icon: History, grupo: "Operação" },
  { to: "/chat", label: "Chat", icon: MessageSquare, grupo: "Operação" },
  { to: "/clientes", label: "Clientes", icon: Users, grupo: "Gestão" },
  { to: "/faturas", label: "Faturas", icon: FileText, grupo: "Gestão" },
  { to: "/pix", label: "Extrator de PIX", icon: KeyRound, grupo: "Gestão" },
  { to: "/importar", label: "Importar", icon: Upload, grupo: "Gestão" },
  { to: "/tags", label: "Tags", icon: Tag, grupo: "Gestão" },
  { to: "/conexoes", label: "Conexões", icon: Smartphone, grupo: "Sistema" },
  { to: "/configuracoes", label: "Configurações", icon: Settings, grupo: "Sistema" },
] as const;

const grupos = ["Operação", "Gestão", "Sistema"] as const;

export const statusConexao: Record<string, { label: string; tone: Tone }> = {
  connected: { label: "Conectado", tone: "success" },
  qr: { label: "Aguardando QR", tone: "warning" },
  connecting: { label: "Conectando", tone: "warning" },
  disconnected: { label: "Desconectado", tone: "danger" },
};

const COLLAPSE_KEY = "ui:sidebarCollapsed";

function SidebarContent({
  collapsed,
  onNavigate,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { conexoes, logout, session } = useAppState();

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className={cn("flex items-center gap-2.5 px-4 py-4", collapsed && "flex-col gap-3 px-2")}>
        <div className="bg-sidebar-primary grid size-8 shrink-0 place-items-center rounded-md">
          <span className="font-display text-sidebar-primary-foreground text-sm font-bold">V</span>
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-sm font-semibold">Veloce Faturas</p>
            <p className="text-sidebar-foreground/50 truncate text-[11px]">Painel operacional</p>
          </div>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent hidden size-7 shrink-0 place-items-center rounded-md transition-colors lg:grid"
          >
            {collapsed ? <PanelLeft className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        )}
      </div>

      <nav className={cn("min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4", collapsed && "px-2")}>
        {grupos.map((grupo) => {
          const itens = nav.filter((n) => n.grupo === grupo);
          if (!itens.length) return null;
          return (
            <div key={grupo} className="space-y-0.5">
              {collapsed ? (
                <div className="bg-sidebar-border mx-auto my-2.5 h-px w-6" />
              ) : (
                <p className="text-sidebar-foreground/40 px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
                  {grupo}
                </p>
              )}
              {itens.map((item) => {
                const active = pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
                    )}
                  >
                    <item.icon
                      className={cn("size-4 shrink-0", active && "text-sidebar-primary")}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className={cn("border-sidebar-border mt-auto border-t p-3", collapsed && "p-2")}>
        {!collapsed && (
          <div className="mb-2.5 space-y-1.5">
            {conexoes.map((c) => {
              const info = statusConexao[c.status] ?? statusConexao["disconnected"]!;
              return (
                <div key={c.slot} className="flex items-center justify-between gap-2">
                  <span className="text-sidebar-foreground/55 truncate text-[11px] font-medium">
                    WhatsApp {c.slot}
                  </span>
                  {c.configurada ? (
                    <StatusPill
                      tone={info.tone}
                      dot
                      pulse={c.status === "connected"}
                      className="ring-0"
                    >
                      {info.label}
                    </StatusPill>
                  ) : (
                    <span className="text-sidebar-foreground/35 text-[11px]">não configurado</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div
          className={cn(
            "flex items-center gap-2",
            collapsed ? "flex-col" : "justify-between",
          )}
        >
          {!collapsed && (
            <span className="text-sidebar-foreground/45 min-w-0 truncate text-[11px]">
              {session?.user?.email ?? "—"}
            </span>
          )}
          <button
            onClick={logout}
            aria-label="Sair"
            title="Sair"
            className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent grid size-7 shrink-0 place-items-center rounded-md transition-colors"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  title,
  subtitle,
  breadcrumb,
  actions,
  children,
  /** Layout de altura fixa (viewport), sem padding e sem scroll na página — usado pelo Chat. */
  flush = false,
}: {
  title: string;
  subtitle?: string;
  breadcrumb?: { label: string; to?: string }[];
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return (
    <div
      className={cn("flex w-full", flush ? "h-screen overflow-hidden" : "min-h-screen")}
      style={{ "--sidebar-w": collapsed ? "4rem" : "15rem" } as React.CSSProperties}
    >
      <aside
        className="border-sidebar-border fixed inset-y-0 left-0 z-30 hidden border-r transition-[width] duration-200 lg:block"
        style={{ width: "var(--sidebar-w)" }}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      {open && (
        <>
          <button
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
            className="bg-foreground/25 fixed inset-0 z-30 backdrop-blur-[1px] lg:hidden"
          />
          <aside className="border-sidebar-border fixed inset-y-0 left-0 z-40 w-64 border-r lg:hidden">
            <SidebarContent collapsed={false} onNavigate={() => setOpen(false)} />
          </aside>
        </>
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-200 lg:pl-[var(--sidebar-w)]",
          flush && "h-screen overflow-hidden",
        )}
      >
        <header className="border-border bg-background/85 sticky top-0 z-20 shrink-0 border-b backdrop-blur-md">
          <div
            className={cn(
              "flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6",
              !flush && "mx-auto max-w-[88rem]",
            )}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                onClick={() => setOpen((v) => !v)}
                aria-label="Alternar menu"
                className="text-muted-foreground hover:text-foreground hover:bg-surface-raised grid size-9 shrink-0 place-items-center rounded-md transition-colors lg:hidden"
              >
                {open ? <X className="size-4" /> : <Menu className="size-4" />}
              </button>
              <div className="flex min-w-0 flex-col">
                {breadcrumb?.length ? (
                  <nav aria-label="Trilha" className="flex min-w-0 items-center gap-1">
                    {breadcrumb.map((b, i) => (
                      <span key={i} className="flex min-w-0 items-center gap-1">
                        {i > 0 && <ChevronRight className="text-subtle size-3 shrink-0" />}
                        {b.to ? (
                          <Link
                            to={b.to}
                            className="text-subtle hover:text-foreground truncate text-[11px] font-medium transition-colors"
                          >
                            {b.label}
                          </Link>
                        ) : (
                          <span className="text-subtle truncate text-[11px] font-medium">
                            {b.label}
                          </span>
                        )}
                      </span>
                    ))}
                  </nav>
                ) : null}
                <h1 className="font-display truncate text-base font-semibold sm:text-lg">{title}</h1>
                {subtitle && !breadcrumb?.length && (
                  <p className="text-subtle truncate text-xs">{subtitle}</p>
                )}
              </div>
            </div>
            <div className="toolbar shrink-0">
              {actions}
              <ThemeToggle />
            </div>
          </div>
        </header>

        {flush ? (
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        ) : (
          <main className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        )}
      </div>
    </div>
  );
}
