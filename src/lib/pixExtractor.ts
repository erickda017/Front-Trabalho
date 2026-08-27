// ---------------------------------------------------------------------------
// Extração do Pix "copia e cola" -- 100% LOCAL (navegador), via QR Code.
// ---------------------------------------------------------------------------
//
// HISTÓRICO (por que este arquivo existe e como as tentativas anteriores
// falharam -- ver CONTEXTO.md pra mais detalhe):
//   1) Renderizar o PDF no backend (Render, pdfjs-dist) pra achar o Pix
//      estourava o limite de RAM do plano free (512MB) -- backend não pode
//      mais tocar em bytes de PDF.
//   2) Mandar a página fatiada pro Worker Cloudflare (`unpdf.extractImages`
//      + jsQR) nunca funcionou de forma confiável: `extractImages` só vê
//      imagens EMBUTIDAS no PDF -- quando o gerador do boleto desenha o QR
//      como VETOR (retângulos via operador de desenho, comum pra manter o
//      QR nítido em qualquer resolução de impressão), não existe "imagem"
//      nenhuma pra extrair e a busca sempre voltava vazia.
//   3) A solução que REALMENTE funciona: renderizar a página num <canvas>
//      no navegador (via pdfjs-dist) e rodar jsQR em cima do bitmap -- isso
//      não depende de como o QR foi desenhado no PDF (vetor ou imagem),
//      porque a essa altura já é só pixel.
//
// O QUE MUDOU NESTA REESCRITA (melhoria de lógica, não só "voltar a
// funcionar"):
//   - O Pix SEMPRE aparece no canto inferior direito das faturas testadas.
//     Em vez de renderizar a página inteira (caro) e depois recortar/varrer
//     em blocos, agora renderizamos DIRETO só o retângulo do canto (ver
//     `renderizarRegiaoDaPagina`) numa escala bem mais alta -- o canvas
//     alocado tem o tamanho do RECORTE, não da página inteira, então dá pra
//     usar resolução alta sem pagar o custo de uma página inteira nessa
//     mesma resolução. Isso resolve o caso comum em 1 render pequeno, sem
//     precisar mais do vaivém "tenta a página inteira, falhou, varre 12
//     blocos".
//   - Full-page + varredura em blocos continua existindo, mas só como
//     fallback pra boletos fora do padrão (layout diferente, Pix não achado
//     no canto) -- ver `extrairPixDaPagina`.
//   - Processamento em LOTES DE 10 PDFs por vez (`extrairPixEmLotes`), com
//     concorrência limitada dentro de cada lote e uma pequena pausa entre
//     lotes -- dá tempo do navegador liberar (GC) os canvases/ArrayBuffers
//     do lote anterior antes de abrir o próximo, em vez de acumular memória
//     de centenas de PDFs em voo ao mesmo tempo. Mesmo padrão já usado (e
//     comprovadamente estável) na extração manual em `routes/pix.tsx`.
//
// [2026-08] WEB WORKER: cada extração leva ~15-20s de CPU (vários renders
// em resolução alta + jsQR em blocos, ver `ALVOS_PX_CANTO`). Rodando na
// thread principal (como era até aqui), isso trava a página inteira pelo
// tempo todo -- cliques não respondem, scroll para. `extrairPixLocal`
// continua com a MESMA assinatura pública de sempre (recebe um `File|Blob`,
// devolve `ResultadoPix|null`), mas por dentro agora delega pro worker em
// `pixExtractor.worker.ts` (que roda a idêntica lógica de render+QR usando
// `OffscreenCanvas`, sem DOM) -- os 3 pontos do app que chamam essa função
// (`routes/pix.tsx`, `routes/supervisor.tsx`, `pixWorkerClient.ts`) não
// precisaram mudar nada. Um pequeno POOL de workers (2, ver
// `TAMANHO_POOL_WORKERS`) é criado na primeira chamada e reaproveitado
// entre extrações (`obterWorkerDoPool`), evitando o custo de subir/derrubar
// um worker novo a cada PDF. Se `Worker`/`OffscreenCanvas` não existir no
// ambiente (navegador muito antigo, ou algum contexto sem suporte), cai de
// volta pro caminho síncrono de sempre (`extrairPixLocalSincrono`), que
// continua aqui intacto como fallback -- por isso as funções de render/QR
// abaixo não foram removidas, mesmo com o worker cobrindo o caso comum.
//
// `pdfjs-dist` é importado dinamicamente (nunca no topo do módulo) porque
// este projeto roda com SSR (TanStack Start/Nitro) -- um import estático
// executaria `GlobalWorkerOptions.workerSrc = new URL(...)` durante o SSR,
// onde não existe `Worker`/DOM, derrubando a rota inteira. Import dinâmico +
// guard de `typeof document` garantem que só roda no navegador.

