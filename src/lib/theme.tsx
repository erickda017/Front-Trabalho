import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Tema = "light" | "dark";

export const TEMA_KEY = "ui:theme";

/** Script inline aplicado antes da hidratação para evitar flash de tema errado. */
export const temaBootstrapScript = `(function(){try{var t=localStorage.getItem('${TEMA_KEY}');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

const TemaContext = createContext<{ tema: Tema; alternar: () => void } | null>(null);

export function TemaProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>("light");

  useEffect(() => {
    const salvo = window.localStorage.getItem(TEMA_KEY) as Tema | null;
    const inicial: Tema =
      salvo ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTema(inicial);
    document.documentElement.classList.toggle("dark", inicial === "dark");
  }, []);

  const alternar = useCallback(() => {
    setTema((atual) => {
      const proximo: Tema = atual === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", proximo === "dark");
      try {
        window.localStorage.setItem(TEMA_KEY, proximo);
      } catch {
        /* storage indisponível */
      }
      return proximo;
    });
  }, []);

  const valor = useMemo(() => ({ tema, alternar }), [tema, alternar]);

  return <TemaContext.Provider value={valor}>{children}</TemaContext.Provider>;
}

export function useTema() {
  const ctx = useContext(TemaContext);
  if (!ctx) throw new Error("useTema deve ser usado dentro de <TemaProvider>");
  return ctx;
}