/**
 * Pix automático -- preenche a coluna COD PIX da planilha oficial com os Pix
 * extraídos no site (todos os operadores). Roda SÓ quando alguém clica
 * "Atualizar Pix na planilha" no site: o backend chama este script (publicado
 * como App da Web) mandando a lista de Pix.
 *
 * Instalação: ver LEIAME.md nesta mesma pasta.
 *
 * Regras (as mesmas do upload manual no site -- src/lib/casarPlanilhaPix.ts):
 *  - Abas: todas que tiverem cabeçalho com OS + CLIENTE + VENCIMENTO nas 15
 *    primeiras linhas. As outras (ex.: PROC) são ignoradas.
 *  - Coluna de Pix: "COD PIX"/"PIX"/... Se a coluna com esse nome tiver
 *    outro conteúdo (ex.: "PAGO 14-08"), ela NÃO é tocada e o Pix vai pra
 *    uma coluna "COD PIX" nova, na 1ª coluna vazia à direita do cabeçalho.
 *  - Casamento: 1º OS + vencimento + nome; 2º OS + vencimento (desde que
 *    não existam 2 Pix diferentes pra essa OS + vencimento). OS sozinha
 *    nunca basta. Na dúvida, fica vazio.
 *  - SÓ escreve em célula vazia. Não mexe em cor, borda, fórmula nem em
 *    nenhuma outra célula.
 *  - Tudo que foi preenchido vai pra aba "Log Pix".
 *
 * As funções de casamento (normalizar ... casarPixNaGrade) não usam nada do
 * Google -- são testadas em Node com a planilha real (ver
 * PixPlanilha.check.mjs).
 */

var LINHAS_PROCURA_CABECALHO = 15;
var NOME_ABA_LOG = 'Log Pix';

var COL_OS = [/^os$/, /^o s$/, /^n os$/, /^num(ero)? (da )?os$/, /^cod(igo)? os$/, /ordem( de)? servico/];
var COL_NOME = [/^cliente$/, /^nome$/, /^nome (do )?cliente$/, /^titular$/, /razao social/];
var COL_VENC = [/^vencimento$/, /^venc$/, /^dt venc/, /^data (de )?venc/, /^vencto$/];
var COL_PIX = [/^cod pix$/, /^pix$/, /codigo.*pix/, /chave.*pix/, /pix.*copia/];

function normalizar(v) {
  return String(v == null ? '' : v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "010/022067040" -> "22067040"
function chaveOs(v) {
  var s = String(v == null ? '' : v);
  if (typeof v === 'number') s = String(Math.round(v));
  var depois = s.indexOf('/') >= 0 ? s.slice(s.lastIndexOf('/') + 1) : s;
  return depois.replace(/\D/g, '').replace(/^0+/, '');
}

function nomeBate(nomePlanilha, e) {
  var alvo = normalizar(nomePlanilha).split(' ').filter(Boolean);
  return [e.nome, e.arquivo].some(function (fonte) {
    var n = normalizar(fonte).split(' ').filter(Boolean);
    var curto = n.length < alvo.length ? n : alvo;
    var longo = n.length < alvo.length ? alvo : n;
    return curto.length >= 2 && curto.every(function (p) { return longo.indexOf(p) >= 0; });
  });
}

function pareceCodigoPix(t) {
  return /^000201/.test(String(t).replace(/\s/g, ''));
}

function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

// "10/10/2026" / "2026-10-10" -> "2026-10-10"; inválida -> "".
function textoParaIso(t) {
  var s = String(t == null ? '' : t).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  var a, mes, d;
  if (m) { a = +m[1]; mes = +m[2]; d = +m[3]; } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
    if (!m) return '';
    d = +m[1]; mes = +m[2]; a = +m[3]; if (m[3].length === 2) a += 2000;
  }
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return '';
  return a + '-' + doisDigitos(mes) + '-' + doisDigitos(d);
}

// Célula de vencimento: Date (formatada como data na planilha), número
// (serial, dias desde 30/12/1899) ou texto. `dataParaIso` converte Date no
// fuso da PLANILHA (no Google: Utilities.formatDate).
function vencimentoDaCelula(v, dataParaIso) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : dataParaIso(v);
  if (typeof v === 'number') {
    var dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return dt.getUTCFullYear() + '-' + doisDigitos(dt.getUTCMonth() + 1) + '-' + doisDigitos(dt.getUTCDate());
  }
  return textoParaIso(v);
}

