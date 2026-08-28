declare module "@/api" {
  import type {
    Cliente,
    ConfigDisparo,
    DashboardResumo,
    EnvioItem,
    EnvioResumo,
    EnvioStatus,
    PixExtracao,
    PixExtracaoStatus,
    SafraResumo,
    WhatsappConexao,
  } from "@/lib/types";
  import type { DadosPix } from "@/lib/pixWorkerClient";

  type Envio = {
    id: string;
    status: EnvioStatus;
    agendado_para: string | null;
    retomar_em: string | null;
    template_mensagem: string;
    janela_ms?: number | null | undefined;
    itens: EnvioItem[];
  };

  type SugestaoSpd = {
    cliente_id: string;
    cliente_nome: string;
    tipo_fatura_atual: "FPD";
    data_prazo_atual: string;
    sugestao: { tipo_fatura: "SPD"; data_prazo: string };
  };

  type EnvioProgresso = {
    total: number;
    enviados: number;
    entregues: number;
    lidos: number;
    falhas: number;
    numeros_invalidos: number;
    pendentes: number;
    cancelados: number;
    status: EnvioStatus;
    ultimo_envio_em: string | null;
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

  // Item devolvido por /clientes/converter-lista e aceito por /clientes/importar-lista
  // -- ver backend/src/lib/parseListaClientes.js e CONTEXTO.md ("Safras").
  type ItemConvertido = {
    nome: string;
    numero: string;
    valor: number | null;
    arquivo: string;
    tipo_fatura?: "FPD" | "SPD" | null;
    data_prazo?: string | null;
    numero_contrato?: string | null;
    data_contrato?: string | null;
  };

  export const api: {
    dashboard: {
      resumo: () => Promise<DashboardResumo>;
    };
    // [2026-08] MULTI-TENANT: 1 conexão por usuário logado -- sem parâmetro
    // de slot, o backend já sabe de quem é a sessão pelo token de autenticação.
    whatsapp: {
      status: (slot?: 1 | 2 | undefined) => Promise<WhatsappConexao>;
      statusAmbosSlots: () => Promise<{ 1: WhatsappConexao; 2: WhatsappConexao }>;
      conectar: (slot?: 1 | 2 | undefined) => Promise<WhatsappConexao>;
      desconectar: (slot?: 1 | 2 | undefined) => Promise<WhatsappConexao>;
    };
    configuracoes: {
      disparo: () => Promise<ConfigDisparo>;
    };
    // [2026-08] tipos faltando pra api.boletos (existe em runtime desde antes,
    // só não estava declarado aqui -- tsc acusava "Property 'boletos' does not exist").
    boletos: {
      salvarPix: (payload: {
        pixCopiaCola: string;
        valor?: string | number | null | undefined;
        vencimento?: string | null | undefined;
        linhaDigitavel?: string | null | undefined;
        arquivo?: string | undefined;
        clienteId?: string | undefined;
      }) => Promise<PixExtracao>;
      extrairDoPdf: (file: File) => Promise<DadosPix | null>;
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
          status: string;
          status_entrega: string | null;
          erro: string | null;
        }[]
      >;
      uploadPdf: (id: string, file: File, dadosPixPrecalculado?: DadosPix | null) => Promise<Cliente>;
      converterLista: (texto: string) => Promise<{ itens: ItemConvertido[]; avisos: string[]; total: number }>;
      importarLista: (itens: ItemConvertido[]) => Promise<{ criados: number; erros: unknown[]; total: number }>;
      importarPagos: (texto: string) => Promise<{
        tag: { id: string; nome: string; cor: string; permite_disparo: boolean };
        total_colados: number;
        encontrados: { nome_colado: string; cliente_id: string; cliente_nome: string }[];
        nao_encontrados: string[];
        sugestoes_spd: SugestaoSpd[];
      }>;
      promoverSpd: (id: string, dataPrazo?: string | undefined) => Promise<Cliente>;
    };
    // [2026-08] Ver CONTEXTO.md ("Safras (FPD/SPD) e histórico consolidado")
    // e README_CLAUDE_BACKEND.md seção 11.
    safras: {
      listar: () => Promise<SafraResumo[]>;
      detalhe: (safra: string) => Promise<SafraResumo>;
      consolidar: (safra: string) => Promise<unknown>;
    };
    importacao: {
      enviar: (args: { planilha: File; zip: File; mensagem?: string | undefined } | undefined) => Promise<any>;
      enviarLote: (args: { itens: unknown[]; mensagem?: string | undefined; lote?: string | undefined }) => Promise<any>;
      uploadPdf: (args: { caminho: string; blob: Blob; nomeArquivo: string }) => Promise<{ path: string; signedUrl: string | null }>;
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
        /** Até 5 variações do texto -- o backend sorteia uma pra cada mensagem enviada. */
        mensagens?: string[] | undefined;
        janela_ms?: number | undefined;
        agendado_para?: string | undefined;
      }) => Promise<Envio>;
      disparar: (id: string) => Promise<{ ok: boolean; mensagem: string }>;
      pausar: (id: string) => Promise<{ ok: boolean; status: string }>;
      cancelar: (id: string) => Promise<{ ok: boolean; status: string }>;
      ativo: () => Promise<{ id: string | null; status: EnvioStatus | null }>;
      reenviarErros: (id: string) => Promise<{ ok: boolean; mensagem: string }>;
      agendar: (id: string, agendado_para: string) => Promise<Envio>;
      buscar: (id: string) => Promise<Envio>;
      listar: (params?: {
        de?: string | undefined;
        ate?: string | undefined;
        status?: EnvioStatus | "todos" | undefined;
        busca?: string | undefined;
      } | undefined) => Promise<EnvioResumo[]>;
      itens: (id: string, params?: { filtro?: string | undefined; busca?: string | undefined } | undefined) => Promise<EnvioItem[]>;
      progresso: (id: string) => Promise<EnvioProgresso>;
      exportar: (
        formato: "csv" | "xlsx",
        params?: { de?: string | undefined; ate?: string | undefined; status?: string | undefined; busca?: string | undefined } | undefined,
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
