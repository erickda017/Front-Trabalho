export type ItemStatus =
  | "processando"
  | "enviado"
  | "entregue"
  | "lido"
  | "pendente"
  | "erro"
  | "numero_invalido";

export type Cliente = {
  id: string;
  nome: string;
  telefone: string;
  valor: string;
  vencimento: string;
  pdf: string;
};

export const metricas = {
  enviadosHoje: 142,
  limiteDiario: 500,
  fila: 28,
  taxaEntrega: "98,4%",
};

export const sessao = {
  instancia: "main_prod_01",
  uptime: "14h 22m",
  dispositivo: "Samsung S23 Ultra",
  numero: "+55 11 98821-4402",
};

export const esteira: Array<{
  id: string;
  nome: string;
  arquivo: string;
  valor: string;
  vencimento: string;
  status: ItemStatus;
  hora?: string;
}> = [
  {
    id: "1",
    nome: "Ricardo Albuquerque",
    arquivo: "Fatura_REF_0524.pdf",
    valor: "R$ 2.450,00",
    vencimento: "15/06",
    status: "processando",
    hora: "agora",
  },
  {
    id: "2",
    nome: "Mariana Santos Pereira",
    arquivo: "Fatura_REF_0525.pdf",
    valor: "R$ 890,50",
    vencimento: "14/06",
    status: "lido",
    hora: "14:21",
  },
  {
    id: "3",
    nome: "Joaquim Ferreira Neto",
    arquivo: "Erro: número inválido",
    valor: "R$ 157,00",
    vencimento: "12/06",
    status: "numero_invalido",
    hora: "14:19",
  },
  {
    id: "4",
    nome: "Almeida Construções LTDA",
    arquivo: "Fatura_REF_0527.pdf",
    valor: "R$ 4.520,00",
    vencimento: "18/06",
    status: "entregue",
    hora: "14:18",
  },
  {
    id: "5",
    nome: "Fernanda Lima Rocha",
    arquivo: "Fatura_REF_0528.pdf",
    valor: "R$ 312,90",
    vencimento: "20/06",
    status: "pendente",
  },
];

export const logs = [
  { hora: "14:22:01", tipo: "SYS" as const, texto: "Pausa de segurança iniciada (30s)." },
  {
    hora: "14:21:45",
    tipo: "MSG" as const,
    texto: "Fatura enviada com sucesso p/ +55 11 99283-1022.",
  },
  { hora: "14:21:12", tipo: "MSG" as const, texto: "Entrega confirmada — lote #9422." },
  { hora: "14:19:42", tipo: "ERR" as const, texto: "Número inválido: +55 11 2233-4455." },
  { hora: "14:18:30", tipo: "SYS" as const, texto: "Lote #9422 iniciado — 28 itens na fila." },
];

export const clientes: Cliente[] = [
  {
    id: "c1",
    nome: "Ricardo Albuquerque",
    telefone: "+55 11 98842-1234",
    valor: "R$ 2.450,00",
    vencimento: "15/06/2026",
    pdf: "Fatura_REF_0524.pdf",
  },
  {
    id: "c2",
    nome: "Mariana Santos Pereira",
    telefone: "+55 21 97721-5544",
    valor: "R$ 890,50",
    vencimento: "14/06/2026",
    pdf: "Fatura_REF_0525.pdf",
  },
  {
    id: "c3",
    nome: "Joaquim Ferreira Neto",
    telefone: "+55 11 2233-4455",
    valor: "R$ 157,00",
    vencimento: "12/06/2026",
    pdf: "—",
  },
  {
    id: "c4",
    nome: "Almeida Construções LTDA",
    telefone: "+55 19 99122-8877",
    valor: "R$ 4.520,00",
    vencimento: "18/06/2026",
    pdf: "Fatura_REF_0527.pdf",
  },
  {
    id: "c5",
    nome: "Beatriz Mendonça Cavalcanti",
    telefone: "+55 51 98413-7761",
    valor: "R$ 1.208,45",
    vencimento: "22/06/2026",
    pdf: "Fatura_REF_0529.pdf",
  },
  {
    id: "c6",
    nome: "Fernanda Lima Rocha",
    telefone: "+55 31 99553-2210",
    valor: "R$ 312,90",
    vencimento: "20/06/2026",
    pdf: "Fatura_REF_0528.pdf",
  },
];

export const importacao = {
  linhas: 128,
  casadas: 124,
  semPdf: 3,
  semTelefone: 1,
};

export type Mensagem = {
  id: string;
  de: "cliente" | "eu";
  texto: string;
  hora: string;
  anexo?: string;
};

export type Conversa = {
  id: string;
  nome: string;
  telefone: string;
  naoLidas: number;
  fixado?: boolean;
  mensagens: Mensagem[];
};

export const conversas: Conversa[] = [
  {
    id: "k1",
    nome: "Ricardo Albuquerque",
    telefone: "+55 11 98842-1234",
    naoLidas: 2,
    fixado: true,
    mensagens: [
      { id: "m1", de: "eu", texto: "Olá Ricardo! Segue a sua fatura com vencimento em 15/06.", hora: "14:02", anexo: "Fatura_REF_0524.pdf" },
      { id: "m2", de: "cliente", texto: "Recebi, obrigado! Consigo pagar no PIX?", hora: "14:10" },
      { id: "m3", de: "cliente", texto: "Também precisava da segunda via do mês passado.", hora: "14:11" },
    ],
  },
  {
    id: "k2",
    nome: "Mariana Santos Pereira",
    telefone: "+55 21 97721-5544",
    naoLidas: 1,
    mensagens: [
      { id: "m1", de: "eu", texto: "Boa tarde, Mariana. Fatura de junho anexada.", hora: "13:40", anexo: "Fatura_REF_0525.pdf" },
      { id: "m2", de: "cliente", texto: "O valor está diferente do combinado, pode conferir?", hora: "13:58" },
    ],
  },
  {
    id: "k3",
    nome: "Almeida Construções LTDA",
    telefone: "+55 19 99122-8877",
    naoLidas: 0,
    mensagens: [
      { id: "m1", de: "eu", texto: "Fatura de R$ 4.520,00 enviada, vencimento 18/06.", hora: "11:20", anexo: "Fatura_REF_0527.pdf" },
      { id: "m2", de: "cliente", texto: "Ok, encaminhei para o financeiro.", hora: "11:35" },
      { id: "m3", de: "eu", texto: "Perfeito, qualquer dúvida estou à disposição.", hora: "11:36" },
    ],
  },
  {
    id: "k4",
    nome: "Beatriz Mendonça Cavalcanti",
    telefone: "+55 51 98413-7761",
    naoLidas: 3,
    mensagens: [
      { id: "m1", de: "cliente", texto: "Oi! Ainda não recebi a fatura deste mês.", hora: "10:02" },
      { id: "m2", de: "cliente", texto: "Meu número mudou, esse aqui é o novo.", hora: "10:03" },
      { id: "m3", de: "cliente", texto: "Pode reenviar por favor?", hora: "10:05" },
    ],
  },
  {
    id: "k5",
    nome: "Fernanda Lima Rocha",
    telefone: "+55 31 99553-2210",
    naoLidas: 0,
    mensagens: [
      { id: "m1", de: "eu", texto: "Fernanda, sua fatura vence em 20/06.", hora: "Ontem", anexo: "Fatura_REF_0528.pdf" },
      { id: "m2", de: "cliente", texto: "Já paguei, segue o comprovante.", hora: "Ontem" },
    ],
  },
];
