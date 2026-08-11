/**
 * Tipos de domínio compartilhados pela interface.
 *
 * Estes tipos descrevem o que o frontend ESPERA receber da API externa
 * (`VITE_API_URL`) — não há nenhuma implementação ou dado local aqui.
 * O contrato completo está documentado em README_CLAUDE_BACKEND.md.
 */

export type Tag = { id: string; nome: string; cor: string };

/** Status consolidado de um destinatário dentro de um lote de disparo. */
export type ItemStatus =
  | "pendente"
  | "processando"
  | "enviado"
  | "entregue"
  | "lido"
  | "erro"
  | "numero_invalido";

export type EnvioStatus = "pendente" | "agendado" | "em_andamento" | "pausado" | "concluido";

export type WhatsappStatus = "disconnected" | "connecting" | "qr" | "connected";

/** Slot fixo de conexão: o sistema opera com no máximo duas sessões. */
export type WhatsappSlot = 1 | 2;

export type WhatsappConexao = {
  slot: WhatsappSlot;
  configurada: boolean;
  status: WhatsappStatus;
  qr: string | null;
  telefone: string | null;
  nome: string | null;
  ultima_conexao: string | null;
  mensagens_enviadas: number | null;
};

export type EstrategiaEnvio = "slot_1" | "slot_2" | "round_robin" | "qualquer";

export type EstrategiaConfig = {
  estrategia: EstrategiaEnvio;
  /** Slot que o backend usará no próximo envio (round robin). */
  next_slot: WhatsappSlot | null;
  slots_ativos: WhatsappSlot[];
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
  tags: Tag[];
  ultimo_envio_em?: string | null;
  ultimo_envio_status?: ItemStatus | null;
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
  erro: string | null;
  criado_em: string;
};

export type EnvioResumo = {
  id: string;
  criado_em: string;
  lote: string | null;
  status: EnvioStatus;
  slot: WhatsappSlot | null;
  total: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhas: number;
  numeros_invalidos: number;
  pendentes: number;
};

export type EnvioItem = {
  id: string;
  status: "pendente" | "enviado" | "erro" | "numero_invalido";
  status_entrega: "entregue" | "lido" | null;
  erro: string | null;
  slot: WhatsappSlot | null;
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
  if (item.status === "pendente") return "pendente";
  if (item.status_entrega === "lido") return "lido";
  if (item.status_entrega === "entregue") return "entregue";
  return "enviado";
}

/** Variáveis que a interface oferece no editor de mensagem. */
export const VARIAVEIS_MENSAGEM = [
  { token: "{{nome}}", descricao: "Nome do cliente" },
  { token: "{{telefone}}", descricao: "Telefone normalizado" },
  { token: "{{valor}}", descricao: "Valor da fatura" },
  { token: "{{vencimento}}", descricao: "Data de vencimento" },
  { token: "{{pix}}", descricao: "Código PIX copia-e-cola" },
] as const;