import jsQR from "jsqr";

// ---------------------------------------------------------------------
// Validação do payload Pix (EMV / BR Code)
// ---------------------------------------------------------------------

function crc16ccitt(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function isValidPixPayload(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  const payload = raw.trim();

  if (!payload.startsWith("000201")) return false;
  if (!payload.includes("br.gov.bcb.pix")) return false;

  const crcMatch = payload.match(/6304([0-9A-Fa-f]{4})$/);
  if (!crcMatch) return false;

  // crcMatch[1] sempre existe aqui: o grupo de captura "([0-9A-Fa-f]{4})" é
  // obrigatório no regex, então se crcMatch não é null o grupo bateu também.
  // TS não consegue provar isso sozinho (noUncheckedIndexedAccess).
  const providedCrc = crcMatch[1]!.toUpperCase();
  const payloadForCrc = payload.slice(0, payload.length - 4);
  return providedCrc === crc16ccitt(payloadForCrc);
}

// ---------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------

// O Pix está sempre numa das primeiras páginas (capa/1ª via) -- boletos
// giram em torno de 4 páginas, então cobre o documento inteiro sem gastar
// tempo à toa em casos fora da curva.
const MAX_PAGINAS_POR_PDF = 4;

const TIMEOUT_POR_PAGINA_MS = 20_000;

// Retângulo do canto inferior direito, em FRAÇÃO da página (0..1). Primeira
// tentativa: janela justa (onde o Pix normalmente está). Segunda tentativa:
// janela mais generosa, pra boletos com margens/layout um pouco diferentes.
// Em ambos os casos ainda é uma fração pequena da página inteira.
const REGIAO_CANTO_JUSTA = { x0: 0.45, y0: 0.55, x1: 1, y1: 1 };
const REGIAO_CANTO_AMPLA = { x0: 0.28, y0: 0.38, x1: 1, y1: 1 };
const REGIAO_PAGINA_INTEIRA = { x0: 0, y0: 0, x1: 1, y1: 1 };

// Maior lado do recorte renderizado, em pixels -- ver `ALVOS_PX_CANTO`
// abaixo pro motivo de ser uma LISTA de alvos, não um valor único.
//
// [2026-08] REESCRITO: boletos com o Pix e um segundo QR Code (propaganda/
// app da operadora) muito próximos, os dois dentro do mesmo recorte do
// canto -- caso comum e testado com boletos reais. Duas descobertas:
//
//   1) Com os dois QRs juntos na mesma imagem, jsQR (que só decodifica UM
//      código por chamada) pode "travar" no QR errado -- geralmente o de
//      propaganda, que é menos denso -- e a chamada nunca chega a tentar o
//      Pix. Resolvido tentando `escanearBlocos` (ver abaixo) sempre que a
//      leitura direta do recorte inteiro não devolver um Pix válido.
//
//   2) MAIS IMPORTANTE: reamostrar (resize) o canvas pra um alvoPx fixo via
//      `viewport scale` do pdfjs introduz suavização que, em QRs pequenos e
//      densos (payload Pix costuma ter 140+ caracteres = módulos bem
//      apertados), derruba a decodificação de forma inconsistente --
//      testado em boletos reais: um alvo que funciona num boleto falha
//      noutro, e não existe um valor único de alvoPx confiável (a faixa que
//      funciona também não é "quanto maior melhor": alvos MUITO altos
//      falham tanto quanto os muito baixos). Por isso `ALVOS_PX_CANTO` é uma
//      LISTA -- tentamos várias resoluções em sequência (inclui uma escala
//      "nativa", pedida como um alvo bem alto que na prática vira a
//      resolução real do PDF nessa região) até uma decodificar.
//
// [2026-08] REDUZIDO de 4 pra 2 alvos por região (e de 4 pra 2 no fallback
// de página inteira): testado com boletos reais, a leitura acerta sempre no
// primeiro alvo (1800px) ou no segundo -- os alvos extras (1200, 3000/3200)
// nunca foram necessários nesses casos e só adicionavam tempo de
// processamento (cada alvo a mais é outro render() completo do pdfjs +
// outra rodada de jsQR). Mantido UM alvo de segurança além do que já
// funcionou, não zero -- se aparecer um boleto de layout diferente que
// precise de mais tentativas, ainda há uma segunda chance antes de cair pro
// fallback de página inteira (que também foi enxugado, mesma lógica).
const ALVOS_PX_CANTO = [1800, 2600];
const ALVOS_PX_CANTO_AMPLO = [2200, 2800];
// Fallback de página inteira -- só entra se o canto (em nenhuma combinação
// de escala/blocos) achar nada. Mesma lógica de múltiplos alvos, mesmo
// corte de 4 pra 2.
const ALVOS_PX_PAGINA_INTEIRA = [1800, 2600];

// Varredura em blocos -- cobre boletos com mais de um QR Code na mesma
// região (QR de app/parceiro + Pix, o caso mais comum: os dois ficam
// próximos, no canto inferior direito, um acima do outro). Usada tanto
// dentro do recorte do canto (ver `extrairPixDaPagina`) quanto no fallback
// de página inteira. Ordem prioriza a última linha (fundo da página/
// recorte) primeiro, que é onde o Pix aparece com mais frequência. Overlap
// alto (0.4) porque blocos que cortam o QR bem na borda falham -- testado
// em boletos reais, blocos com pouca sobreposição frequentemente cortavam
// o QR do Pix ao meio.
const QR_TILE_COLS = 3;
const QR_TILE_ROWS = 4;
const QR_TILE_OVERLAP = 0.4;
const QR_TILE_MIN_DIMENSAO = 300;

// ---------------------------------------------------------------------
// Render local (pdfjs-dist)
// ---------------------------------------------------------------------

async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return pdfjsLib;
}

