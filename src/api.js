import { supabase } from './supabaseClient';
import { extrairDadosPixViaWorker } from './lib/pixWorkerClient';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3333/api';

// Origem "crua" do backend, sem o sufixo `/api` -- necessária pra montar a
// URL do proxy de arquivos (ver comentário grande logo abaixo). `BASE_URL`
// SEMPRE termina em `/api` por convenção do projeto (ver .env.example e
// CLAUDE.md), então isso é seguro.
const API_ORIGIN = BASE_URL.replace(/\/api\/?$/, '');

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

// [2026-08] PROXY DE ARQUIVOS: `pdf_url`/`anexo_url` que vêm da API não são
// mais links diretos pro Supabase Storage -- são paths relativos deste
// backend (ver Backend-Trabalho/src/routes/arquivos.routes.js), pensados
// pra esconder o domínio do Supabase da barra de endereço do navegador.
//
// Só que um `<a href="/api/arquivos/...">` ou `<img src="/api/arquivos/...">`
// comum NÃO funcionam pra isso: a rota exige `Authorization: Bearer
// <token>`, e nem navegação de link nem carregamento de `<img>`/`<audio>`
// conseguem anexar headers -- só `fetch` (chamado do JS) controla isso. Duas
// funções cobrem os dois jeitos de usar isso no app:
//
//   - `abrirArquivoProtegido(path)`: pra cliques que devem ABRIR o arquivo
//     numa nova aba (link "Ver PDF", documento no chat). Chamada num
//     onClick.
//   - `buscarBlobUrlProtegida(path)`: pra exibir o arquivo INLINE na própria
//     página (`<img src>`, `<audio src>` -- ex: miniatura de foto e player
//     de áudio no chat). Devolve a blob URL pronta; quem chama decide o que
//     fazer com ela (ver `MidiaProtegida` em routes/chat.tsx).
//
// Em ambos os casos a barra de endereço (se o usuário abrir em nova aba)
// mostra só "blob:https://seu-dominio/<uuid>", nunca o domínio do Supabase.
//
// `pdfUrlOuPath` pode ser:
//   - um path relativo (o formato novo, ex: "/api/arquivos/faturas/x.pdf")
//     -- é o caso normal a partir de agora.
//   - `null`/`undefined` -- ignorado silenciosamente (mesmo padrão que o
//     resto do app já usa pra "sem PDF ainda").
// Não aceita mais URL absoluta do Supabase como entrada válida -- se algum
// dado antigo em cache/estado local ainda tiver isso, a chamada ao backend
// (que é sempre relativa a BASE_URL) vai falhar de forma visível (erro
// tratado por quem chama) em vez de silenciosamente vazar a URL do Supabase
// de novo.

/** Busca o arquivo autenticado e devolve uma blob URL local pronta pra usar
 * em `src`/`href`. Quem chama é responsável por `URL.revokeObjectURL` se
 * quiser liberar a memória antes do componente desmontar (opcional -- o
 * navegador libera sozinho quando a página/aba fecha). */
/** Busca o arquivo autenticado e devolve o `Blob` cru -- pra quem vai
 * PROCESSAR o conteúdo (ex: reler o QR do Pix) em vez de exibir/baixar.
 * Mesmo padrão de auth de `buscarBlobUrlProtegida`, mas sem criar uma blob
 * URL (que só serve pra `src`/`href`, não pra passar pro extrator). */
