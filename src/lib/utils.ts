import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatador de moeda BRL compartilhado -- estava duplicado (mesma
 *  instância idêntica) em clientes.tsx, index.tsx, safras.tsx e
 *  supervisor.tsx. */
export const formatoMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
