// Tipos da aba Disparo / E-mail (contrato: Backend-Trabalho/src/routes/disparoEmail.routes.js).

export type LinhaFaturaEmail = {
  cliente_id: string;
  nome: string;
  email: string | null;
  os_numero: string | null;
  valor: number | string | null;
  vencimento: string | null; // "DD/MM/AAAA"
  pdf_url: string | null;
  aceitos: number; // quantas vezes a fatura foi ACEITA para envio
  tentativas: number; // tentativas técnicas (podem ser mais que os aceitos)
  ultimo_status: StatusEnvioEmail | null;
  elegivel: boolean;
  ordem_elegivel: number | null; // posição entre as elegíveis do filtro (o lote leva só as primeiras)
  motivos: string[];
  motivos_texto: string[];
};

export type StatusEnvioEmail =
  | "na_fila"
  | "processando"
  | "aceito"
  | "entregue"
  | "devolvido"
  | "falhou"
  | "cancelado";

export type PainelEmail = {
  disponibilidade: {
    configurado: boolean;
    faltando: string[];
    nome_empresa_definido: boolean;
    webhook_configurado: boolean;
  };
  nome_empresa: string;
  limite_por_lote: number;
  saldo: {
    limite_diario: number;
    usados: number;
    reservados: number;
    disponivel: number;
    compartilhado: boolean;
    aviso: string;
  };
  status_aceitos: string[];
  catalogo: { codigo: string; rotulo: string }[];
};

export type ResumoLoteEmail = {
  id: string;
  status: "em_andamento" | "concluido" | "cancelado";
  total: number;
  processados: number;
  contagens: Record<StatusEnvioEmail, number>;
  aceitos_para_envio: number;
  tentativas_tecnicas: number;
  reenvio: boolean;
  nome_empresa: string;
  criado_em: string;
  concluido_em: string | null;
};

export type ItemLoteEmail = {
  id: string;
  cliente_id: string | null;
  nome: string | null;
  email: string;
  status: StatusEnvioEmail;
  motivo: string | null;
  tentativas: number;
  aceito_em: string | null;
  atualizado_em: string;
};