function acharColuna(cabecalho, regexes) {
  for (var i = 0; i < regexes.length; i++) {
    for (var c = 0; c < cabecalho.length; c++) if (regexes[i].test(cabecalho[c])) return c;
  }
  return -1;
}

function letraColuna(c) {
  var s = '';
  for (var n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function novoResumo(extracoes) {
  return {
    abas: [], puladas: [], linhas: 0, preenchidas: 0, jaTinhamPix: 0, semExtracao: 0, divergentes: 0,
    ocupadas: 0, extracoesRecebidas: extracoes.length, extracoesComOs: 0, detalhes: [], colunasRedirecionadas: [],
  };
}

function indexarPorOs(extracoes, resumo) {
  var porOs = {};
  extracoes.forEach(function (e) {
    var k = chaveOs(e.codigo);
    if (!k || !e.pix_code) return;
    (porOs[k] = porOs[k] || []).push(e);
    resumo.extracoesComOs++;
  });
  return porOs;
}

/**
 * Casa UMA aba. `valores` = sheet.getDataRange().getValues() (linha/coluna
 * 0-based). Devolve as escritas a fazer -- nada é escrito aqui:
 *   { r, c, valor, copiarFormatoDe?: { r, c } }
 */
function casarPixNaGrade(nomeAba, valores, porOs, resumo, dataParaIso) {
  var escritas = [];
  var totalLinhas = valores.length;
  var largura = valores.reduce(function (m, l) { return Math.max(m, l.length); }, 0);
  var texto = function (r, c) { var v = (valores[r] || [])[c]; return v == null ? '' : String(v).trim(); };

  var r0 = -1, cabecalho = [], colOs = -1, colNome = -1, colVenc = -1;
  var faltando = ['OS', 'CLIENTE', 'VENCIMENTO'];
  for (var r = 0; r < Math.min(totalLinhas, LINHAS_PROCURA_CABECALHO); r++) {
    var linha = [];
    for (var c = 0; c < largura; c++) linha[c] = normalizar((valores[r] || [])[c]);
    var o = acharColuna(linha, COL_OS), n = acharColuna(linha, COL_NOME), v = acharColuna(linha, COL_VENC);
    var falta = [o === -1 && 'OS', n === -1 && 'CLIENTE', v === -1 && 'VENCIMENTO'].filter(Boolean);
    if (!falta.length) { r0 = r; cabecalho = linha; colOs = o; colNome = n; colVenc = v; break; }
    if (falta.length < faltando.length) faltando = falta;
  }
  if (r0 === -1) {
    resumo.puladas.push({ aba: nomeAba, motivo: totalLinhas ? 'sem coluna ' + faltando.join(', ') : 'aba vazia' });
    return escritas;
  }

  // Entre as colunas com nome de Pix, usa a 1ª que só tem Pix (ou está
  // vazia). Assim a "COD PIX" criada numa execução anterior é reaproveitada,
  // em vez de criar outra coluna a cada mês. Coluna "de Pix" com outro texto
  // (ex.: "PAGO 14-08") nunca é usada.
  var colPix = -1, primeiraOcupada = -1;
  for (var cp = 0; cp < cabecalho.length && colPix === -1; cp++) {
    if (!COL_PIX.some(function (re) { return re.test(cabecalho[cp]); })) continue;
    var limpa = true;
    for (var r1 = r0 + 1; r1 < totalLinhas && limpa; r1++) {
      var t = texto(r1, cp);
      if (t && !pareceCodigoPix(t)) limpa = false;
    }
    if (limpa) colPix = cp; else if (primeiraOcupada === -1) primeiraOcupada = cp;
  }
  if (colPix === -1 && primeiraOcupada !== -1) {
    resumo.colunasRedirecionadas.push({ aba: nomeAba, de: letraColuna(primeiraOcupada), para: '' });
  }
  var colunaNova = colPix === -1;
  if (colunaNova) {
    var ultimo = 0;
    cabecalho.forEach(function (h, i) { if (h) ultimo = i; });
    colPix = ultimo + 1;
    var colunaVazia = function (col) {
      for (var rr = r0 + 1; rr < totalLinhas; rr++) if (texto(rr, col)) return false;
      return true;
    };
    while (!colunaVazia(colPix)) colPix++;
    escritas.push({ r: r0, c: colPix, valor: 'COD PIX', copiarFormatoDe: { r: r0, c: colPix - 1 } });
    resumo.colunasRedirecionadas.forEach(function (x) { if (x.aba === nomeAba && !x.para) x.para = letraColuna(colPix); });
  }
  resumo.abas.push(nomeAba);

  for (var rl = r0 + 1; rl < totalLinhas; rl++) {
    var linhaVals = valores[rl] || [];
    var os = chaveOs(linhaVals[colOs]);
    if (!os) continue;
    resumo.linhas++;
    var venc = vencimentoDaCelula(linhaVals[colVenc], dataParaIso);
    var nome = linhaVals[colNome];
    var detalhe = function (status, motivo) {
      resumo.detalhes.push({ aba: nomeAba, linha: rl + 1, os: os, cliente: String(nome == null ? '' : nome), vencimento: venc, status: status, motivo: motivo });
    };

    var atual = texto(rl, colPix);
    if (atual) {
      if (pareceCodigoPix(atual)) { resumo.jaTinhamPix++; detalhe('ja_tinha_pix', 'célula Pix já preenchida -- não sobrescreve'); }
      else { resumo.ocupadas++; detalhe('ocupada', 'célula Pix tem outro texto ("' + atual.slice(0, 40) + '") -- não sobrescreve'); }
      continue;
    }

    var candidatas = porOs[os];
    if (!candidatas) { resumo.semExtracao++; detalhe('sem_extracao', 'nenhum PDF extraído com essa OS no "Código"'); continue; }

    var mesmoVenc = venc ? candidatas.filter(function (e) { return textoParaIso(e.vencimento) === venc; }) : [];
    var porNome = null;
    for (var i = 0; i < mesmoVenc.length; i++) if (nomeBate(nome, mesmoVenc[i])) { porNome = mesmoVenc[i]; break; }
    var pixDistintos = {};
    mesmoVenc.forEach(function (e) { pixDistintos[e.pix_code] = true; });
    var qtdPix = Object.keys(pixDistintos).length;
    var certa = porNome || (qtdPix === 1 ? mesmoVenc[0] : null);
    var criterio = porNome ? 'OS + vencimento + nome' : 'OS + vencimento';

    if (!certa && qtdPix > 1) {
      resumo.divergentes++;
      detalhe('divergente', 'OS + vencimento batem com ' + qtdPix + ' PDFs de Pix diferentes e nenhum com o nome da planilha -- ambíguo');
      continue;
    }
    if (!certa) {
      resumo.divergentes++;
      var porque = candidatas.slice(0, 3).map(function (e) {
        var ev = textoParaIso(e.vencimento);
        return [
          !venc ? 'vencimento vazio/ilegível na planilha' : ev !== venc ? 'vencimento do PDF ' + (ev || 'não lido') : '',
          !nomeBate(nome, e) ? 'nome no PDF "' + (e.nome || e.arquivo || '?') + '"' : '',
        ].filter(Boolean).join(' e ');
      });
      detalhe('divergente', 'OS achada em ' + candidatas.length + ' PDF(s), mas: ' + porque.join(' | '));
      continue;
    }

    escritas.push(colunaNova
      ? { r: rl, c: colPix, valor: certa.pix_code, copiarFormatoDe: { r: rl, c: colPix - 1 } }
      : { r: rl, c: colPix, valor: certa.pix_code });
    resumo.preenchidas++;
    detalhe('preenchida', criterio + ' -- PDF "' + (certa.arquivo || certa.nome || '?') + '"');
  }
  return escritas;
}

/* ------------------------------------------------------------------------ */
/* Daqui pra baixo: só Google (SpreadsheetApp etc.)                          */
/* ------------------------------------------------------------------------ */

// [2026-10] No App da Web a planilha "ativa" e o fuso podem vir vazios
// (erro real: "Invalid argument: timeZone. Should be of type: String").
// O id da planilha é guardado no "Configurar chave" e o fuso tem fallback.
function planilha_() {
  var id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('planilha não encontrada -- abra a planilha e rode "Pix automático > Configurar chave" de novo');
  return ss;
}

function fusoDe_(ss) {
  var fuso = null;
  try { fuso = ss.getSpreadsheetTimeZone(); } catch (e) { /* segue pro fallback */ }
  if (!fuso) { try { fuso = Session.getScriptTimeZone(); } catch (e) { /* idem */ } }
  return fuso || 'America/Sao_Paulo';
}

function abasProcessaveis_(ss) {
  return ss.getSheets().filter(function (a) { return a.getName() !== NOME_ABA_LOG; });
}

// Processa UMA aba (o backend chama aba por aba, pra mostrar progresso no
// site). Depois de escrever, RELÊ as células e conta quantas ficaram mesmo
// com o Pix ("verificadas") -- é o "atualizou de verdade?".
function processarAba_(ss, aba, extracoes) {
  var fuso = fusoDe_(ss);
  var dataParaIso = function (d) { return Utilities.formatDate(d, fuso, 'yyyy-MM-dd'); };
  var resumo = novoResumo(extracoes);
  var porOs = indexarPorOs(extracoes, resumo);
  var nome = aba.getName();
  var valores = aba.getDataRange().getValues();
  var escritas = casarPixNaGrade(nome, valores, porOs, resumo, dataParaIso);
  var escritasPix = escritas.filter(function (w) { return w.valor !== 'COD PIX'; });
  resumo.escritas = 0;
  resumo.verificadas = 0;
  if (!escritas.length) return resumo;

  // Relê logo antes de escrever: célula preenchida por alguém nesse meio
  // tempo não é sobrescrita.
  var atuais = aba.getDataRange().getValues();
  var vazia = function (w) { var v = (atuais[w.r] || [])[w.c]; return v == null || String(v).trim() === ''; };
  var cabecalhoNovo = escritas.filter(function (w) { return w.valor === 'COD PIX' && w.copiarFormatoDe; })[0];
  if (cabecalhoNovo && vazia(cabecalhoNovo) && cabecalhoNovo.c > 0) {
    var nLinhas = Math.max(1, valores.length - cabecalhoNovo.r);
    aba.getRange(cabecalhoNovo.r + 1, cabecalhoNovo.c, nLinhas, 1)
      .copyTo(aba.getRange(cabecalhoNovo.r + 1, cabecalhoNovo.c + 1, nLinhas, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  // Linhas seguidas na mesma coluna viram 1 escrita só.
  var aEscrever = escritas.filter(vazia).sort(function (x, y) { return x.c - y.c || x.r - y.r; });
  for (var i = 0; i < aEscrever.length; ) {
    var j = i;
    while (j + 1 < aEscrever.length && aEscrever[j + 1].c === aEscrever[i].c && aEscrever[j + 1].r === aEscrever[j].r + 1) j++;
    var bloco = aEscrever.slice(i, j + 1).map(function (w) { return [w.valor]; });
    aba.getRange(aEscrever[i].r + 1, aEscrever[i].c + 1, bloco.length, 1).setValues(bloco);
    i = j + 1;
  }
  SpreadsheetApp.flush();

  var depois = aba.getDataRange().getValues();
  var escritosPix = aEscrever.filter(function (w) { return w.valor !== 'COD PIX'; });
  resumo.escritas = escritosPix.length;
  resumo.verificadas = escritosPix.filter(function (w) { return String((depois[w.r] || [])[w.c]) === w.valor; }).length;
  // Linhas que casaram mas a célula foi preenchida por outra pessoa no meio do caminho.
  resumo.puladasNaHora = escritasPix.length - escritosPix.length;

  if (resumo.verificadas) {
    var agora = new Date();
    var abaLog = ss.getSheetByName(NOME_ABA_LOG) || ss.insertSheet(NOME_ABA_LOG);
    if (abaLog.getLastRow() === 0) abaLog.appendRow(['Quando', 'Aba', 'Linha', 'OS', 'Cliente', 'Vencimento', 'Critério / PDF']);
    var linhas = resumo.detalhes
      .filter(function (d) { return d.status === 'preenchida'; })
      .map(function (d) { return [agora, d.aba, d.linha, d.os, d.cliente, d.vencimento, d.motivo]; });
    if (linhas.length) abaLog.getRange(abaLog.getLastRow() + 1, 1, linhas.length, linhas[0].length).setValues(linhas);
  }
  return resumo;
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Chamado pelo backend do site. Corpo: { chave, acao, ... }
//   acao "abas": lista as abas (o backend usa pra montar o progresso).
//   acao "aba":  { nome, extracoes } processa UMA aba.
function doPost(e) {
  var corpo;
  try { corpo = JSON.parse(e.postData.contents); } catch (err) { return responder_({ ok: false, erro: 'corpo inválido' }); }
  var chave = PropertiesService.getScriptProperties().getProperty('CHAVE');
  if (!chave) return responder_({ ok: false, erro: 'chave não configurada na planilha (menu Pix automático > Configurar chave)' });
  if (corpo.chave !== chave) return responder_({ ok: false, erro: 'chave inválida' });

  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(60000)) return responder_({ ok: false, erro: 'planilha ocupada com outra atualização -- tente de novo em 1 minuto' });
  try {
    var ss = planilha_();
    if (corpo.acao === 'abas') {
      return responder_({ ok: true, planilha: ss.getName(), abas: abasProcessaveis_(ss).map(function (a) { return { nome: a.getName(), linhas: a.getLastRow() }; }) });
    }
    if (corpo.acao === 'aba') {
      if (!Array.isArray(corpo.extracoes)) return responder_({ ok: false, erro: 'extracoes ausente' });
      var aba = ss.getSheetByName(corpo.nome);
      if (!aba) return responder_({ ok: false, erro: 'aba "' + corpo.nome + '" não existe mais' });
      return responder_({ ok: true, resumo: processarAba_(ss, aba, corpo.extracoes) });
    }
    return responder_({ ok: false, erro: 'acao desconhecida -- atualize o script da planilha (versão nova no LEIAME)' });
  } catch (err) {
    return responder_({ ok: false, erro: String(err && err.message || err) });
  } finally {
    trava.releaseLock();
  }
}

// Abrir o endereço do App da Web no navegador mostra isto (teste rápido).
function doGet() {
  var props = PropertiesService.getScriptProperties();
  return responder_({ ok: true, script: 'Pix automático', versao: 2, chaveConfigurada: !!props.getProperty('CHAVE'), planilhaVinculada: !!props.getProperty('PLANILHA_ID') });
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Pix automático')
    .addItem('Configurar chave', 'configurarChave')
    .addItem('Ver status', 'verStatus')
    .addToUi();
}

function configurarChave() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Pix automático', 'Cole a chave (a MESMA da variável PLANILHA_CHAVE_INTEGRACAO do Render):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var chave = r.getResponseText().trim();
  if (chave.length < 20) { ui.alert('Chave curta demais (mínimo 20 caracteres).'); return; }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('CHAVE', chave);
  props.setProperty('PLANILHA_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  ui.alert('Chave salva e planilha vinculada.');
}

function verStatus() {
  var props = PropertiesService.getScriptProperties();
  SpreadsheetApp.getUi().alert(
    'Chave configurada: ' + (props.getProperty('CHAVE') ? 'sim' : 'NÃO') +
    '\nPlanilha vinculada: ' + (props.getProperty('PLANILHA_ID') ? 'sim' : 'NÃO (rode Configurar chave)') +
    '\nFuso usado: ' + fusoDe_(planilha_()));
}
