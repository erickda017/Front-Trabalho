// Parsing de planilha + zip de PDFs no navegador -- espelha as mesmas duas
// funções que existiam no backend (server-side, removidas em 2026-08 -- ver
// backend/src/services/importLote.js) e backend/src/lib/telefone.js
// (normalizarTelefone), mantidos em paralelo de propósito: são funções puras
// pequenas, duplicar aqui evita ter que expor um pacote compartilhado só por
// causa de duas funções, e mantém front/back desacoplados no deploy.
import * as XLSX from "xlsx";
import JSZip from "jszip";

// Normaliza um telefone BR pro formato completo com código do país (ex:
// 5511999999999). Mesma regra do backend (telefone.js): decide pelo TAMANHO
// (10/11 dígitos = sem código do país), não por checar se já começa com "55",
// porque DDD 55 existe de verdade (Santa Maria/RS) e confundiria os dois casos.
export function normalizarTelefone(numero: string | number | null | undefined): string {
  const limpo = String(numero ?? "").replace(/\D/g, "");
  if (!limpo) return "";
  return limpo.length <= 11 ? `55${limpo}` : limpo;
}

function normalizar(str: string | null | undefined): string {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizarNomeArquivo(str: string | null | undefined): string {
  return normalizar(str)
    .replace(/\.pdf$/i, "")
    // trata hífen/underscore como espaço (slug "joao-silva" == nome "João Silva"),
    // e colapsa espaços repetidos -- sem isso, planilha com "arquivo" em slug só
    // casava quando o nome do PDF usava exatamente o mesmo separador.
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function acharColuna(linha: Record<string, unknown>, candidatos: string[]): unknown {
  const chaves = Object.keys(linha);
  for (const candidato of candidatos) {
    const encontrada = chaves.find((k) => normalizar(k) === normalizar(candidato));
    if (encontrada) return linha[encontrada];
  }
  return null;
}

export type LinhaPlanilha = {
  linha: number;
  numero: string;
  nome: string;
  arquivo: string;
  mensagem: string | null;
  valor: string | null;
  vencimento: string | null;
};

export async function parsePlanilha(arquivo: File): Promise<LinhaPlanilha[]> {
  const buffer = await arquivo.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const primeiraAba = workbook.SheetNames[0];
  if (!primeiraAba) return []; // planilha sem nenhuma aba -- nada pra importar
  const aba = workbook.Sheets[primeiraAba];
  if (!aba) return [];
  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(aba, { defval: "" });

  return linhas.map((linha, index) => {
    const numero = acharColuna(linha, ["numero", "número", "telefone", "whatsapp", "celular"]);
    const nome = acharColuna(linha, ["nome", "cliente"]);
    const arquivo = acharColuna(linha, ["arquivo", "pdf", "nome do arquivo", "arquivo pdf"]);
    const mensagem = acharColuna(linha, ["mensagem", "msg", "texto"]);
    const valor = acharColuna(linha, ["valor"]);
    const vencimento = acharColuna(linha, ["vencimento", "data de vencimento"]);

    return {
      linha: index + 2, // +2 pq linha 1 é o cabeçalho na planilha original
      numero: String(numero ?? "").trim(),
      nome: String(nome ?? "").trim(),
      arquivo: String(arquivo ?? "").trim(),
      mensagem: mensagem ? String(mensagem).trim() : null,
      // aceita "150,00" (padrão BR) além de "150.00"
      valor: valor ? String(valor).trim().replace(",", ".") : null,
      vencimento: vencimento ? String(vencimento).trim() : null,
    };
  });
}

export type PdfDoZip = {
  nomeOriginal: string;
  blob: Blob;
};

// mapa: nome normalizado -> { nomeOriginal, blob }
export async function extrairPdfsDoZip(arquivoZip: File): Promise<Map<string, PdfDoZip>> {
  const zip = await JSZip.loadAsync(arquivoZip);
  const mapa = new Map<string, PdfDoZip>();

  const entradas = Object.values(zip.files).filter(
    (entry) => !entry.dir && /\.pdf$/i.test(entry.name),
  );

  for (const entry of entradas) {
    const nomeArquivo = entry.name.split("/").pop() || entry.name; // ignora subpastas dentro do zip
    const blob = await entry.async("blob");
    mapa.set(normalizarNomeArquivo(nomeArquivo), { nomeOriginal: nomeArquivo, blob });
  }
  return mapa;
}

// Casa o PDF do zip com um cliente: 1) pelo nome exato da coluna "arquivo",
// 2) por fallback, pelo NOME do cliente -- mesmo critério do backend.
export function casarPdf(linha: LinhaPlanilha, pdfsPorNome: Map<string, PdfDoZip>): PdfDoZip | null {
  const chavePorArquivo = linha.arquivo ? normalizarNomeArquivo(linha.arquivo) : null;
  const chavePorNome = linha.nome ? normalizarNomeArquivo(linha.nome) : null;
  return (
    (chavePorArquivo && pdfsPorNome.get(chavePorArquivo)) ||
    (chavePorNome && pdfsPorNome.get(chavePorNome)) ||
    null
  );
}

// ==========================================================================
// Orquestração completa da importação client-side
// ==========================================================================
import { supabase } from "@/supabaseClient";
import { extrairDadosPixViaWorker } from "@/lib/pixWorkerClient";
import { api } from "@/api";

// Concorrência do processamento no navegador: cada item envolve fatiar o PDF
// (pdf-lib) + chamar o Worker de OCR pra cada página + upload pro Storage.
// Mesmo raciocínio do backend (CONCORRENCIA_IMPORTACAO): alto demais deixa a
// aba lenta (o fatiamento roda na thread principal do JS) e satura o Worker
// com requisições demais de uma vez. 2 dá um bom equilíbrio entre velocidade e
// responsividade da tela de progresso.
const CONCORRENCIA_BROWSER = 2;

export type ProgressoImportacao = {
  processados: number;
  total: number;
  etapa: string; // nome do cliente sendo processado agora, pra mostrar na UI
};

export type ItemLotePronto = {
  linha: number;
  numero: string;
  nome: string;
  valor: string | null;
  vencimento: string | null;
  linha_digitavel: string | null;
  mensagem: string | null;
  pdf_url: string | null;
  pdf_path: string | null;
  pix_code: string | null;
};

// Igual LinhaPlanilha, mas com o motivo real da falha -- pra UI não jogar
// erro de upload no mesmo balde de "sem nome/telefone".
export type LinhaComErro = LinhaPlanilha & { motivoErro: string };

// Sobe o PDF com retry -- só faz sentido re-tentar erro TRANSITÓRIO (rate
// limit, timeout, 5xx). Erro 4xx é permanente: bater 3x sem chance de dar
// certo só deixa a importação mais lenta.
//
// Passa pelo backend (POST /importacao/upload-pdf, service_role key) em vez de
// subir direto pro Storage com a sessão do usuário: o upload direto ficou
// bloqueado por RLS nesse projeto Supabase por uma causa que NÃO é do código
// (bucket, grants e a policy em si conferem -- Postgres nega mesmo assim,
// inclusive testado via SQL puro fora do supabase-js). O trabalho pesado
// (render do PDF em canvas + leitura de QR pra achar o Pix) continua 100% no
// navegador, só os bytes finais é que passam pelo backend agora -- não volta
// o problema de RAM que a migration-5 resolvia.
async function uploadComRetry(
  caminho: string,
  blob: Blob,
  nomeArquivo: string,
  tentativas = 3,
): Promise<{ error: { message: string; status?: number } | null; publicUrl?: string }> {
  let ultimoErro: { message: string; status?: number } | null = null;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      const resultado = await api.importacao.uploadPdf({ caminho, blob, nomeArquivo });
      return { error: null, publicUrl: resultado.publicUrl };
    } catch (err) {
      // api.js não expõe o status HTTP na exceção -- transitório vira sempre
      // "sem status" aqui, então sempre vale re-tentar (mais seguro: no pior
      // caso re-tenta um erro permanente 2x à toa, não perde PDF nenhum).
      ultimoErro = { message: err instanceof Error ? err.message : String(err) };
      console.error(`[importacao] upload falhou (tentativa ${tentativa}/${tentativas}) ${caminho}:`, err);
      if (tentativa < tentativas) await new Promise((r) => setTimeout(r, 800 * tentativa));
    }
  }
  return { error: ultimoErro };
}

