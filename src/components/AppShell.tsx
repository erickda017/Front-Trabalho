import { Link, useRouterState } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cpu,
  Gauge,
  History,
  KeyRound,
  Layers,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  PanelLeft,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Tag,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { Marca } from "@/components/shared/Marca";
import { StatusPill, type Tone } from "@/components/shared/StatusPill";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// [2026-10] Menu enxuto: 5 blocos por tarefa (antes 14 itens em 4 grupos).
// "Conexão" virou o status do WhatsApp no rodapé (clicável) e "Perfil" fica só
// no menu do avatar. Rotas/URLs NÃO mudaram -- só onde cada link aparece.
// "Faturas" foi unificada em /clientes (/faturas segue como redirect).
// Backend também exige o papel em toda rota /supervisor/*; esconder o link é só UX.
const nav = [
  { to: "/", label: "Início", icon: Gauge, grupo: "" },
  { to: "/chat", label: "Conversas", icon: MessageSquare, grupo: "" },
  { to: "/clientes", label: "Clientes", icon: Users, grupo: "Carteira" },
  { to: "/qualidade", label: "Qualidade", icon: ClipboardList, grupo: "Carteira" },
  { to: "/safras", label: "Safras", icon: Layers, grupo: "Carteira" },
  { to: "/disparos", label: "Novo disparo", icon: Send, grupo: "Disparos" },
  { to: "/disparo/email", label: "Disparo / E-mail", icon: Mail, grupo: "Disparos" },
  { to: "/historico", label: "Histórico", icon: History, grupo: "Disparos" },
  { to: "/pix", label: "Extrator de PIX", icon: KeyRound, grupo: "Ferramentas" },
  { to: "/importar", label: "Importar", icon: Upload, grupo: "Ferramentas" },
  { to: "/tags", label: "Tags", icon: Tag, grupo: "Ferramentas" },
  { to: "/supervisor", label: "Supervisor", icon: ShieldCheck, grupo: "Ferramentas", supervisorOnly: true },
  // Campanha separada da cobrança (ver CONTEXTO.md, "Ativação Chip").
  { to: "/ativacao-chip", label: "Clientes do chip", icon: Cpu, grupo: "Ativação Chip" },
  { to: "/ativacao-chip/chat", label: "Conversas do chip", icon: MessageSquare, grupo: "Ativação Chip" },
] as const;