export async function buscarBlobArquivoProtegido(pdfUrlOuPath) {
  if (!pdfUrlOuPath) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  // [bug corrigido] `pdfUrlOuPath` já vem com o prefixo `/api` embutido
  // (urlProxyArquivo, backend/src/lib/supabase.js: "/api/arquivos/...").
  // Concatenar com `BASE_URL` (que TAMBÉM termina em `/api`) gerava
  // "/api/api/arquivos/..." -- 404 em toda chamada, sempre, silenciosamente
  // engolido pelo try/catch de quem chamava (ex: "Rodar verificação" em
  // routes/pix.tsx, que por isso nunca baixava/renderizava PDF nenhum e só
  // parecia "rodar" sem achar nada). Usa a origem sem `/api` aqui.
  const res = await fetch(`${API_ORIGIN}${pdfUrlOuPath}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`falha ao baixar PDF (${res.status})`);
  return res.blob();
}

export async function buscarBlobUrlProtegida(pdfUrlOuPath) {
  const blob = await buscarBlobArquivoProtegido(pdfUrlOuPath);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export async function abrirArquivoProtegido(pdfUrlOuPath) {
  if (!pdfUrlOuPath) return;

  // Abre a aba ANTES do fetch (síncrono, na mesma pilha do clique) --
  // Safari/iOS bloqueia `window.open` chamado depois de um `await`, tratando
  // como pop-up não solicitado pelo usuário. Preenchemos essa aba com a
  // blob URL assim que o fetch terminar.
  const abaDestino = window.open('', '_blank');

  try {
    const blobUrl = await buscarBlobUrlProtegida(pdfUrlOuPath);

    if (abaDestino && !abaDestino.closed) {
      abaDestino.location.href = blobUrl;
    } else {
      // Pop-up bloqueado (usuário desabilitou, ou navegador antigo que não
      // segurou a referência) -- fallback: abre agora mesmo, ainda dentro
      // do fluxo do clique original.
      window.open(blobUrl, '_blank');
    }
    // Não revoga a blob URL aqui de propósito: a aba/visualizador de PDF
    // nativo do navegador pode continuar lendo o Blob por streaming
    // enquanto a aba estiver aberta. O navegador libera a memória sozinho
    // quando a aba fecha (ou, no pior caso, quando a aba principal recarrega).
  } catch (err) {
    if (abaDestino && !abaDestino.closed) abaDestino.close();
    throw err instanceof Error ? err : new Error('Não foi possível abrir o arquivo');
  }
}

export const api = {
  dashboard: {
    resumo: () => request('/dashboard/resumo'),
  },
  whatsapp: {
    // [2026-08] DOIS ZAPS: `slot` (1|2) volta a existir -- o backend já sabe
    // de quem é a sessão pelo token de autenticação, só falta dizer QUAL das
    // até 2 conexões desse usuário. Omitido, sempre vale slot 1 (comportamento
    // de antes, quando só existia 1 conexão por usuário).
    status: (slot) => request(`/whatsapp/status${slot ? `?slot=${slot}` : ''}`),
    statusAmbosSlots: () => request('/whatsapp/status-slots'),
    conectar: (slot) => request('/whatsapp/conectar', { method: 'POST', body: JSON.stringify({ slot }) }),
    desconectar: (slot) => request('/whatsapp/logout', { method: 'POST', body: JSON.stringify({ slot }) }),
  },
  // [2026-08] MULTI-TENANT: api.estrategia removida -- não existe mais
  // round-robin entre slots (cada usuário tem 1 WhatsApp só).
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
    // [2026-08] "Opção 2" de extração -- roda no BACKEND, 1 PDF por
    // requisição (ver backend/src/services/extratorServidorPix.js pro
    // porquê disso ser seguro em RAM). Usada como alternativa quando o
    // navegador não dá conta (aparelho fraco, muitos arquivos, sem suporte
    // a Worker) -- o padrão continua sendo extrairDadosPixViaWorker no
    // navegador. Quem chama deve mandar 1 arquivo por vez e esperar a
    // resposta antes do próximo -- é o que garante "uma por vez" de ponta a
    // ponta (ver src/routes/pix.tsx).
    extrairNoServidor: (file, { arquivo, clienteId } = {}) => {
      const formData = new FormData();
      formData.append('pdf', file, file.name);
      if (arquivo || file.name) formData.append('arquivo', arquivo || file.name);
      if (clienteId) formData.append('clienteId', clienteId);
      return request('/pix/extracoes/extrair-servidor', { method: 'POST', body: formData });
    },
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
    // [2026-08] "Upload de faturas avulsas, sem planilha" -- 1 PDF por
    // chamada. O back-end tenta casar pelo nome do arquivo com um cliente
    // já cadastrado (associado na hora); não achando, o PDF fica pendente
    // e a associação acontece sozinha quando o cliente certo for criado
    // depois (ver backend/src/lib/faturasPendentes.js).
    uploadAvulso: (file, dadosPixPrecalculado) => {
      const formData = new FormData();
      formData.append('pdf', file, file.name);
      if (dadosPixPrecalculado?.pixCopiaCola) formData.append('pixCode', dadosPixPrecalculado.pixCopiaCola);
      if (dadosPixPrecalculado?.valor) formData.append('valor', dadosPixPrecalculado.valor);
      if (dadosPixPrecalculado?.vencimento) formData.append('vencimento', dadosPixPrecalculado.vencimento);
      if (dadosPixPrecalculado?.linhaDigitavel) formData.append('linhaDigitavel', dadosPixPrecalculado.linhaDigitavel);
      return request('/faturas/avulsas', { method: 'POST', body: formData });
    },
    pendentes: {
      listar: () => request('/faturas/avulsas/pendentes'),
      associar: (id, clienteId) =>
        request(`/faturas/avulsas/pendentes/${id}/associar`, {
          method: 'POST',
          body: JSON.stringify({ cliente_id: clienteId }),
        }),
      remover: (id) => request(`/faturas/avulsas/pendentes/${id}`, { method: 'DELETE' }),
    },
  },
  // [2026-08] Ver CONTEXTO.md ("Safras (FPD/SPD) e histórico consolidado") e
  // README_CLAUDE_BACKEND.md seção 11. "Safra" não tem tabela própria de
  // dado operacional -- é uma visão sobre clientes agrupada por mês/ano de
  // data_prazo, mesmo espírito do objeto `faturas` acima.
  safras: {
    listar: () => request('/safras'),
    detalhe: (safra) => request(`/safras/${safra}`),
    consolidar: (safra) => request(`/safras/${safra}/consolidar`, { method: 'POST' }),
  },
  clientes: {
    listar: (params) => request(`/clientes${qs(params)}`),
    buscar: (id) => request(`/clientes/${id}`),
    criar: (payload) => request('/clientes', { method: 'POST', body: JSON.stringify(payload) }),
    atualizar: (id, payload) => request(`/clientes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remover: (id) => request(`/clientes/${id}`, { method: 'DELETE' }),
    historico: (id) => request(`/clientes/${id}/historico`),
    uploadPdf: async (id, file, dadosPixPrecalculado) => {
      // Nunca sobe um PDF "cru": fatia + extrai via Cloudflare Worker (+
      // fallback local de QR) no navegador ANTES de mandar o arquivo pro
      // back-end (que só guarda o PDF no Storage e persiste o que já veio
      // pronto -- ver backend/src/routes/clientes.routes.js, POST /:id/pdf).
      // `dadosPixPrecalculado`: passe o resultado de extrairDadosPixViaWorker
      // se já rodou antes (ex: fluxo do Extrator de PIX, que já extraiu pra
      // decidir a qual cliente associar) -- evita rodar o Worker/scan de QR
      // de novo pro mesmo arquivo. Omitido, extrai aqui mesmo (comportamento
      // original, usado pela tela de Clientes).
      const dadosPix = dadosPixPrecalculado !== undefined
        ? dadosPixPrecalculado
        : await extrairDadosPixViaWorker(file, file.name);
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
    // Vincula outro cliente (outro número) como o MESMO cliente -- PDF/pix/
    // valor/vencimento passam a valer pros dois (ver backend/migration-15).
    vincular: (id, outroId) => request(`/clientes/${id}/vincular/${outroId}`, { method: 'POST' }),
    desvincular: (id) => request(`/clientes/${id}/vincular`, { method: 'DELETE' }),
    // Grava só o Pix (sem PDF novo) -- usado pela "rodar verificação".
    atualizarPix: (id, pixCode) => request(`/clientes/${id}/pix`, { method: 'PATCH', body: JSON.stringify({ pixCode }) }),
    // [2026-08] "Importar clientes PAGOS" -- cola uma lista de nomes (1 por
    // linha), o back-end casa cada um com um cliente já cadastrado e marca
    // todos com a tag "Pago" (criada automaticamente, já como "não
    // dispara" -- ver backend/src/routes/clientes.routes.js).
    importarPagos: (texto) => request('/clientes/importar-pagos', { method: 'POST', body: JSON.stringify({ texto }) }),
    // Confirma a promoção FPD -> SPD sugerida (ver sugestoes_spd acima) --
    // `dataPrazo` opcional sobrescreve a data sugerida (formato YYYY-MM-DD).
    promoverSpd: (id, dataPrazo) => request(`/clientes/${id}/promover-spd`, { method: 'POST', body: JSON.stringify({ data_prazo: dataPrazo || undefined }) }),
    // [CRÍTICO] Roda a verificação de VENCIMENTO (não confundir com prazo) em
    // massa, lendo o PDF já anexado de cada cliente -- ver
    // backend/src/services/verificacaoVencimentos.js. `apenasPendentes=true`
    // (padrão) só processa quem ainda não tem vencimento; job roda em
    // background no servidor, consultar progresso via `statusVerificarVencimentos`.
    verificarVencimentos: (apenasPendentes = true) =>
      request('/clientes/verificar-vencimentos', { method: 'POST', body: JSON.stringify({ apenas_pendentes: apenasPendentes }) }),
    statusVerificarVencimentos: () => request('/clientes/verificar-vencimentos/status'),
  },
  perfil: {
    // Também traz nome/avatar_url além do papel (operador|supervisor, que
    // decide se o menu "Supervisor" aparece -- ver AppShell/app-state.tsx).
    me: () => request('/perfil/me'),
    // `foto`: File novo (substitui a atual) | null (não mexe na foto) |
    // "remover" (apaga a foto atual). `nome`: string | undefined (undefined
    // = não mexe no nome).
    atualizar: ({ nome, foto } = {}) => {
      const formData = new FormData();
      if (nome !== undefined) formData.append('nome', nome);
      if (foto === 'remover') formData.append('remover_foto', 'true');
      else if (foto instanceof File) formData.append('foto', foto);
      return request('/perfil/me', { method: 'PUT', body: formData });
    },
  },
  supervisor: {
    // Todas as rotas abaixo exigem role=supervisor no backend (ver
    // middleware/supervisor.js) -- 403 se chamadas por um operador comum.
    operadores: () => request('/supervisor/operadores'),
    clientes: (params) => request(`/supervisor/clientes${qs(params)}`),
    faturas: (params) => request(`/supervisor/faturas${qs(params)}`),
    disparos: (params) => request(`/supervisor/disparos${qs(params)}`),
    dashboard: () => request('/supervisor/dashboard'),
    // Lista enxuta (nome/telefone/pix/operador) de todo mundo com Pix já
    // cadastrado -- matéria-prima pro casamento por nome feito no navegador
    // (planilha de PIX e extrator pessoal, ver routes/supervisor.tsx).
    indicePix: () => request('/supervisor/indice-pix'),
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
    // clienteId null desvincula -- ver backend/src/routes/chat.routes.js.
    vincularCliente: (conversaId, clienteId) =>
      request(`/chat/conversas/${conversaId}/vincular-cliente`, {
        method: 'POST',
        body: JSON.stringify({ cliente_id: clienteId }),
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
