import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";

import { isSupabaseConfigured, supabase } from "@/supabaseClient";
import { api } from "@/api";
import type {
  Cliente,
  EstrategiaConfig,
  Tag,
  WhatsappConexao,
  WhatsappSlot,
  WhatsappStatus,
} from "@/lib/types";

export type { Cliente, Tag, WhatsappConexao, WhatsappStatus } from "@/lib/types";

const SLOTS: WhatsappSlot[] = [1, 2];

/** Conexão "vazia" (não configurada) — placeholder de UI, não dado fictício. */
function conexaoVazia(slot: WhatsappSlot): WhatsappConexao {
  return {
    slot,
    configurada: false,
    status: "disconnected",
    qr: null,
    telefone: null,
    nome: null,
    ultima_conexao: null,
    mensagens_enviadas: null,
  };
}

type AppStateValue = {
  session: Session | null | undefined; // undefined = carregando
  supabaseConfigurado: boolean;
  logout: () => void;

  /** Melhor status entre as conexões (usado por badges globais). */
  whatsappStatus: WhatsappStatus;
  whatsappQr: string | null;
  conexoes: WhatsappConexao[];
  conexoesCarregando: boolean;
  conexoesErro: string | null;
  refreshConexoes: () => Promise<void>;

  estrategia: EstrategiaConfig | null;
  estrategiaCarregando: boolean;
  refreshEstrategia: () => Promise<void>;

  clientes: Cliente[];
  clientesCarregando: boolean;
  clientesErro: string | null;
  refreshClientes: () => Promise<void>;

  selecionados: string[];
  toggleSelecionado: (id: string) => void;
  setSelecionados: (ids: string[]) => void;
  limparSelecionados: () => void;

  envioAtivoId: string | null;
  setEnvioAtivoId: (id: string | null) => void;
};

const AppStateContext = createContext<AppStateValue | null>(null);

const ENVIO_ATIVO_KEY = "disparo:envioAtivoId";

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [conexoes, setConexoes] = useState<WhatsappConexao[]>(() => SLOTS.map(conexaoVazia));
  const [conexoesCarregando, setConexoesCarregando] = useState(true);
  const [conexoesErro, setConexoesErro] = useState<string | null>(null);
  const [estrategia, setEstrategia] = useState<EstrategiaConfig | null>(null);
  const [estrategiaCarregando, setEstrategiaCarregando] = useState(true);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clientesCarregando, setClientesCarregando] = useState(false);
  const [clientesErro, setClientesErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [envioAtivoId, setEnvioAtivoIdState] = useState<string | null>(null);

  useEffect(() => {
    setEnvioAtivoIdState(window.sessionStorage.getItem(ENVIO_ATIVO_KEY));
  }, []);

  const setEnvioAtivoId = useCallback((id: string | null) => {
    setEnvioAtivoIdState(id);
    if (typeof window === "undefined") return;
    if (id) window.sessionStorage.setItem(ENVIO_ATIVO_KEY, id);
    else window.sessionStorage.removeItem(ENVIO_ATIVO_KEY);
  }, []);

  // Sessão Supabase
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(null);
      return;
    }
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event: string, s: Session | null) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const logout = useCallback(() => {
    supabase.auth.signOut();
  }, []);

  const refreshConexoes = useCallback(async () => {
    try {
      const data = await api.whatsapp.conexoes();
      const lista = SLOTS.map(
        (slot) => data?.find?.((c) => Number(c.slot) === slot) ?? conexaoVazia(slot),
      );
      setConexoes(lista);
      setConexoesErro(null);
    } catch (e) {
      setConexoes(SLOTS.map(conexaoVazia));
      setConexoesErro((e as Error).message);
    } finally {
      setConexoesCarregando(false);
    }
  }, []);

  // Polling das conexões -- no nível raiz (não dentro da tela Conexões) para que o
  // badge e a permissão de disparo não "congelem" enquanto o usuário navega.
  useEffect(() => {
    if (!session) return;
    let cancelado = false;
    async function verificar() {
      if (cancelado) return;
      await refreshConexoes();
    }
    verificar();
    const interval = setInterval(verificar, 3000);
    return () => {
      cancelado = true;
      clearInterval(interval);
    };
  }, [session, refreshConexoes]);

  const refreshEstrategia = useCallback(async () => {
    try {
      const data = await api.estrategia.buscar();
      setEstrategia(data);
    } catch {
      setEstrategia(null);
    } finally {
      setEstrategiaCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (session) refreshEstrategia();
  }, [session, refreshEstrategia]);

  const refreshClientes = useCallback(async () => {
    setClientesCarregando(true);
    try {
      const data = await api.clientes.listar();
      setClientes(Array.isArray(data) ? data : []);
      setClientesErro(null);
    } catch (e) {
      setClientes([]);
      setClientesErro((e as Error).message);
    } finally {
      setClientesCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (session) refreshClientes();
  }, [session, refreshClientes]);

  const toggleSelecionado = useCallback((id: string) => {
    setSelecionados((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }, []);

  const limparSelecionados = useCallback(() => setSelecionados([]), []);

  const { whatsappStatus, whatsappQr } = useMemo(() => {
    const prioridade: WhatsappStatus[] = ["connected", "qr", "connecting", "disconnected"];
    const melhor =
      prioridade.find((status) => conexoes.some((c) => c.status === status)) ?? "disconnected";
    const comQr = conexoes.find((c) => c.status === "qr" && c.qr);
    return { whatsappStatus: melhor, whatsappQr: comQr?.qr ?? null };
  }, [conexoes]);

  return (
    <AppStateContext.Provider
      value={{
        session,
        supabaseConfigurado: isSupabaseConfigured,
        logout,
        whatsappStatus,
        whatsappQr,
        conexoes,
        conexoesCarregando,
        conexoesErro,
        refreshConexoes,
        estrategia,
        estrategiaCarregando,
        refreshEstrategia,
        clientes,
        clientesCarregando,
        clientesErro,
        refreshClientes,
        selecionados,
        toggleSelecionado,
        setSelecionados,
        limparSelecionados,
        envioAtivoId,
        setEnvioAtivoId,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState precisa estar dentro de <AppStateProvider>");
  return ctx;
}
