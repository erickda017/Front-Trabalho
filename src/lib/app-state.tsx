import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/**
 * Perfil do operador (nome + foto) exibido na barra lateral. Não é dado de
 * autenticação -- é só identificação de quem está operando o painel no
 * momento (útil quando várias pessoas revezam no mesmo login). Guardado no
 * navegador (localStorage): não existe tabela de "usuários" no backend, só a
 * sessão do Supabase usada pra login.
 */
export type Perfil = {
  nome: string;
  /** Data URL (base64) da foto escolhida, ou null se nunca configurada. */
  fotoUrl: string | null;
};

const PERFIL_KEY = "ui:perfilOperador";
const perfilPadrao: Perfil = { nome: "", fotoUrl: null };

function lerPerfilSalvo(): Perfil {
  if (typeof window === "undefined") return perfilPadrao;
  try {
    const bruto = window.localStorage.getItem(PERFIL_KEY);
    if (!bruto) return perfilPadrao;
    const dados = JSON.parse(bruto);
    return {
      nome: typeof dados?.nome === "string" ? dados.nome : "",
      fotoUrl: typeof dados?.fotoUrl === "string" ? dados.fotoUrl : null,
    };
  } catch {
    return perfilPadrao;
  }
}

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

  perfil: Perfil;
  atualizarPerfil: (perfil: Perfil) => void;
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
  const [perfil, setPerfil] = useState<Perfil>(perfilPadrao);

  useEffect(() => {
    setEnvioAtivoIdState(window.sessionStorage.getItem(ENVIO_ATIVO_KEY));
    setPerfil(lerPerfilSalvo());
  }, []);

  const atualizarPerfil = useCallback((novoPerfil: Perfil) => {
    setPerfil(novoPerfil);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PERFIL_KEY, JSON.stringify(novoPerfil));
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

  // Contador de falhas seguidas -- usado tanto pro backoff do polling quanto pra
  // decidir quando de fato mostrar "desconectado" (ver comentário abaixo).
  const falhasSeguidasRef = useRef(0);

  const refreshConexoes = useCallback(async () => {
    try {
      const data = await api.whatsapp.conexoes();
      const lista = SLOTS.map(
        (slot) => data?.find?.((c) => Number(c.slot) === slot) ?? conexaoVazia(slot),
      );
      falhasSeguidasRef.current = 0;
      setConexoes(lista);
      setConexoesErro(null);
    } catch (e) {
      falhasSeguidasRef.current += 1;
      // Uma falha de rede/CORS isolada (ex: backend reiniciando, hiccup do Render)
      // não significa que o WhatsApp desconectou de verdade -- só que não conseguimos
      // perguntar pro backend agora. Sobrescrever pra "desconectado" na 1ª falha já
      // dava um alarme falso enganoso durante picos de carga (ex: uma importação
      // grande deixando o backend lento pra responder por alguns segundos). Só
      // assume "desconectado" depois de falhas seguidas (backend realmente fora do ar).
      if (falhasSeguidasRef.current >= 3) {
        setConexoes(SLOTS.map(conexaoVazia));
      }
      setConexoesErro((e as Error).message);
    } finally {
      setConexoesCarregando(false);
    }
  }, []);

  // Polling das conexões -- no nível raiz (não dentro da tela Conexões) para que o
  // badge e a permissão de disparo não "congelem" enquanto o usuário navega.
  //
  // Backoff quando o backend está fora do ar: martelar a cada 3s um backend que já
  // está sobrecarregado/reiniciando (ex: durante uma importação pesada) só piora a
  // situação, competindo por recursos com o próprio processamento que o derrubou.
  // Em vez disso, o intervalo cresce a cada falha seguida (3s -> 6s -> 12s ... até
  // um teto de 30s) e volta a 3s assim que uma checagem funcionar de novo.
  useEffect(() => {
    if (!session) return;
    let cancelado = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const INTERVALO_BASE_MS = 3000;
    const INTERVALO_MAX_MS = 30000;

    async function verificar() {
      if (cancelado) return;
      await refreshConexoes();
      if (cancelado) return;

      const proximoIntervalo = Math.min(
        INTERVALO_BASE_MS * 2 ** falhasSeguidasRef.current,
        INTERVALO_MAX_MS,
      );
      timeoutId = setTimeout(verificar, proximoIntervalo);
    }

    verificar();
    return () => {
      cancelado = true;
      clearTimeout(timeoutId);
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
        perfil,
        atualizarPerfil,
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