type RegiaoFracao = { x0: number; y0: number; x1: number; y1: number };

// Renderiza SÓ o retângulo pedido da página (em fração 0..1), numa escala
// calculada a partir do tamanho do PRÓPRIO RECORTE (não da página inteira)
// -- é isso que permite mirar alto (`alvoPx`) sem alocar um canvas do
// tamanho da página inteira: o canvas só tem o tamanho do recorte.
async function renderizarRegiaoDaPagina(
  pagina: any,
  regiao: RegiaoFracao,
  alvoPx: number,
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;

  const base = pagina.getViewport({ scale: 1 });
  const larguraRecortePt = base.width * (regiao.x1 - regiao.x0);
  const alturaRecortePt = base.height * (regiao.y1 - regiao.y0);
  const maiorLadoRecortePt = Math.max(larguraRecortePt, alturaRecortePt);
  const escala = Math.min(6, Math.max(0.5, alvoPx / Math.max(1, maiorLadoRecortePt)));

  const viewportCompleto = pagina.getViewport({ scale: escala });
  const x0 = viewportCompleto.width * regiao.x0;
  const y0 = viewportCompleto.height * regiao.y0;
  const x1 = viewportCompleto.width * regiao.x1;
  const y1 = viewportCompleto.height * regiao.y1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(x1 - x0));
  canvas.height = Math.max(1, Math.ceil(y1 - y0));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Fundo branco -- PDF com fundo transparente vira imagem preta sem isso,
  // e o jsQR fica ilegível.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Desloca a origem pra o recorte cair dentro do canvas pequeno (que só
  // tem o tamanho do recorte, não da página inteira).
  ctx.translate(-x0, -y0);

  await pagina.render({ canvasContext: ctx, viewport: viewportCompleto }).promise;
  return canvas;
}

function liberarCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

// ---------------------------------------------------------------------
// Leitura de QR
// ---------------------------------------------------------------------

function lerQrDoRetangulo(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): string | null {
  if (w < 20 || h < 20) return null;
  try {
    const imageData = ctx.getImageData(x0, y0, w, h);
    const resultado = jsQR(imageData.data, imageData.width, imageData.height);
    const payload = resultado?.data?.trim();
    return isValidPixPayload(payload) ? payload : null;
  } catch (err) {
    console.warn("[pixExtractor] jsQR falhou:", (err as Error).message);
    return null;
  }
}

function ordemDosBlocos(linhas: number, colunas: number): Array<[number, number]> {
  const ordemLinhas = [linhas - 1, ...Array.from({ length: linhas - 1 }, (_, i) => i)];
  const ordem: Array<[number, number]> = [];
  for (const linha of ordemLinhas) {
    for (let coluna = 0; coluna < colunas; coluna++) ordem.push([linha, coluna]);
  }
  return ordem;
}

// Varre o canvas (pode ser o recorte do canto OU a página inteira) em
// blocos sobrepostos -- usada sempre que o scan direto de corpo inteiro não
// achou um Pix válido. Separar em blocos é o que resolve o caso de DOIS QR
// Codes muito próximos na mesma imagem (ex: QR de propaganda + QR do Pix,
// um embaixo do outro no canto): jsQR só decodifica UM código por chamada,
// então com os dois juntos na mesma imagem ele pode "achar" o QR errado
// (geralmente o menos denso) e nunca chegar a tentar o outro. Isolando em
// blocos menores, cada QR fica sozinho na sua própria leitura.
function escanearBlocos(ctx: CanvasRenderingContext2D, width: number, height: number): string | null {
  if (width < QR_TILE_MIN_DIMENSAO || height < QR_TILE_MIN_DIMENSAO) return null;

  const tileWBase = width / QR_TILE_COLS;
  const tileHBase = height / QR_TILE_ROWS;

  for (const [linha, coluna] of ordemDosBlocos(QR_TILE_ROWS, QR_TILE_COLS)) {
    const x0 = Math.max(0, Math.floor(coluna * tileWBase - tileWBase * QR_TILE_OVERLAP));
    const y0 = Math.max(0, Math.floor(linha * tileHBase - tileHBase * QR_TILE_OVERLAP));
    const x1 = Math.min(width, Math.ceil((coluna + 1) * tileWBase + tileWBase * QR_TILE_OVERLAP));
    const y1 = Math.min(height, Math.ceil((linha + 1) * tileHBase + tileHBase * QR_TILE_OVERLAP));

    const pix = lerQrDoRetangulo(ctx, x0, y0, x1 - x0, y1 - y0);
    if (pix) return pix;
  }

  return null;
}

// ---------------------------------------------------------------------
// Extração por página / por PDF
// ---------------------------------------------------------------------

export type ResultadoPix = {
  pixCopiaCola: string;
  /** Página (1-based) onde o Pix foi encontrado. */
  pagina: number;
  /** De onde veio o resultado -- útil pra depurar/telemetria, não afeta o uso normal. */
  origem: "canto" | "canto-ampliado" | "pagina-inteira";
};

async function tentarRegiaoEmVariosAlvos(pagina: any, regiao: RegiaoFracao, alvos: number[]): Promise<string | null> {
  for (const alvoPx of alvos) {
    const canvas = await renderizarRegiaoDaPagina(pagina, regiao, alvoPx);
    if (!canvas) continue;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      liberarCanvas(canvas);
      continue;
    }

    let pix = lerQrDoRetangulo(ctx, 0, 0, canvas.width, canvas.height);
    if (!pix) pix = escanearBlocos(ctx, canvas.width, canvas.height);
    liberarCanvas(canvas);
    if (pix) return pix;
  }
  return null;
}

