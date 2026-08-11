import { useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { isSupabaseConfigured, supabase } from "@/supabaseClient";
import { Aviso, Botao, Campo, Rotulo } from "@/components/shared/Controls";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { cn } from "@/lib/utils";

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
      {/* Coluna de identidade */}
      <aside className="bg-sidebar text-sidebar-foreground hidden w-[42%] max-w-lg flex-col justify-between p-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="bg-sidebar-primary grid size-8 place-items-center rounded-md">
            <span className="font-display text-sidebar-primary-foreground text-sm font-bold">V</span>
          </div>
          <span className="font-display text-sm font-semibold">Veloce Faturas</span>
        </div>

        <div>
          <h2 className="font-display text-3xl leading-tight font-semibold text-balance">
            Faturas, PIX e disparos de WhatsApp em um só painel.
          </h2>
          <p className="text-sidebar-foreground/60 mt-4 max-w-sm text-sm leading-relaxed text-pretty">
            Importação em massa, extração de PIX dos PDFs, duas conexões de WhatsApp com
            alternância automática e histórico completo de entrega e leitura.
          </p>
        </div>

        <p className="text-sidebar-foreground/40 flex items-center gap-2 text-xs">
          <ShieldCheck className="size-3.5" />
          Acesso restrito. Contas são criadas pelo administrador.
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
