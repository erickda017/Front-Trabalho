import { Moon, Sun } from "lucide-react";

import { useTema } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { tema, alternar } = useTema();
  const escuro = tema === "dark";

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={escuro ? "Ativar tema claro" : "Ativar tema escuro"}
      title={escuro ? "Tema claro" : "Tema escuro"}
      className={cn(
        "focus-ring text-muted-foreground hover:text-foreground hover:bg-surface-raised border-border grid size-9 shrink-0 place-items-center rounded-md border transition-colors",
        className,
      )}
    >
      {escuro ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}