async function extrairPixDaPagina(pagina: any, indicePagina: number): Promise<ResultadoPix | null> {
  // 1) Canto inferior direito, janela justa -- caminho rápido, cobre a
  //    esmagadora maioria dos boletos (o Pix SEMPRE está nessa região).
  let pix = await tentarRegiaoEmVariosAlvos(pagina, REGIAO_CANTO_JUSTA, ALVOS_PX_CANTO);
  if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem: "canto" };

  // 2) Canto ampliado -- boletos com margens/layout um pouco diferentes.
  pix = await tentarRegiaoEmVariosAlvos(pagina, REGIAO_CANTO_AMPLA, ALVOS_PX_CANTO_AMPLO);
  if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem: "canto-ampliado" };

  // 3) Fallback: página inteira, vários alvos de resolução, com varredura
  //    em blocos se o scan direto não bater de primeira.
  pix = await tentarRegiaoEmVariosAlvos(pagina, REGIAO_PAGINA_INTEIRA, ALVOS_PX_PAGINA_INTEIRA);
  if (pix) return { pixCopiaCola: pix, pagina: indicePagina + 1, origem: "pagina-inteira" };

  return null;
}

function comTimeout<T>(promise: Promise<T>, ms: number, valorPadrao: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(valorPadrao), ms)),
  ]);
}

// Ponto de entrada síncrono (roda na thread atual) -- usado como FALLBACK
// quando Worker/OffscreenCanvas não existem no ambiente. Ver
// `extrairPixLocal` logo abaixo, que é o ponto de entrada público de
// verdade e tenta o worker primeiro.
async function extrairPixLocalSincrono(arquivo: File | Blob): Promise<ResultadoPix | null> {
  if (typeof document === "undefined") {
    console.warn("[pixExtractor] chamado fora do navegador (SSR?) -- ignorando.");
    return null;
  }

  let doc: any = null;
  try {
    const pdfjsLib = await carregarPdfjs();
    const buffer = await arquivo.arrayBuffer();
    doc = await pdfjsLib.getDocument({ data: buffer }).promise;

    const totalPaginas = Math.min(doc.numPages, MAX_PAGINAS_POR_PDF);
    for (let indice = 0; indice < totalPaginas; indice++) {
      let pagina: any = null;
      try {
        pagina = await doc.getPage(indice + 1);
        const resultado = await comTimeout(extrairPixDaPagina(pagina, indice), TIMEOUT_POR_PAGINA_MS, null);
        if (resultado) return resultado;
      } finally {
        if (pagina && typeof pagina.cleanup === "function") {
          try { pagina.cleanup(); } catch (_) { /* noop */ }
        }
      }
    }
    return null;
  } catch (err) {
    console.error("[pixExtractor] erro ao extrair Pix do PDF:", (err as Error).message);
    return null;
  } finally {
    if (doc) {
      if (typeof doc.cleanup === "function") {
        try { doc.cleanup(); } catch (_) { /* noop */ }
      }
      if (typeof doc.destroy === "function") {
        try { doc.destroy(); } catch (_) { /* noop */ }
      }
    }
  }
}

// ---------------------------------------------------------------------
// Orquestração do pool de Web Workers
// ---------------------------------------------------------------------
//
// [2026-08] POOL (não mais um único worker): com uploads grandes (a tela de
// Pix aceita até 100 PDFs de uma vez, processados em pacotes -- ver
// `routes/pix.tsx`), várias extrações rodam com concorrência real ao mesmo
// tempo. Um único worker compartilhado processa tudo em FILA (uma extração
// de cada vez, mesmo que 3-10 pedidos cheguem juntos) -- funciona (não trava
// a UI), mas não usa mais de um núcleo de CPU nunca, o que é desperdício em
// qualquer aparelho com mais de 1-2 núcleos livres. Um pool pequeno (2
// workers, round-robin) dá paralelismo real sem exagerar -- cada render de
// PDF já é pesado sozinho (múltiplos renders em resolução alta, ver
// `ALVOS_PX_CANTO`), então workers demais competindo por CPU só pioraria a
// latência de cada um; 2 é um meio-termo que ajuda em qualquer aparelho com
// 2+ núcleos livres sem arriscar saturar os mais fracos (ex: celular
// antigo). O tamanho do pool é limitado por `navigator.hardwareConcurrency`
// quando disponível, pra não criar mais workers do que núcleos existem.
//
// Cada pedido usa um `id` incremental (ainda único globalmente, não por
// worker) pra casar request/response -- o pool escolhe o próximo worker via
// round-robin simples (`proximoWorkerDoPool`), sem se importar com qual
// worker está mais/menos ocupado (round-robin simples já distribui bem o
// suficiente pro volume esperado aqui, e evita a complexidade de rastrear
// fila por worker).

