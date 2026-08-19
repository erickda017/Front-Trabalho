import { supabase } from './supabaseClient';
import { extrairDadosPixViaWorker } from './lib/pixWorkerClient';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3333/api';

async function request(path, options = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, { headers, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

/** Monta `?a=1&b=2` ignorando valores vazios/nulos. */
function qs(params) {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

/** Baixa um arquivo servido pela API (exportações CSV/XLSX, planilha modelo). */
async function download(path, fallbackName) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Não foi possível gerar o arquivo');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  dashboard: {
    resumo: () => request('/dashboard/resumo'),
  },
  whatsapp: {
    // Status agregado (compatibilidade com a versão de conexão única).
    status: () => request('/whatsapp/status'),
    logout: () => request('/whatsapp/logout', { method: 'POST' }),
    // Duas conexões independentes (slot 1 e slot 2).
    conexoes: () => request('/whatsapp/conexoes'),
    statusSlot: (slot) => request(`/whatsapp/conexoes/${slot}/status`),
    conectar: (slot) => request(`/whatsapp/conexoes/${slot}/conectar`, { method: 'POST' }),
    desconectar: (slot) => request(`/whatsapp/conexoes/${slot}/logout`, { method: 'POST' }),
  },
  estrategia: {
    buscar: () => request('/configuracoes/estrategia'),
    salvar: (payload) =>
      request('/configuracoes/estrategia', { method: 'PUT', body: JSON.stringify(payload) }),
  },
  configuracoes: {
    disparo: () => request('/configuracoes/disparo'),
  },
  pix: {
    listar: (params) => request(`/pix/extracoes${qs(params)}`),
    aplicarNoCliente: (id, clienteId) =>
      request(`/pix/extracoes/${id}/aplicar`, {
        method: 'POST',
        body: JSON.stringify({ cliente_id: clienteId }),
      }),
    exportar: (formato, params) =>
      download(
        `/pix/extracoes/exportar${qs({ ...(params || {}), formato })}`,
        `pix-extracoes.${formato}`,
      ),
  },
  // Fluxo novo do extrator de PIX: o PDF NUNCA é enviado ao back-end pra
  // processamento. O navegador (ver src/lib/pixWorkerClient.ts) fatia o PDF
  // e manda cada página pro Cloudflare Worker de OCR; aqui só mandamos o
  // resultado já pronto (JSON puro) pro back-end persistir.
  boletos: {
    // `arquivo` é opcional (usado pra casar com um cliente pelo nome quando
    // `clienteId` não é informado). Retorna a extração salva (ver
    // backend/src/routes/boletos.routes.js).
    salvarPix: ({ pixCopiaCola, valor, vencimento, linhaDigitavel, arquivo, clienteId }) =>
      request('/boletos/salvar-pix', {
        method: 'POST',
        body: JSON.stringify({ pixCopiaCola, valor, vencimento, linhaDigitavel, arquivo, clienteId }),
      }),
    // Processa 1 PDF inteiramente no navegador (fatia + chama o Worker) e
    // devolve o resultado, sem persistir nada -- quem chama decide o que
    // fazer com o resultado (salvar via salvarPix, mostrar na tela, etc).
    extrairDoPdf: (file) => extrairDadosPixViaWorker(file, file.name),
  },
  faturas: {
    listar: (params) => request(`/faturas${qs(params)}`),
    exportar: (formato, params) =>
      download(`/faturas/exportar${qs({ ...(params || {}), formato })}`, `faturas.${formato}`),
  },
  clientes: {
    listar: (params) => request(`/clientes${qs(params)}`),
    buscar: (id) => request(`/clientes/${id}`),
    criar: (payload) => request('/clientes', { method: 'POST', body: JSON.stringify(payload) }),
    atualizar: (id, payload) => request(`/clientes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remover: (id) => request(`/clientes/${id}`, { method: 'DELETE' }),
    historico: (id) => request(`/clientes/${id}/historico`),
    uploadPdf: async (id, file) => {
      // Nunca sobe um PDF "cru": fatia + extrai via Cloudflare Worker no
      // navegador ANTES de mandar o arquivo pro back-end (que só guarda o
      // PDF no Storage e persiste o que já veio pronto -- ver
      // backend/src/routes/clientes.routes.js, POST /:id/pdf).
      const dadosPix = await extrairDadosPixViaWorker(file, file.name);
      const formData = new FormData();
      formData.append('pdf', file);
      if (dadosPix?.pixCopiaCola) formData.append('pixCode', dadosPix.pixCopiaCola);
      if (dadosPix?.valor) formData.append('valor', dadosPix.valor);
      if (dadosPix?.vencimento) formData.append('vencimento', dadosPix.vencimento);
      if (dadosPix?.linhaDigitavel) formData.append('linhaDigitavel', dadosPix.linhaDigitavel);
      return request(`/clientes/${id}/pdf`, { method: 'POST', body: formData });
    },
    converterLista: (texto) => request('/clientes/converter-lista', { method: 'POST', body: JSON.stringify({ texto }) }),
    importarLista: (itens) => request('/clientes/importar-lista', { method: 'POST', body: JSON.stringify({ itens }) }),
  },
  importacao: {
    // [2026-08] Único fluxo suportado: recebe o resultado já processado no
    // navegador (parse de planilha/zip, fatiamento do PDF + extração de Pix
    // via Cloudflare Worker, upload dos PDFs pro Storage -- tudo em
    // src/lib/importacaoBrowser.ts). Manda só texto (nome, telefone, URLs,
    // código Pix, valor, vencimento, linha digitável), nunca PDF -- por isso
    // não pesa no servidor mesmo com 100+ clientes de uma vez. O antigo
    // POST /importacao (zip+PDF binário direto pro servidor) foi removido
    // (backend responde 410 Gone).
    enviarLote: ({ itens, mensagem, lote }) =>
      request('/importacao/lote', {
        method: 'POST',
        body: JSON.stringify({ itens, mensagem: mensagem || undefined, lote: lote || undefined }),
      }),
    // Repasse de 1 PDF já pronto pro Storage via backend (service_role, ignora
    // RLS) -- ver comentário na rota no backend pro motivo. O navegador ainda
    // faz o trabalho pesado (fatiar + Worker de OCR) antes de chamar isso.
    uploadPdf: ({ caminho, blob, nomeArquivo }) => {
      const formData = new FormData();
      formData.append('caminho', caminho);
      formData.append('pdf', blob, nomeArquivo);
      return request('/importacao/upload-pdf', { method: 'POST', body: formData });
    },
    baixarModelo: () => download('/importacao/modelo', 'modelo-importacao.xlsx'),
  },
  chat: {
    listarConversas: () => request('/chat/conversas'),
    listarMensagens: (conversaId) => request(`/chat/conversas/${conversaId}/mensagens`),
    marcarLida: (conversaId) => request(`/chat/conversas/${conversaId}/marcar-lida`, { method: 'POST' }),
    apagar: (conversaId) => request(`/chat/conversas/${conversaId}`, { method: 'DELETE' }),
    enviar: (conversaId, { mensagem, anexo }) => {
      const formData = new FormData();
      if (mensagem) formData.append('mensagem', mensagem);
      if (anexo) formData.append('anexo', anexo);
      return request(`/chat/conversas/${conversaId}/mensagens`, { method: 'POST', body: formData });
    },
    enviarFatura: (conversaId, modo) =>
      request(`/chat/conversas/${conversaId}/enviar-fatura`, {
        method: 'POST',
        body: JSON.stringify({ modo }),
      }),
  },
  tags: {
    listar: () => request('/tags'),
    criar: (payload) => request('/tags', { method: 'POST', body: JSON.stringify(payload) }),
    atualizar: (id, payload) => request(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remover: (id) => request(`/tags/${id}`, { method: 'DELETE' }),
    atribuir: (tagId, clienteId) => request(`/tags/${tagId}/clientes/${clienteId}`, { method: 'POST' }),
    remover_do_cliente: (tagId, clienteId) => request(`/tags/${tagId}/clientes/${clienteId}`, { method: 'DELETE' }),
  },
  respostasRapidas: {
    listar: () => request('/respostas-rapidas'),
    criar: (payload) => request('/respostas-rapidas', { method: 'POST', body: JSON.stringify(payload) }),
    atualizar: (id, payload) => request(`/respostas-rapidas/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remover: (id) => request(`/respostas-rapidas/${id}`, { method: 'DELETE' }),
  },
  envios: {
    criar: (payload) => request('/envios', { method: 'POST', body: JSON.stringify(payload) }),
    disparar: (id) => request(`/envios/${id}/disparar`, { method: 'POST' }),
    pausar: (id) => request(`/envios/${id}/pausar`, { method: 'POST' }),
    cancelar: (id) => request(`/envios/${id}/cancelar`, { method: 'POST' }),
    ativo: () => request('/envios/ativo'),
    reenviarErros: (id) => request(`/envios/${id}/reenviar-erros`, { method: 'POST' }),
    agendar: (id, agendado_para) => request(`/envios/${id}/agendar`, { method: 'PATCH', body: JSON.stringify({ agendado_para }) }),
    buscar: (id) => request(`/envios/${id}`),
    listar: (params) => request(`/envios${qs(params)}`),
    itens: (id, params) => request(`/envios/${id}/itens${qs(params)}`),
    progresso: (id) => request(`/envios/${id}/progresso`),
    exportar: (formato, params) =>
      download(`/envios/exportar${qs({ ...(params || {}), formato })}`, `historico.${formato}`),
    teste: (payload) => request('/envios/teste', { method: 'POST', body: JSON.stringify(payload) }),

  },
};
