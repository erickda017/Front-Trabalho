/**
 * Tipos de domínio compartilhados pela interface.
 *
 * Estes tipos descrevem o que o frontend ESPERA receber da API externa
 * (`VITE_API_URL`) — não há nenhuma implementação ou dado local aqui.
 * O contrato completo está documentado em README_CLAUDE_BACKEND.md.
 */

export type Tag = {
  id: string;
  nome: string;
  cor: string;
  /** false = clientes com esta tag não entram em novos lotes de disparo e
   *  saem imediatamente de qualquer lote em andamento/pendente (ex.: tags
   *  "Pago"/"Cancelado"). Default true (sem efeito no disparo). */
  permite_disparo: boolean;
};

/** Status consolidado de um destinatário dentro de um lote de disparo. */
export type ItemStatus =
  | "pendente"
  | "processando"
  | "enviado"
  | "entregue"
  | "lido"
  | "erro"
  | "numero_invalido"
  | "cancelado";

export type EnvioStatus = "pendente" | "agendado" | "em_andamento" | "pausado" | "concluido" | "cancelado";

export type WhatsappStatus = "disconnected" | "connecting" | "qr" | "connected";

// [2026-08] MULTI-TENANT: cada usuário (operador) tem até 2 sessões de
// WhatsApp PRÓPRIAS (não mais compartilhadas entre operadores como antes) --
// "slot 1/2" voltou a existir, mas agora escopado por usuário (ver
// api.whatsapp.statusAmbosSlots, backend/src/services/whatsapp.js). Este
// tipo descreve o status de UMA dessas sessões.
export type WhatsappConexao = {
  configurada: boolean;
  status: WhatsappStatus;
  qr: string | null;
  telefone: string | null;
  nome: string | null;
  ultima_conexao: string | null;
  mensagens_enviadas: number | null;
};

/** Números de comportamento do disparo (delay, limite diário, pausa automática) --
 *  vêm do backend (env vars) pra não ficarem hardcoded/desatualizados no front. */
export type ConfigDisparo = {
  min_delay_ms: number;
  max_delay_ms: number;
  daily_limit: number;
  batch_size: number;
  batch_pause_ms: number;
};

export type Cliente = {
  id: string;
  nome: string;
  telefone: string;
  valor: string | null;
  vencimento: string | null;
  pdf_url: string | null;
  pdf_path: string | null;
  pix_code: string | null;
  /** Quantos disparos (status enviado) este cliente já recebeu no total --
   *  ver backend/src/routes/clientes.routes.js (GET /). */
  disparos_recebidos?: number;
  tags: Tag[];
  ultimo_envio_em?: string | null;
  ultimo_envio_status?: ItemStatus | null;
  /** Outros números de telefone do MESMO cliente (mesma fatura) -- ver
   *  POST /clientes/:id/vincular/:outroId. Só vem preenchido no GET de um
   *  cliente específico, não na listagem. */
  vinculados?: { id: string; nome: string; telefone: string }[];
  /** Se preenchido, esta linha é um número extra vinculado a outro cliente
   *  (aponta pro id da linha "principal") -- ver migration-15. Nulo/ausente
   *  = linha é a principal do seu próprio grupo (ou não tem vínculo). Vem
   *  em toda listagem, permitindo agrupar por cliente no front. */
  cliente_principal_id?: string | null;
  /** [2026-08] Safras -- preenchidos quando o cliente veio da lista crua com
   *  essa informação (ver backend/src/lib/parseListaClientes.js e
   *  migration-19-safras-faturas.sql). Nulos para cadastro manual ou
   *  planilha sem essa coluna. */
  tipo_fatura?: TipoFatura | null;
  /** "YYYY-MM-DD". Fonte de verdade pra cálculo/filtro por data -- `vencimento`
   *  acima continua sendo texto livre só pra exibição/mensagem. */
  data_prazo?: string | null;
  numero_contrato?: string | null;
  /** Hoje sempre null (nenhum formato de lista crua observado traz essa data
   *  separada da data de prazo) -- reservado pra uma variação futura. */
  data_contrato?: string | null;
  /** "YYYY-MM", GERADO no banco a partir de data_prazo -- nunca enviar em POST/PUT. */
  safra?: string | null;
  status_operador?: StatusOperador | null;
  status_operador_atualizado_em?: string | null;
};