type RespostaWorker =
  | { id: number; ok: true; resultado: ResultadoPix | null }
  | { id: number; ok: false; erro: string };

const TAMANHO_POOL_WORKERS = 2;

let poolDeWorkers: Worker[] = [];
let proximoWorkerDoPool = 0;
let proximoIdPedido = 1;
const pedidosPendentes = new Map<number, { resolve: (r: ResultadoPix | null) => void; reject: (e: Error) => void }>();

function suportaWorkerDeExtracao(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined"
  );
}

function tamanhoDesejadoDoPool(): number {
  const nucleos = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
  if (!nucleos || nucleos < 2) return 1; // aparelho com pouco núcleo -- não força paralelismo
  return Math.min(TAMANHO_POOL_WORKERS, nucleos - 1); // deixa 1 núcleo livre pra UI/resto do app
}

function criarWorkerDoPool(): Worker {
  // `new URL(..., import.meta.url)` + `{ type: "module" }` é o padrão do
  // Vite pra workers -- o bundler reconhece esse formato em build time e
  // empacota `pixExtractor.worker.ts` (com suas próprias dependências,
  // incluindo jsqr e pdfjs-dist) como um chunk separado. Cada worker do
  // pool importa esse MESMO chunk -- o navegador já cacheia o download, só
  // paga o custo de inicializar uma nova instância do módulo.
  const worker = new Worker(new URL("./pixExtractor.worker.ts", import.meta.url), { type: "module" });

  worker.onmessage = (evento: MessageEvent<RespostaWorker>) => {
    const resposta = evento.data;
    const pendente = pedidosPendentes.get(resposta.id);
    if (!pendente) return;
    pedidosPendentes.delete(resposta.id);
    if (resposta.ok) pendente.resolve(resposta.resultado);
    else pendente.reject(new Error(resposta.erro));
  };

  worker.onerror = (evento: ErrorEvent) => {
    // Erro no nível do worker (ex: falha ao carregar o módulo) -- não dá
    // pra saber qual pedido causou (podem ser vários, já que o worker
    // processa em fila), então rejeita todos os pendentes conhecidos e
    // derruba o pool inteiro pra próxima chamada recriar do zero. Mais
    // simples e seguro do que tentar rastrear "quais pedidos foram deste
    // worker especificamente" -- erro de worker é raro o bastante (falha de
    // carregar o chunk, etc.) pra não valer essa complexidade extra.
    console.error("[pixExtractor] worker do pool falhou:", evento.message);
    for (const pendente of pedidosPendentes.values()) {
      pendente.reject(new Error(evento.message || "worker de extração de Pix falhou"));
    }
    pedidosPendentes.clear();
    for (const w of poolDeWorkers) w.terminate();
    poolDeWorkers = [];
  };

  return worker;
}

function obterWorkerDoPool(): Worker {
  if (poolDeWorkers.length === 0) {
    const tamanho = tamanhoDesejadoDoPool();
    poolDeWorkers = Array.from({ length: tamanho }, () => criarWorkerDoPool());
  }
  const worker = poolDeWorkers[proximoWorkerDoPool % poolDeWorkers.length]!;
  proximoWorkerDoPool++;
  return worker;
}