const grupos = ["", "Carteira", "Disparos", "Ferramentas", "Ativação Chip"] as const;

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
  const { conexao, isSupervisor } = useAppState();

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className={cn("flex items-center gap-2.5 px-4 py-4", collapsed && "flex-col gap-3 px-2")}>
        <Marca sobreEscuro />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-sm font-semibold">Voxcel Faturas</p>
            <p className="text-sidebar-foreground/50 truncate text-[11px]">Cobrança por WhatsApp</p>
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

      <nav className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4", collapsed && "px-2")}>
        {grupos.map((grupo) => {
          const itens = nav.filter((n) => n.grupo === grupo && (!("supervisorOnly" in n && n.supervisorOnly) || isSupervisor));
          if (!itens.length) return null;
          return (
            <div key={grupo} className="space-y-0.5">
              {grupo &&
                (collapsed ? (
                  <div className="bg-sidebar-border mx-auto my-2.5 h-px w-6" />
                ) : (
                  <p className="text-sidebar-foreground/45 px-2.5 pb-1 text-xs font-semibold">{grupo}</p>
                ))}
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
                      "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground before:bg-sidebar-primary before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] max-lg:before:-left-3 before:rounded-r"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
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
        {collapsed && (
          <Link
            to="/conexoes"
            title={`WhatsApp: ${(statusConexao[conexao.status] ?? statusConexao["disconnected"]!).label}`}
            className="hover:bg-sidebar-accent/60 relative grid h-9 place-items-center rounded-md transition-colors"
          >
            <Smartphone className="text-sidebar-foreground/70 size-4" />
            <span
              className={cn(
                "absolute top-1.5 right-3 size-2 rounded-full",
                conexao.status === "connected" ? "bg-success" : conexao.status === "disconnected" ? "bg-destructive" : "bg-warning",
              )}
            />
          </Link>
        )}
        {!collapsed && (
          <div className="space-y-1.5">
            {(() => {
              const info = statusConexao[conexao.status] ?? statusConexao["disconnected"]!;
              return (
                <Link
                  to="/conexoes"
                  onClick={onNavigate}
                  title="Abrir conexão do WhatsApp"
                  className="hover:bg-sidebar-accent/60 -m-1.5 flex items-center justify-between gap-2 rounded-md p-1.5 transition-colors"
                >
                  <span className="text-sidebar-foreground/70 flex items-center gap-1.5 truncate text-xs font-medium">
                    <Smartphone className="size-3.5" />
                    WhatsApp
                  </span>
                  {conexao.configurada ? (
                    <StatusPill
                      tone={info.tone}
                      dot
                      pulse={conexao.status === "connected"}
                      className="ring-0"
                    >
                      {info.label}
                    </StatusPill>
                  ) : (
                    <span className="text-sidebar-foreground/45 text-[11px]">configurar</span>
                  )}
                </Link>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// [2026-08] Perfil do operador -- movido do rodapé da sidebar pro canto
// superior direito do cabeçalho (ver AppShell abaixo). Só mostra nome +
// avatar (iniciais ou foto) -- o e-mail deixou de aparecer aqui de
// propósito (era exibido por padrão antes; agora só quem entra em "Editar
// perfil" vê o e-mail, na própria tela de Configurações).
function ProfileMenu() {
  const { logout, perfil, session } = useAppState();
  const nomeExibido = perfil.nome.trim() || "Operador";
  const iniciais = (perfil.nome.trim() || session?.user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Perfil"
          className="hover:bg-surface-raised flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors"
        >
          {perfil.fotoUrl ? (
            <img src={perfil.fotoUrl} alt="" className="bg-surface-raised size-7 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="bg-surface-raised text-foreground/70 grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold">
              {iniciais}
            </span>
          )}
          <span className="text-foreground/80 hidden max-w-[9rem] truncate text-[13px] font-medium sm:inline">
            {nomeExibido}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="truncate">{nomeExibido}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/perfil" className="flex items-center gap-2">
            <Settings className="size-3.5" />
            Editar perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={logout} className="text-destructive flex items-center gap-2">
          <LogOut className="size-3.5" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
              "flex w-full items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3",
              !flush && "mx-auto max-w-[88rem]",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
              <button
                onClick={() => setOpen((v) => !v)}
                aria-label="Alternar menu"
                className="text-muted-foreground hover:text-foreground hover:bg-surface-raised grid size-8 shrink-0 place-items-center rounded-md transition-colors sm:size-9 lg:hidden"
              >
                {open ? <X className="size-4" /> : <Menu className="size-4" />}
              </button>
              <div className="flex min-w-0 flex-col">
                {breadcrumb?.length ? (
                  <nav aria-label="Trilha" className="hidden min-w-0 items-center gap-1 sm:flex">
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
                {/* [layout] Título compacto -- a sidebar já destaca a aba
                    ativa; este <h1> existe principalmente pra quem está no
                    mobile (sidebar escondida atrás do hamburger). Subtítulo
                    e trilha só aparecem a partir de `sm:` pra não ocupar
                    espaço vertical extra numa tela pequena. */}
                <h1 className="font-display truncate text-sm font-semibold sm:text-lg">{title}</h1>
                {subtitle && !breadcrumb?.length && (
                  <p className="text-subtle hidden truncate text-xs sm:block">{subtitle}</p>
                )}
              </div>
            </div>
            <div className="toolbar shrink-0">
              {actions}
              <ThemeToggle />
              <ProfileMenu />
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