/** FPD = primeira fatura, SPD = segunda fatura -- ver CONTEXTO.md ("Safras"). */
export type TipoFatura = "FPD" | "SPD";

/** [2026-08] Desfecho da última tratativa de cobrança (aba Qualidade) -- ver
 *  backend/src/lib/statusOperador.js, fonte única da verdade sobre a lista.
 *  null/ausente = cliente ainda sem tratativa registrada. */
export type StatusOperador =
  | "iniciado"
  | "tentativa_contato"
  | "contato_estabelecido"
  | "promessa_pagamento"
  | "pagamento_confirmado"
  | "recusa_pagamento"
  | "numero_invalido"
  | "fraude"
  | "contrato_cancelado"
  | "renegociacao";

/** Mesmo conjunto que `STATUS_BLOQUEIA_DISPARO` no backend -- cliente com um
 *  destes status sai da fila/disparo igual uma tag `permite_disparo: false`. */
export const STATUS_OPERADOR_BLOQUEIA_DISPARO = new Set<StatusOperador>([
  "pagamento_confirmado",
  "numero_invalido",
  "fraude",
  "contrato_cancelado",
]);

/** Resumo de métricas de uma safra -- ver GET /safras, /safras/:safra. */
export type SafraResumo = {
  safra: string; // "2026-09"
  rotulo: string; // "Setembro/2026"
  total_clientes: number;
  total_fpd: number;
  total_spd: number;
  sem_tipo_fatura: number;
  pagos: number;
  nao_pagos: number;
  receberam_disparo: number;
  nao_receberam_disparo: number;
  valor_total: number;
  valor_medio: number;
  /** Só presente pra safra AO VIVO (arquivada=false) -- snapshot do histórico não guarda esta quebra. */
  valor_recebido?: number;
  /** Só presente pra safra AO VIVO (arquivada=false) -- ver valor_recebido. */
  valor_em_aberto?: number;
  duplicidades_detectadas: number;
  consolidado_em: string | null;
  /** true = sem cliente ativo nessa safra hoje, métricas vêm só do snapshot histórico. */
  arquivada: boolean;
};

export type DashboardResumo = {
  clientes: number;
  faturas: number;
  disparos_hoje: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhas: number;
  numeros_invalidos: number;
  pendentes: number;
  valor_medio?: number;
  valor_total?: number;
  faturas_com_valor?: number;
  serie_disparos_7dias?: { data: string; total: number }[];
};

export type PixExtracaoStatus =
  | "aguardando"
  | "processando"
  | "encontrado"
  | "nao_encontrado"
  | "erro";

export type PixExtracao = {
  id: string;
  arquivo: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  status: PixExtracaoStatus;
  pix_code: string | null;
  valor: string | null;
  vencimento: string | null;
  linha_digitavel: string | null;
  erro: string | null;
  criado_em: string;
};

export type EnvioResumo = {
  id: string;
  criado_em: string;
  lote: string | null;
  status: EnvioStatus;
  total: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhas: number;
  numeros_invalidos: number;
  pendentes: number;
  cancelados: number;
};

/* -------------------------------------------------------------------------- */
/* Supervisor -- mesmos formatos devolvidos por /api/supervisor/* (ver         */
/* backend/src/routes/supervisor.routes.js). Movidos de routes/supervisor.tsx  */
/* pra cá pra seguir o mesmo padrão dos outros tipos de domínio deste arquivo. */
/* -------------------------------------------------------------------------- */