function extrairPixViaWorker(arquivo: File | Blob): Promise<ResultadoPix | null> {
  return new Promise((resolve, reject) => {
    arquivo
      .arrayBuffer()
      .then((buffer) => {
        const worker = obterWorkerDoPool();
        const id = proximoIdPedido++;
        pedidosPendentes.set(id, { resolve, reject });
        // O ArrayBuffer é transferido (não copiado) pro worker -- mais
        // rápido pra PDFs grandes, mas isso "esvazia" o buffer original
        // nesta thread; como já lemos ele só pra esse propósito, não tem
        // problema.
        worker.postMessage({ id, buffer }, [buffer]);
      })
      .catch(reject);
  });
}

// Ponto de entrada PÚBLICO: extrai o Pix de UM PDF, 100% local. Tenta rodar
// no Web Worker (não trava a UI); se o ambiente não suportar Worker/
// OffscreenCanvas, ou se o worker falhar de forma inesperada, cai pro
// caminho síncrono de sempre.
export async function extrairPixLocal(arquivo: File | Blob): Promise<ResultadoPix | null> {
  if (typeof document === "undefined") {
    console.warn("[pixExtractor] chamado fora do navegador (SSR?) -- ignorando.");
    return null;
  }

  if (suportaWorkerDeExtracao()) {
    try {
      return await extrairPixViaWorker(arquivo);
    } catch (err) {
      console.warn(
        "[pixExtractor] worker falhou, caindo pro caminho síncrono:",
        (err as Error).message,
      );
      // segue pro fallback abaixo
    }
  }

  return extrairPixLocalSincrono(arquivo);
}

// ---------------------------------------------------------------------
// Processamento em lotes
// ---------------------------------------------------------------------

const TAMANHO_LOTE_PADRAO = 10;
const CONCORRENCIA_DENTRO_DO_LOTE = 3;

export type ItemParaExtrairPix = { arquivo: File | Blob; nomeArquivo?: string };

export type OpcoesExtracaoEmLotes = {
  tamanhoLote?: number;
  concorrencia?: number;
  onProgresso?: (p: { processados: number; total: number }) => void;
};

// Processa vários PDFs em LOTES DE 10 (por padrão): dentro de cada lote roda
// com concorrência limitada, e só abre o próximo lote quando o atual termina
// -- dá tempo do navegador liberar a memória dos canvases do lote anterior
// antes de começar o próximo, em vez de acumular tudo em voo de uma vez.
export async function extrairPixEmLotes(
  itens: ItemParaExtrairPix[],
  opcoes?: OpcoesExtracaoEmLotes,
): Promise<Array<ResultadoPix | null>> {
  const tamanhoLote = opcoes?.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const concorrencia = opcoes?.concorrencia ?? CONCORRENCIA_DENTRO_DO_LOTE;
  const resultados: Array<ResultadoPix | null> = new Array(itens.length).fill(null);

  for (let inicioLote = 0; inicioLote < itens.length; inicioLote += tamanhoLote) {
    const lote = itens.slice(inicioLote, inicioLote + tamanhoLote);

    let proximoNoLote = 0;
    async function worker() {
      while (proximoNoLote < lote.length) {
        const indiceNoLote = proximoNoLote++;
        const item = lote[indiceNoLote];
        if (!item) continue;
        try {
          resultados[inicioLote + indiceNoLote] = await extrairPixLocal(item.arquivo);
        } catch (err) {
          console.error(`[pixExtractor] falha ao processar "${item.nomeArquivo ?? "arquivo"}":`, (err as Error).message);
          resultados[inicioLote + indiceNoLote] = null;
        }
        opcoes?.onProgresso?.({ processados: inicioLote + indiceNoLote + 1, total: itens.length });
      }
    }

    await Promise.all(Array.from({ length: Math.min(concorrencia, lote.length) }, () => worker()));

    // Pausa curta entre lotes -- deixa o GC do navegador liberar os
    // canvases/ArrayBuffers do lote que acabou de terminar.
    if (inicioLote + tamanhoLote < itens.length) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return resultados;
}
