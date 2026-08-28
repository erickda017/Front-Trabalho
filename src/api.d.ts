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
    Tag,
    TipoFatura,
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
    enviar_pix?: boolean | undefined;
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

  // Resumo de operador anexado às respostas de api.supervisor.* (ver
  // backend/src/routes/supervisor.routes.js, mapaOperadores()).
  type OperadorResumo = { id: string; email: string; nome: string };

  // GET /supervisor/operadores -- perfil + resumo de carteira de cada operador.
  type OperadorComCarteira = {
    id: string;
    email: string;
    nome: string | null;
    role: string;
    created_at: string;
    total_clientes: number;
    total_com_pix: number;
    disparos_em_andamento: number;
    disparos_concluidos: number;
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

  type StatusVerificacaoVencimentos = {
    rodando: boolean;
    total: number;
    processados: number;
    encontrados: number;
    nao_encontrados: number;
    erros: { cliente_id: string; cliente_nome: string; erro: string }[];
    iniciado_em: string | null;
    concluido_em: string | null;
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
    perfil: {
      // [2026-08] Nome + foto agora vêm do banco (perfis.nome/avatar_path,
      // ver migration-21-perfil-avatar.sql), não mais do localStorage.
      // `role` (operador|supervisor) decide se o menu "Supervisor" aparece.
      me: () => Promise<{ id: string; email: string; role: string; nome: string | null; avatar_url: string | null }>;
      atualizar: (payload?: {
        nome?: string | undefined;
        foto?: File | "remover" | null | undefined;
      }) => Promise<{ id: string; email: string; role: string; nome: string | null; avatar_url: string | null }>;
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
      // [2026-08] "Opção 2" de extração -- roda no backend, 1 PDF por
      // requisição (ver backend/src/routes/pix.routes.js, POST
      // /extrair-servidor). `arquivo`/`clienteId` são opcionais (nome
      // exibido/cliente pra tentar casar automaticamente).
      extrairNoServidor: (
        file: File,
        opcoes?: { arquivo?: string | undefined; clienteId?: string | undefined } | undefined,
      ) => Promise<
        | { encontrado: false; arquivo: string }
        | (PixExtracao & { origem: string | null; encontrado: true; pagina: number })
      >;
    };
    faturas: {
      listar: (params?: { busca?: string | undefined; filtro?: string | undefined } | undefined) => Promise<Fatura[]>;
      exportar: (formato: "csv" | "xlsx", params?: { busca?: string | undefined; filtro?: string | undefined } | undefined) => Promise<void>;
      uploadAvulso: (file: File, dadosPixPrecalculado?: DadosPix | null) => Promise<{ associado: boolean; cliente_nome?: string }>;
      pendentes: {
        listar: () => Promise<
          { id: string; arquivo: string; pdf_url: string; pix_code: string | null; valor: string | null; vencimento: string | null; criado_em: string }[]
        >;
        associar: (id: string, clienteId: string) => Promise<unknown>;
        remover: (id: string) => Promise<{ ok: boolean }>;
      };
    };
    clientes: {
      listar: (params?: {
        busca?: string | undefined;
        filtro?: string | undefined;
        tag?: string | undefined;
        com_pix?: boolean | undefined;
        sem_pix?: boolean | undefined;
        com_pdf?: boolean | undefined;
        sem_pdf?: boolean | undefined;
        recebeu_disparo?: boolean | undefined;
        safra?: string | undefined;
        tipo_fatura?: TipoFatura | undefined;
      } | undefined) => Promise<Cliente[]>;
      buscar: (id: string) => Promise<Cliente>;
      criar: (payload: { nome: string; telefone: string; valor?: string | undefined; vencimento?: string | undefined } | undefined) => Promise<Cliente>;
      atualizar: (id: string, payload: Record<string, unknown>) => Promise<Cliente>;
      remover: (id: string) => Promise<{ ok: boolean }>;
      // Vincula outro cliente (outro número) como o MESMO cliente -- PDF/pix/
      // valor/vencimento passam a valer pros dois (ver backend/migration-15).
      vincular: (id: string, outroId: string) => Promise<Cliente>;
      // Desvincula este cliente do grupo (volta a ser um número independente).
      desvincular: (id: string) => Promise<{ ok: boolean }>;
      // Grava só o Pix (sem PDF novo) -- usado pela "rodar verificação".
      atualizarPix: (id: string, pixCode: string) => Promise<Cliente>;
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
      verificarVencimentos: (apenasPendentes?: boolean) => Promise<StatusVerificacaoVencimentos>;
      statusVerificarVencimentos: () => Promise<StatusVerificacaoVencimentos>;
    };
    // [2026-08] Ver CONTEXTO.md ("Safras (FPD/SPD) e histórico consolidado")
    // e README_CLAUDE_BACKEND.md seção 11.
    safras: {
      listar: () => Promise<SafraResumo[]>;
      detalhe: (safra: string) => Promise<SafraResumo>;
      consolidar: (safra: string) => Promise<unknown>;
    };
    // [2026-08] SUPERVISOR: todas as rotas abaixo exigem role=supervisor no
    // backend (ver middleware/supervisor.js) -- 403 se chamadas por um
    // operador comum (ver routes/supervisor.tsx).
    supervisor: {
      operadores: () => Promise<OperadorComCarteira[]>;
      // [2026-08] Passou a paginar de verdade (perPageDefault:1000 cortava em
      // silêncio numa carteira grande, sem o front saber) -- resposta agora é
      // {itens,total} em vez de um array cru.
      clientes: (params?: {
        busca?: string | undefined;
        operador_id?: string | undefined;
        com_pix?: string | undefined;
        sem_pix?: string | undefined;
        com_pdf?: string | undefined;
        sem_pdf?: string | undefined;
        page?: number | undefined;
        per_page?: number | undefined;
      } | undefined) => Promise<{
        itens: (Omit<Cliente, "tags"> & { tags: { id: string; nome: string; cor: string }[]; operador: OperadorResumo | null })[];
        total: number;
      }>;
      faturas: (params?: {
        busca?: string | undefined;
        operador_id?: string | undefined;
        com_pdf?: string | undefined;
        sem_pdf?: string | undefined;
        page?: number | undefined;
        per_page?: number | undefined;
      } | undefined) => Promise<{
        itens: {
          cliente_id: string;
          cliente_nome: string;
          telefone: string;
          valor: string | null;
          vencimento: string | null;
          pdf_path: string | null;
          pdf_url: string | null;
          pix_code: string | null;
          usuario_id: string;
          operador: OperadorResumo | null;
        }[];
        total: number;
      }>;
      disparos: (params?: {
        status?: string | undefined;
        operador_id?: string | undefined;
      } | undefined) => Promise<{
        id: string;
        criado_em: string;
        lote: string | null;
        status: EnvioStatus;
        template_mensagem: string;
        operador: OperadorResumo | null;
        total: number;
        enviados: number;
        entregues: number;
        lidos: number;
        falhas: number;
        pendentes: number;
        cancelados: number;
      }[]>;
      dashboard: () => Promise<{
        totais: {
          operadores: number;
          clientes: number;
          com_pix: number;
          disparos_em_andamento: number;
          disparos_concluidos: number;
          enviados: number;
          falhas: number;
          pendentes: number;
          valor_medio: number;
          valor_total: number;
          faturas_com_valor: number;
        };
        serie_disparos_7dias: { data: string; total: number }[];
        por_operador: {
          operador: OperadorResumo;
          total_clientes: number;
          com_pdf: number;
          com_pix: number;
          disparos_em_andamento: number;
          disparos_concluidos: number;
          enviados: number;
          entregues: number;
          lidos: number;
          falhas: number;
        }[];
      }>;
      // Lista enxuta (nome/telefone/pix/operador) de todo mundo com Pix já
      // cadastrado -- matéria-prima pro casamento por nome feito no navegador
      // (planilha de PIX e extrator pessoal, ver routes/supervisor.tsx).
      indicePix: () => Promise<{
        id: string;
        nome: string;
        telefone: string;
        pix_code: string;
        usuario_id: string;
        operador: OperadorResumo | null;
      }[]>;
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
      enviarFatura: (conversaId: string, modo: "pdf" | "pix" | "pdf_pix") => Promise<{ fatura: any; pix: any | null }>;
      vincularCliente: (conversaId: string, clienteId: string | null) => Promise<any>;
    };
    tags: {
      listar: () => Promise<Tag[]>;
      // `permite_disparo: false` marca a tag como "tira do disparo" (ex.:
      // Pago, Cancelado) -- ver migration-14. Omitido, o backend grava true.
      criar: (payload: { nome: string; cor?: string | undefined; permite_disparo?: boolean | undefined } | undefined) => Promise<Tag>;
      atualizar: (
        id: string,
        payload: { nome?: string | undefined; cor?: string | undefined; permite_disparo?: boolean | undefined } | undefined,
      ) => Promise<Tag>;
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
        /** true = lote "só PIX" -- nunca anexa PDF, manda o código PIX como
         *  texto; a elegibilidade passa a exigir pix_code em vez de pdf_path
         *  (ver backend/src/routes/envios.routes.js, resolverClienteIds). */
        enviar_pix?: boolean | undefined;
      }) => Promise<Envio & { ignorados_sem_pdf: number; ignorados_por_tag: number }>;
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

  // [2026-08] PROXY DE ARQUIVOS: `pdf_url`/`anexo_url` são paths relativos
  // deste backend (não mais links diretos pro Supabase Storage) -- exigem
  // `Authorization: Bearer <token>`, então precisam passar por `fetch` (não
  // dá pra usar num `<a href>`/`<img src>` cru). Ver comentário grande no
  // topo de src/api.js pro porquê e o resto do contexto.

  /** Abre o arquivo (PDF) numa nova aba, autenticado. `pdfUrlOuPath` nulo/
   *  undefined é ignorado silenciosamente (mesmo padrão de "sem PDF ainda"). */
  export function abrirArquivoProtegido(pdfUrlOuPath: string | null | undefined): Promise<void>;

  /** Busca o arquivo autenticado e devolve uma blob URL local pronta pra usar
   *  em `src`/`href`. Devolve `null` se `pdfUrlOuPath` for nulo/undefined. */
  export function buscarBlobUrlProtegida(pdfUrlOuPath: string | null | undefined): Promise<string | null>;

  /** Busca o arquivo autenticado e devolve o `Blob` cru -- pra quem vai
   *  PROCESSAR o conteúdo (ex.: reler o QR do Pix) em vez de exibir/baixar.
   *  Devolve `null` se `pdfUrlOuPath` for nulo/undefined. */
  export function buscarBlobArquivoProtegido(pdfUrlOuPath: string): Promise<Blob>;
  export function buscarBlobArquivoProtegido(pdfUrlOuPath: string | null | undefined): Promise<Blob | null>;
}

declare module "@/supabaseClient" {
  import type { SupabaseClient } from "@supabase/supabase-js";
  export const supabase: SupabaseClient;
  export const isSupabaseConfigured: boolean;
}