export type Operador = { id: string; email: string | null; nome: string | null };

export type ClienteSup = {
  id: string;
  nome: string;
  telefone: string;
  valor: string | null;
  vencimento: string | null;
  pix_code: string | null;
  pdf_path: string | null;
  operador: Operador | null;
};

export type FaturaSup = {
  cliente_id: string;
  cliente_nome: string;
  telefone: string;
  valor: string | null;
  vencimento: string | null;
  pdf_path: string | null;
  pdf_url: string | null;
  pix_code: string | null;
  operador: Operador | null;
};

export type DisparoSup = {
  id: string;
  criado_em: string;
  lote: string | null;
  status: string;
  total: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhas: number;
  pendentes: number;
  operador: Operador | null;
};

export type ResumoOperador = {
  operador: Operador;
  total_clientes: number;
  com_pdf: number;
  com_pix: number;
  disparos_em_andamento: number;
  disparos_concluidos: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhas: number;
};

export type IndicePixItem = {
  id: string;
  nome: string;
  telefone: string;
  pix_code: string;
  usuario_id: string;
  operador: Operador | null;
};

export type SerieDia = { data: string; total: number };

export type DashboardSupervisor = {
  totais: {
    operadores: number;
    clientes: number;
    com_pix: number;
    disparos_em_andamento: number;
    disparos_concluidos: number;
    enviados?: number;
    falhas?: number;
    pendentes?: number;
    valor_medio?: number;
    valor_total?: number;
    faturas_com_valor?: number;
  };
  serie_disparos_7dias?: SerieDia[];
  por_operador: ResumoOperador[];
};

export type EnvioItem = {
  id: string;
  status: "pendente" | "enviado" | "erro" | "numero_invalido" | "cancelado";
  status_entrega: "entregue" | "lido" | null;
  erro: string | null;
  enviado_em: string | null;
  clientes: {
    nome: string;
    telefone: string;
    valor?: string | null;
    vencimento?: string | null;
  } | null;
};

/** Deriva o status consolidado exibido na interface a partir do item cru da API. */
export function statusDoItem(item: Pick<EnvioItem, "status" | "status_entrega">): ItemStatus {
  if (item.status === "erro") return "erro";
  if (item.status === "numero_invalido") return "numero_invalido";
  if (item.status === "cancelado") return "cancelado";
  if (item.status === "pendente") return "pendente";
  if (item.status_entrega === "lido") return "lido";
  if (item.status_entrega === "entregue") return "entregue";
  return "enviado";
}

// [2026-09] Movidos de routes/chat.tsx (onde eram declarados só localmente,
// o que deixava api.d.ts sem como referenciá-los e caindo em `any`) --
// mesma tabela `conversas`/`mensagens`, ver backend/supabase-schema.sql.
export type Conversa = {
  id: string;
  telefone: string;
  nome_contato: string | null;
  cliente_id: string | null;
  nao_lidas: number;
  ultima_mensagem: string | null;
  ultima_mensagem_em: string | null;
  clientes: { nome: string; pdf_url: string | null; pix_code: string | null; tags: Tag[] } | null;
};

export type Mensagem = {
  id: string;
  conversa_id: string;
  direcao: "entrada" | "saida";
  tipo: "texto" | "imagem" | "audio" | "documento";
  texto: string | null;
  anexo_url: string | null;
  anexo_nome: string | null;
  status_entrega: string | null;
  created_at: string;
};

/** Variáveis que a interface oferece no editor de mensagem. */
export const VARIAVEIS_MENSAGEM = [
  { token: "{{nome}}", descricao: "Nome do cliente" },
  { token: "{{telefone}}", descricao: "Telefone normalizado" },
  { token: "{{valor}}", descricao: "Valor da fatura" },
  { token: "{{vencimento}}", descricao: "Data de vencimento" },
  { token: "{{pix}}", descricao: "Código PIX copia-e-cola" },
] as const;
