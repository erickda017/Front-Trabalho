import { useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { isSupabaseConfigured, supabase } from "@/supabaseClient";
import { Aviso, Botao, Campo, Rotulo } from "@/components/shared/Controls";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { cn } from "@/lib/utils";

// Feed decorativo do painel de identidade -- um extrato de disparos "ao
// vivo", no mono da marca (IBM Plex Mono), porque é literalmente o que o
// produto faz: manda fatura, confirma leitura. Dado fictício, só textura.
const EXTRATO_DEMO = [
  { hora: "08:14", nome: "M. TAVARES", valor: "R$ 214,90", status: "lido" as const },
  { hora: "08:15", nome: "R. ALMEIDA", valor: "R$ 189,00", status: "entregue" as const },
  { hora: "08:15", nome: "J. P. SOUZA", valor: "R$ 340,50", status: "lido" as const },
  { hora: "08:17", nome: "C. FERREIRA", valor: "R$ 97,30", status: "enviado" as const },
];

const STATUS_MARCA: Record<(typeof EXTRATO_DEMO)[number]["status"], string> = {
  enviado: "✓",
  entregue: "✓✓",
  lido: "✓✓",
};

export function LoginScreen() {
  const [modo, setModo] = useState<"entrar" | "cadastrar">("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoCadastro, setAvisoCadastro] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    setAvisoCadastro(null);

    if (modo === "entrar") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error)
        setErro(
          error.message === "Invalid login credentials" ? "E-mail ou senha inválidos." : error.message,
        );
    } else {
      if (senha.length < 6) {
        setErro("A senha precisa ter pelo menos 6 caracteres.");
        setCarregando(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({ email, password: senha });
      if (error) {
        setErro(error.message);
      } else if (data.session) {
        // Confirmação de e-mail desativada no projeto -- já entra direto.
      } else {
        setAvisoCadastro("Conta criada. Confirme o e-mail antes de entrar.");
        setModo("entrar");
      }
    }
    setCarregando(false);
  }

  return (
    <div className="bg-background relative flex min-h-screen">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      {/* Coluna de identidade -- canhoto de recibo: extrato mono "ao vivo"
          dos disparos (entregue/lido), separado do formulário por uma borda
          picotada, como o corte entre a via do cliente e o canhoto. */}
      <aside className="bg-sidebar text-sidebar-foreground perforated-edge relative hidden w-[42%] max-w-lg flex-col justify-between p-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="bg-sidebar-primary grid size-8 place-items-center rounded-md">
            <span className="font-display text-sidebar-primary-foreground text-sm font-bold">V</span>
          </div>
          <span className="font-display text-sm font-semibold">Veloce Faturas</span>
        </div>

        <div>
          <p className="text-sidebar-primary/70 font-mono text-[11px] tracking-[0.2em] uppercase">
            Extrato de disparo
          </p>
          <h2 className="font-display mt-2 text-3xl leading-tight font-semibold text-balance">
            Fatura mandada. Leitura confirmada.
          </h2>
          <p className="text-sidebar-foreground/55 mt-3 max-w-sm text-sm leading-relaxed text-pretty">
            Importação em massa, extração de PIX direto do PDF e disparo por WhatsApp com
            confirmação de entrega e leitura, cliente por cliente.
          </p>

          <dl className="border-sidebar-border/60 mt-6 space-y-0 divide-y divide-dashed rounded-md border border-dashed">
            {EXTRATO_DEMO.map((linha, i) => (
              <div
                key={linha.nome}
                className="ledger-row flex items-center justify-between gap-3 px-3 py-2 font-mono text-xs"
                style={{ animationDelay: `${300 + i * 220}ms` }}
              >
                <span className="text-sidebar-foreground/40 shrink-0">{linha.hora}</span>
                <span className="text-sidebar-foreground/85 min-w-0 flex-1 truncate">{linha.nome}</span>
                <span className="text-sidebar-foreground/60 shrink-0">{linha.valor}</span>
                <span
                  className={cn(
                    "shrink-0",
                    linha.status === "lido" ? "text-sidebar-primary" : "text-sidebar-foreground/40",
                  )}
                >
                  {STATUS_MARCA[linha.status]}
                </span>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-sidebar-foreground/40 flex items-center gap-2 font-mono text-[11px] tracking-wide uppercase">
          <ShieldCheck className="size-3.5" />
          Acesso restrito · contas criadas pelo administrador
        </p>
      </aside>

      {/* Formulário */}
      <div className="flex min-w-0 flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="bg-primary grid size-8 place-items-center rounded-md">
              <span className="font-display text-primary-foreground text-sm font-bold">V</span>
            </div>
            <span className="font-display text-sm font-semibold">Veloce Faturas</span>
          </div>

          <h1 className="font-display text-xl font-semibold">
            {modo === "entrar" ? "Entrar no painel" : "Criar conta"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {modo === "entrar"
              ? "Use as credenciais cadastradas para continuar."
              : "Defina e-mail e senha de acesso."}
          </p>

          <div className="bg-surface-sunken border-border mt-6 mb-5 grid grid-cols-2 gap-0.5 rounded-md border p-0.5 text-sm font-medium">
            {(["entrar", "cadastrar"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setModo(m);
                  setErro(null);
                }}
                className={cn(
                  "focus-ring rounded px-3 py-1.5 transition-colors",
                  modo === m
                    ? "bg-surface text-foreground shadow-panel"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "entrar" ? "Entrar" : "Criar conta"}
              </button>
            ))}
          </div>

          {!isSupabaseConfigured && (
            <Aviso tone="warning" className="mb-4">
              Autenticação indisponível: defina <code>VITE_SUPABASE_URL</code> e{" "}
              <code>VITE_SUPABASE_ANON_KEY</code> no ambiente do frontend.
            </Aviso>
          )}

          {avisoCadastro && (
            <Aviso tone="info" className="mb-4">
              {avisoCadastro}
            </Aviso>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Rotulo>E-mail</Rotulo>
              <Campo
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Rotulo>Senha</Rotulo>
              <Campo
                type="password"
                required
                autoComplete={modo === "entrar" ? "current-password" : "new-password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
              {modo === "cadastrar" && (
                <p className="text-subtle mt-1.5 text-xs">Mínimo de 6 caracteres.</p>
              )}
            </div>

            {erro && <Aviso>{erro}</Aviso>}

            <Botao
              type="submit"
              variante="primary"
              disabled={carregando || !isSupabaseConfigured}
              className="w-full"
            >
              {carregando && <Loader2 className="size-4 animate-spin" />}
              {modo === "entrar" ? "Entrar" : "Criar conta"}
            </Botao>
          </form>
        </div>
      </div>
    </div>
  );
}