// Roda `tarefa` para cada item de `itens`, no máximo `limite` em paralelo por vez.
// Mesmo padrão usado no backend (importLote.js) -- aqui evita travar a aba
// processando tudo de uma vez, sem abrir mão do ganho de rodar mais de 1 PDF
// por vez.
async function mapComConcorrencia<T, R>(
  itens: T[],
  limite: number,
  tarefa: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let proximo = 0;

  async function worker() {
    while (proximo < itens.length) {
      const indice = proximo++;
      const item = itens[indice];
      if (item === undefined) continue; // não deveria acontecer (indice < itens.length), guarda de tipo pro TS
      resultados[indice] = await tarefa(item, indice);
    }
  }

  const workers = Array.from({ length: Math.min(limite, itens.length) }, () => worker());
  await Promise.all(workers);
  return resultados;
}

// Processa a planilha + zip inteiramente no navegador: parse, casamento de PDF,
// extração de Pix e upload pro Storage. Retorna a lista de itens já prontos pra
// mandar pro backend (POST /api/importacao/lote) -- nesse ponto não sobra
// nenhum PDF binário pra enviar, só texto (URLs + código Pix já extraídos).
//
// `onProgresso` é chamado a cada item concluído, pra tela mostrar "processando
// X de Y" -- importante porque isso roda na máquina do usuário e pode levar
// alguns minutos com 100+ PDFs (o mesmo trabalho que antes travava o servidor
// silenciosamente agora acontece visivelmente na tela de quem importa).
export async function processarImportacaoNoBrowser(
  planilhaArquivo: File,
  zipArquivo: File,
  onProgresso?: (p: ProgressoImportacao) => void,
): Promise<{
  itens: ItemLotePronto[];
  linhasSemDados: LinhaPlanilha[];
  linhasComErroUpload: LinhaComErro[];
}> {
  // Falha rápido se não tiver sessão válida: o upload passa pelo endpoint
  // autenticado do backend (POST /importacao/upload-pdf), que exige o token
  // do Supabase Auth (middleware requireAuth) mesmo usando a service_role key
  // pro Storage por trás. Sem essa checagem aqui, o erro só aparece depois de
  // processar o lote inteiro (minutos, com PDFs renderizados à toa).
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error(
      "Sessão expirada ou não autenticada. Faça login novamente antes de importar (o upload de PDF exige usuário logado no Supabase).",
    );
  }

  const linhas = await parsePlanilha(planilhaArquivo);
  const pdfsPorNome = await extrairPdfsDoZip(zipArquivo);

  const itens: ItemLotePronto[] = [];
  const linhasSemDados: LinhaPlanilha[] = [];
  const linhasComErroUpload: LinhaComErro[] = [];
  let processados = 0;

  async function processarLinha(linha: LinhaPlanilha): Promise<void> {
    if (!linha.numero || !linha.nome) {
      linhasSemDados.push(linha);
      processados++;
      onProgresso?.({ processados, total: linhas.length, etapa: linha.nome || linha.numero || "linha sem dados" });
      return;
    }

    const telefoneNormalizado = normalizarTelefone(linha.numero);
    if (!telefoneNormalizado) {
      linhasSemDados.push({ ...linha });
      processados++;
      onProgresso?.({ processados, total: linhas.length, etapa: linha.nome });
      return;
    }

    const pdfEncontrado = casarPdf(linha, pdfsPorNome);

    if (!pdfEncontrado) {
      // Sem PDF casado: ainda manda pro backend como "semPdf" (mesmo
      // comportamento do fluxo antigo) -- não sobe nada no Storage.
      itens.push({
        linha: linha.linha,
        numero: linha.numero,
        nome: linha.nome,
        valor: linha.valor,
        vencimento: linha.vencimento,
        linha_digitavel: null,
        mensagem: linha.mensagem,
        pdf_url: null,
        pdf_path: null,
        pix_code: null,
      });
      processados++;
      onProgresso?.({ processados, total: linhas.length, etapa: linha.nome });
      return;
    }

    // Extrai os dados do Pix (via Worker, fatiando o PDF -- ver
    // pixWorkerClient.ts) ANTES do upload -- não depende do resultado do
    // upload, então rodam em paralelo (Promise.all) pra não somar os dois
    // tempos à toa.
    const caminho = `${telefoneNormalizado}/${Date.now()}-${pdfEncontrado.nomeOriginal}`;
    const [dadosPix, uploadResultado] = await Promise.all([
      extrairDadosPixViaWorker(pdfEncontrado.blob, pdfEncontrado.nomeOriginal),
      uploadComRetry(caminho, pdfEncontrado.blob, pdfEncontrado.nomeOriginal),
    ]);

    if (uploadResultado.error) {
      // motivo real do erro (backend loga o do Supabase) -- não cai mais
      // junto com "sem nome/telefone", que é outro problema.
      linhasComErroUpload.push({ ...linha, motivoErro: uploadResultado.error.message });
      processados++;
      onProgresso?.({ processados, total: linhas.length, etapa: linha.nome });
      return;
    }

    itens.push({
      linha: linha.linha,
      numero: linha.numero,
      nome: linha.nome,
      // planilha manda na frente; se a célula estiver vazia, usa o que o
      // Worker extraiu do próprio boleto (OCR).
      valor: linha.valor || dadosPix?.valor || null,
      vencimento: linha.vencimento || dadosPix?.vencimento || null,
      linha_digitavel: dadosPix?.linhaDigitavel || null,
      mensagem: linha.mensagem,
      pdf_url: uploadResultado.publicUrl ?? null,
      pdf_path: caminho,
      pix_code: dadosPix?.pixCopiaCola || null,
    });
    processados++;
    onProgresso?.({ processados, total: linhas.length, etapa: linha.nome });
  }

  await mapComConcorrencia(linhas, CONCORRENCIA_BROWSER, processarLinha);

  return { itens, linhasSemDados, linhasComErroUpload };
}
