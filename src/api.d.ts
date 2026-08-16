declare module "@/api" {
  import type {
    Cliente,
    DashboardResumo,
    EnvioItem,
    EnvioResumo,
    EnvioStatus,
    EstrategiaConfig,
    EstrategiaEnvio,
    PixExtracao,
    PixExtracaoStatus,
    WhatsappConexao,
    WhatsappSlot,
  } from "@/lib/types";

  type Envio = {
    id: string;
    status: EnvioStatus;
    agendado_para: string | null;
    retomar_em: string | null;
    template_mensagem: string;
    estrategia?: EstrategiaEnvio | null | undefined;
    janela_ms?: number | null | undefined;
    itens: EnvioItem[];
  };

  type EnvioProgresso = {
    total: number;
    enviados: number;
    entregues: number;
    lidos: number;
    falhas: number;
    numeros_invalidos: number;
    pendentes: number;
    status: EnvioStatus;
    ultimo_envio_em: string | null;
    proximo_slot: WhatsappSlot | null;
    slot_atual: WhatsappSlot | null;
  };

  type Fatura = {
    id: string;
    cliente_id: string;
    cliente_nome: string;
    telefone: string;
    valor: string | null;
    vencimento: string | null;
    pdf_url: string | null;
    pix_code: string | null;
    ultimo_envio_em: string | null;
    ultimo_envio_status: string | null;
  };

  export const api: {
    dashboard: {
      resumo: () => Promise<DashboardResumo>;
    };
    whatsapp: {
      status: () => Promise<{ status: "disconnected" | "connecting" | "qr" | "connected"; qr: string | null }>;
      logout: () => Promise<{ ok: boolean }>;
      conexoes: () => Promise<WhatsappConexao[]>;
      statusSlot: (slot: WhatsappSlot) => Promise<WhatsappConexao>;
      conectar: (slot: WhatsappSlot) => Promise<WhatsappConexao>;
      desconectar: (slot: WhatsappSlot) => Promise<{ ok: boolean }>;
    };
    estrategia: {
      buscar: () => Promise<EstrategiaConfig>;
      salvar: (payload: { estrategia: EstrategiaEnvio }) => Promise<EstrategiaConfig>;
    };
    pix: {
      listar: (params?: {
        busca?: string | undefined;
        status?: PixExtracaoStatus | "todos" | undefined;
      } | undefined) => Promise<PixExtracao[]>;
      enviarArquivos: (arquivos: File[]) => Promise<PixExtracao[]>;
      reprocessar: (id: string) => Promise<PixExtracao>;
      aplicarNoCliente: (id: string, clienteId: string) => Promise<{ ok: boolean }>;
      exportar: (
        formato: "csv" | "xlsx",
        params?: { busca?: string | undefined; status?: PixExtracaoStatus | "todos" | undefined } | undefined,
      ) => Promise<void>;
    };
    faturas: {
      listar: (params?: { busca?: string | undefined; filtro?: string | undefined } | undefined) => Promise<Fatura[]>;
      exportar: (formato: "csv" | "xlsx", params?: { busca?: string | undefined; filtro?: string | undefined } | undefined) => Promise<void>;
    };
    clientes: {
      listar: (params?: { busca?: string | undefined; filtro?: string | undefined } | undefined) => Promise<Cliente[]>;
      buscar: (id: string) => Promise<Cliente>;
      criar: (payload: { nome: string; telefone: string; valor?: string | undefined; vencimento?: string | undefined } | undefined) => Promise<Cliente>;
      atualizar: (id: string, payload: Record<string, unknown>) => Promise<Cliente>;
      remover: (id: string) => Promise<{ ok: boolean }>;
      historico: (id: string) => Promise<
        {
          id: string;
          criado_em: string;
          mensagem: string | null;
          slot: WhatsappSlot | null;
          status: string;
          status_entrega: string | null;
          erro: string | null;
        }[]
      >;
      uploadPdf: (id: string, file: File) => Promise<Cliente>;
      converterLista: (texto: string) => Promise<{ itens: { nome: string; numero: string; valor: number | null; arquivo: string }[]; avisos: string[]; total: number }>;
      importarLista: (itens: { nome: string; numero: string; valor: number | null; arquivo: string }[]) => Promise<{ criados: number; erros: unknown[]; total: number }>;
    };
    importacao: {
      enviar: (args: { planilha: File; zip: File; mensagem?: string | undefined } | undefined) => Promise<any>;
      enviarLote: (args: { itens: unknown[]; mensagem?: string | undefined; lote?: string | undefined }) => Promise<any>;
      uploadPdf: (args: { caminho: string; blob: Blob; nomeArquivo: string }) => Promise<{ path: string; publicUrl: string }>;
      baixarModelo: () => Promise<void>;
    };
    chat: {
      listarConversas: () => Promise<any[]>;
      listarMensagens: (conversaId: string) => Promise<any[]>;
      marcarLida: (conversaId: string) => Promise<any>;
      apagar: (conversaId: string) => Promise<{ ok: boolean }>;
      enviar: (conversaId: string, args: { mensagem?: string | undefined; anexo?: File | undefined }) => Promise<any>;
      enviarFatura: (conversaId: string, modo: "pdf" | "pix" | "ambos") => Promise<{ fatura: any; pix: any | null }>;
    };
    tags: {
      listar: () => Promise<{ id: string; nome: string; cor: string }[]>;
      criar: (payload: { nome: string; cor?: string | undefined } | undefined) => Promise<{ id: string; nome: string; cor: string }>;
      atualizar: (id: string, payload: { nome?: string | undefined; cor?: string | undefined } | undefined) => Promise<{ id: string; nome: string; cor: string }>;
      remover: (id: string) => Promise<{ ok: boolean }>;
      atribuir: (tagId: string, clienteId: string) => Promise<{ ok: boolean }>;
      remover_do_cliente: (tagId: string, clienteId: string) => Promise<{ ok: boolean }>;
    };
    respostasRapidas: {
      listar: () => Promise<{ id: string; atalho: string; texto: string }[]>;
      criar: (payload: { atalho: string; texto: string }) => Promise<{ id: string; atalho: string; texto: string }>;
      atualizar: (
        id: string,
        payload: { atalho?: string | undefined; texto?: string | undefined } | undefined,
      ) => Promise<{ id: string; atalho: string; texto: string }>;
      remover: (id: string) => Promise<{ ok: boolean }>;
    };
    envios: {
      criar: (payload: {
        cliente_ids: string[];
        mensagem: string;
        slot?: WhatsappSlot | undefined;
        janela_ms?: number | undefined;
        agendado_para?: string | undefined;
      }) => Promise<Envio>;
      disparar: (id: string) => Promise<{ ok: boolean; mensagem: string }>;
      reenviarErros: (id: string) => Promise<{ ok: boolean; mensagem: string }>;
      agendar: (id: string, agendado_para: string) => Promise<Envio>;
      buscar: (id: string) => Promise<Envio>;
      listar: (params?: {
        de?: string | undefined;
        ate?: string | undefined;
        status?: EnvioStatus | "todos" | undefined;
        slot?: WhatsappSlot | "todos" | undefined;
        busca?: string | undefined;
      } | undefined) => Promise<EnvioResumo[]>;
      itens: (id: string, params?: { filtro?: string | undefined; busca?: string | undefined } | undefined) => Promise<EnvioItem[]>;
      progresso: (id: string) => Promise<EnvioProgresso>;
      exportar: (
        formato: "csv" | "xlsx",
        params?: { de?: string | undefined; ate?: string | undefined; status?: string | undefined; slot?: string | undefined; busca?: string | undefined } | undefined,
      ) => Promise<void>;
      teste: (payload: {
        telefone?: string | undefined;
        cliente_id?: string | undefined;
        template_mensagem?: string | undefined;
        com_pdf?: boolean | undefined;
      }) => Promise<{
        ok: boolean;
        telefone?: string | undefined;
        com_pdf?: boolean | undefined;
        mensagem?: string | undefined;
        messageId?: string | null | undefined;
        error?: string | undefined;
      }>;
    };
  };
}

declare module "@/supabaseClient" {
  import type { SupabaseClient } from "@supabase/supabase-js";
  export const supabase: SupabaseClient;
  export const isSupabaseConfigured: boolean;
}
