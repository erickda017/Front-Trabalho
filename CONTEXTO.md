# CONTEXTO.md — Disparo de Faturas via WhatsApp

> ⚠️ **AVISO PARA QUALQUER IA (Claude, GPT, Copilot, etc.) trabalhando neste projeto:**
>
> Este arquivo existe pra dar contexto sólido e evitar retrabalho, regressões e
> "reinvenção" de features que já existem. **Toda IA que implementar uma feature nova,
> mudar uma regra de negócio, corrigir um bug não-trivial, ou alterar o formato de
> dados (banco, API, `.env`) DEVE atualizar este arquivo antes de terminar a tarefa.**
>
> Ao editar:
> - Adicione a feature/mudança na seção **"Funcionalidades implementadas"** (ou crie uma
>   subseção nova se for um módulo novo).
> - Se corrigir um bug importante, registre em **"Bugs corrigidos (histórico)"** com
>   data aproximada e causa raiz — isso evita que outra IA "corrija" o mesmo bug de
>   novo de um jeito diferente, ou reintroduza o bug original sem saber.
> - Se decidir NÃO implementar algo (e por quê), registre em **"Decisões e não-decisões"**.
> - Não apague o histórico de bugs corrigidos nem as decisões antigas — só adicione.
>
> Antes de começar qualquer tarefa, **leia este arquivo inteiro primeiro**. Ele é mais
> confiável que assumir como o sistema funciona a partir do nome dos arquivos.

---

## O que é o sistema

Ferramenta de uso pessoal para disparar faturas (PDF) via WhatsApp para uma lista de
clientes, com mensagem personalizada por pessoa. O WhatsApp usado é uma conta normal
conectada via QR Code (não é a API oficial da Meta) — ver seção de riscos abaixo.

Duas formas de gerar um disparo:
1. **Importação em massa**: sobe uma planilha (nome, telefone, nome do PDF, valor,
   vencimento, mensagem opcional) + um `.zip` com os PDFs. O sistema casa cada linha
   com o PDF certo pelo nome do arquivo, cadastra/atualiza os clientes e já monta o
   lote de disparo pronto pra iniciar.
2. **Cadastro manual**: cadastra cliente por cliente na aba Clientes, anexa PDF, e
   seleciona quem vai receber na aba Disparo.

## Stack

- **Frontend**: React 19 + Vite, 100% estático (SPA, `dist/` hospedável em qualquer
  CDN estática — Render Static Site, Vercel, Netlify, Cloudflare Pages). Sem SSR, sem
  servidor próprio. Autenticação via Supabase Auth (e-mail/senha).
- **Backend**: Node + Express + Baileys (`@whiskeysockets/baileys`, conecta no WhatsApp
  via QR Code, sem API oficial) + Supabase (Postgres pro banco, Storage pros PDFs).
  Roda no Render como Web Service. A sessão do WhatsApp é persistida na
  tabela `whatsapp_sessions` do Supabase (`backend/src/lib/
  supabaseAuthState.js`), não em disco — não precisa de Persistent Disk pra
  sobreviver a redeploys (era assim antes, mudou).
- **Banco**: Supabase Postgres. Schema em `backend/supabase-schema.sql` (idempotente,
  pode rodar de novo com segurança).

## Funcionalidades implementadas

- **Login** — Supabase Auth, e-mail/senha. Toda rota `/api/*` (exceto `/api/health`)
  exige `Authorization: Bearer <token>` válido (`backend/src/middleware/auth.js`).
  Usuário é criado manualmente no painel do Supabase (sem cadastro público).
- **Conexão WhatsApp via QR Code** — `backend/src/services/whatsapp.js`, usando Baileys.
  Status exposto em `GET /api/whatsapp/status` (`disconnected | connecting | qr |
  connected`), polling feito pelo frontend a cada 3s (`App.jsx`, no nível raiz — não
  dentro da aba Conexão — pra não "congelar" o badge/permissão de disparo se o usuário
  estiver em outra aba). Sessão persistida em disco (`WHATSAPP_SESSION_PATH`), sobrevive
  a reinícios. `POST /api/whatsapp/logout` desconecta e limpa a sessão, gerando um QR
  novo automaticamente (reinicia `startWhatsApp()` internamente).
- **Cadastro de clientes** — CRUD completo (`backend/src/routes/clientes.routes.js`):
  nome, telefone, valor, vencimento, PDF (upload separado, `POST /:id/pdf`, guardado no
  Supabase Storage bucket `faturas`). Telefone é normalizado (dígitos + código do país,
  ex: `5511999999999`) antes de salvar — ver `backend/src/lib/telefone.js`.
- **Importação em massa (planilha + zip)** — `backend/src/services/importLote.js`.
  Aceita `.xlsx`/`.xls`/`.csv`. Reconhece variações de nome de coluna (`numero`,
  `número`, `telefone`, `whatsapp`, `celular`; `nome`/`cliente`; etc — case/acento
  insensitive). Casa cada linha com o PDF do zip pelo nome do arquivo (ignora
  maiúsculas/acentos/extensão). Faz **upsert por telefone** (reimportar a mesma
  planilha atualiza em vez de duplicar). Linhas sem PDF ou sem nome/telefone ficam
  destacadas no resultado, sem travar o resto do lote. Já cria o `envio` (lote) pronto
  pra disparar, e o frontend navega automaticamente pra aba Disparo.
- **Fila/disparo de mensagens** — `backend/src/services/dispatchQueue.js`. Processa um
  `envio` por vez (lock em memória via `isRunning`), item a item:
  - Valida se o número existe no WhatsApp (`onWhatsApp`) antes de mandar — se não
    existir, marca `numero_invalido` (não tenta às cegas).
  - Delay aleatório entre mensagens (`MIN_DELAY_MS`/`MAX_DELAY_MS`).
  - Pausa longa a cada N mensagens (`BATCH_SIZE`/`BATCH_PAUSE_MS`) simulando
    comportamento humano.
  - Limite diário global (`DAILY_LIMIT`, soma de todos os envios) — ao atingir, o envio
    vira `pausado` com `retomar_em` = meia-noite (**horário de Brasília**, não do
    servidor — ver bug corrigido abaixo) e o scheduler retoma sozinho.
  - Erro inesperado no meio do disparo (ex: WhatsApp caiu) nunca deixa o envio travado
    em `em_andamento` pra sempre — vira `pausado` com `retomar_em: null` (retomada só
    manual, pelo botão "Retomar disparo").
  - `reenviarErros`: reprocessa só os itens com `status = 'erro'`, sem duplicar os que
    já foram enviados.
  - `recuperarEnviosTravados` (roda 1x na subida do servidor): se o processo morreu no
    meio de um disparo, o `envio` fica `em_andamento` no banco pra sempre (já que o
    lock em memória reseta ao reiniciar) — essa função volta esses envios pra
    `pendente`, sem risco de reenvio duplicado (só processa itens ainda `pendente`).
- **Agendamento** — campo "Agendar para" na aba Disparo. Envio fica `agendado`, o
  `scheduler.js` (`backend/src/services/scheduler.js`) checa a cada 1 minuto e dispara
  quando a hora chega. Mesmo loop também retoma envios `pausado` cujo `retomar_em` já
  passou.
- **Status de entrega/leitura + webhook** — Baileys emite `messages.update` com status
  numérico (2=entregue, 3=lido, 4=lido/áudio); o backend atualiza `envio_itens` em
  tempo real. Se `WEBHOOK_URL` estiver setado, dispara um POST (`backend/src/services/
  webhook.js`) pra cada evento relevante (disparo iniciado/concluído/pausado, mensagem
  enviada, entrega atualizada, número inválido, erro). Falha no webhook nunca quebra o
  fluxo principal (try/catch isolado).
- **Histórico por cliente** — `GET /api/clientes/:id/historico`, mostra todos os envios
  já feitos pra aquele telefone com status.
- **Frontend — abas**: Conexão, Importar, Clientes, Disparo (`frontend/src/App.jsx`).
  Estado de seleção de clientes (`selecionados`) e do lote importado (`loteImportado`)
  vivem no `App`, compartilhados entre abas Clientes/Disparo/Importar.
- **[2026-08] Pausar/cancelar um disparo em andamento** — botões na aba Disparo
  (`ProgressoDisparo`) e no painel de detalhes do lote na aba Histórico
  (`DetalhesLote`). `POST /envios/:id/pausar` (retomada só manual, depois pelo
  botão "Iniciar lote" — diferente da pausa automática por limite diário/queda
  de conexão) e `POST /envios/:id/cancelar` (interrompe de vez, não é
  retomável). Implementado em `backend/src/services/dispatchQueue.js`
  (`solicitarPausa`/`solicitarCancelamento`): se o envio está rodando NESTE
  processo, só sinaliza um `Set` em memória e o loop para com segurança depois
  do item atual (nunca no meio de um envio); se não está (ex: só está
  "em_andamento" no banco por causa de um crash anterior), mexe direto no
  banco. Cancelar também marca os itens ainda `pendente` desse envio como
  `cancelado` (novo status em `envio_itens.status`) — sem isso ficavam
  contando como "pendente" pra sempre no dashboard/histórico mesmo depois do
  lote ser interrompido.
- **[2026-08] Lote ativo sempre visível na aba Disparo** — `GET /envios/ativo`
  retorna o envio `em_andamento`/`pausado` mais recente direto do banco. A aba
  Disparo consulta isso no carregamento se não houver `envioAtivoId` guardado
  no `sessionStorage` da aba (perdido ao abrir uma aba/navegador novo, ou após
  o servidor cair e voltar) — antes disso um disparo real rodando no servidor
  ficava "invisível" pra quem abrisse o sistema de novo, só aparecia se a
  pessoa fosse manualmente procurar no Histórico.
- **[2026-08] Limite diário de disparo subido de 100 → 300** — `DAILY_LIMIT`
  em `dispatchQueue.js` e no `render.yaml` (os dois precisam ficar
  sincronizados: o `render.yaml` sobrescreve o default do código no deploy —
  ver bug corrigido abaixo).
- **[2026-08] Extrator de PIX suporta lotes grandes (até 400 PDFs / 800MB por
  requisição)** — `backend/src/routes/pix.routes.js` trocou
  `multer.memoryStorage()` por `diskStorage` (evita acumular todos os
  arquivos em RAM de uma vez, que arriscava derrubar o processo — o mesmo que
  segura a sessão do WhatsApp). Limites configuráveis
  (`PIX_MAX_ARQUIVOS`/`PIX_MAX_ARQUIVO_MB`/`PIX_MAX_TOTAL_MB`), mensagens de
  erro em PT-BR pros limites do multer, e limpeza garantida dos temporários em
  disco (`finally`). No frontend (`pix.tsx`), o upload agora é feito em lotes
  de 10 arquivos por vez (em vez de um único POST gigante) — isso dá barra de
  progresso real e contagem de sucesso/falha ao vivo, e um lote que falhar
  (timeout, queda de rede) não derruba o restante do envio.
- **[2026-08] Limpeza automática de faturas/boletos antigos (40 dias)** —
  `backend/src/services/limpezaAutomatica.js`, roda 1x por dia
  (`RETENCAO_FATURAS_DIAS`, default 40). Dois alvos: PDF anexado a um cliente
  (bucket `faturas`, contado a partir da nova coluna
  `clientes.pdf_atualizado_em` — ver migration-7) e boleto enviado pro
  Extrator de PIX (bucket `pix-extracoes`, contado a partir de
  `pix_extracoes.criado_em`). Remove do Storage e limpa/apaga a linha no
  banco; nunca apaga o cliente em si, só o PDF associado.

- **[2026-08] SUPERVISOR alinhado ao padrão do Dashboard do Operador** —
  `GET /api/supervisor/dashboard` (`backend/src/routes/supervisor.routes.js`)
  passou a devolver os mesmos blocos que o dashboard do operador já tinha
  (`dashboard.routes.js`), só que agregados de TODOS os operadores: "Faturas
  em valor" (`valor_medio`/`valor_total`/`faturas_com_valor`, via
  `resumoValoresGlobal()`) e o gráfico "Disparos por dia" dos últimos 7 dias
  (`serie_disparos_7dias`, via `serieDisparosGlobalPorDia()`) — mais os totais
  `enviados`/`falhas`/`pendentes` que já existiam por operador em
  `por_operador[]` mas não estavam somados no nível `totais`. No front
  (`frontend/src/routes/supervisor.tsx`), a aba Dashboard trocou o card de
  métrica caseiro (`CardMetrica`) pelo componente padrão `MetricCard` (mesmo
  do painel do operador, `components/shared/MetricCard.tsx`) e ganhou o
  gráfico (`recharts`, mesmo padrão de `routes/index.tsx`). As abas Clientes/
  Faturas/Disparos do Supervisor também passaram a seguir o mesmo padrão de
  estado do resto do sistema: erro com botão "Tentar novamente" (em vez de só
  mostrar a mensagem) e `EmptyState` no lugar da linha de tabela "Nenhum ...
  encontrado". A aba Clientes ganhou filtro "Com PDF"/"Sem PDF" (já existia em
  `GET /api/clientes` do operador, mas nunca tinha sido replicado em
  `GET /api/supervisor/clientes`) e uma coluna "PDF" na tabela.

- **[2026-09] Disparo "livre" (sem exigir PDF nem PIX)** — até aqui, montar um
  lote de disparo (`POST /api/envios`) sempre exigia que cada cliente tivesse
  PDF vinculado (modo padrão) ou PIX cadastrado (lote "só PIX", `enviar_pix:
  true`) — não tinha como mandar só a mensagem de texto pra cliente sem
  nenhum dos dois ainda cadastrado. Pedido explícito: às vezes o operador
  quer avisar/cobrar por texto antes mesmo de ter a fatura em mãos. Adicionado
  um terceiro modo de elegibilidade em `resolverClienteIds`
  (`backend/src/routes/envios.routes.js`), acionado por `livre: true` no
  body — todo cliente passa nesse filtro (os filtros de tag `permite_disparo`
  e `status_operador` bloqueando continuam valendo normalmente); se o
  cliente tiver PDF mesmo assim, ainda é anexado normalmente (só o modo
  "PIX" força texto puro pra todo mundo). No front (`routes/disparos.tsx`,
  "Configurações avançadas" → Anexo), o checkbox único "Enviar PDF da
  fatura" virou 3 opções (rádio): PDF / Só Pix / Livre.

- **[2026-09] [branch `feature/identificacao-por-contrato`, ainda não
  mergeada] Contrato como identificador principal nos "casamentos" por
  nome.** Todo fluxo que acha um cliente já cadastrado a partir de um texto/
  nome de arquivo (Importar Pagos, Extrator de PIX, upload de fatura avulsa)
  usava só o NOME e pegava o PRIMEIRO cliente que batesse -- dois clientes
  de mesmo nome (pessoas diferentes, contratos diferentes) tinham risco real
  de conflito (marcar o errado como pago, anexar o PDF/PIX de um na conta do
  outro). `backend/src/lib/nomeMatch.js` ganhou `casarCliente({ nome,
  arquivo, numeroContrato, clientes })`: contrato é o critério PRINCIPAL
  quando disponível (bate exato com `numero_contrato`, nem olha pro nome);
  nome só resolve sozinho se for inequívoco (exatamente 1 candidato) --
  ambíguo não adivinha mais, vira `status: 'ambiguo'`.
  `casarClientePorNome`/`casarClientePorArquivo` (usados por vários fluxos)
  viraram wrappers finos disso, mesma assinatura de sempre. `POST
  /clientes/importar-pagos` passou a extrair também o contrato do texto
  colado (`extrairNomesEContratosDeListaCrua`, nova em
  `lib/parseListaClientes.js` -- antes só `extrairNomesDeListaCrua`, que
  descartava o contrato) e usar `casarCliente` com ele; resposta ganhou
  `ambiguos` (nome bateu com 2+ clientes, sem contrato pra desempatar),
  mostrado separado de `nao_encontrados` no diálogo "Importar clientes
  pagos" (`routes/clientes.tsx`), orientando a recolar com o contrato.
  `lib/pixPersistencia.js` (`resolverClientePix`, usado pelo Extrator de PIX
  no servidor e por `POST /boletos/salvar-pix`) trocou `.limit(1)` (pegava
  qualquer um dos candidatos do ILIKE) por exigir exatamente 1 candidato.
  Frontend `lib/clienteMatch.ts` (espelho do backend, usado por Extrator de
  PIX e planilha de PIX do Supervisor) ganhou a mesma correção de
  ambiguidade. **Escopo desta rodada**: só os "casamentos" por nome -- a
  identidade do cliente no BANCO continua sendo `(usuario_id, telefone)`
  (upsert/duplicidade não mudou).

- **[2026-09] [branch `feature/identificacao-por-contrato`, ainda não
  mergeada] Rodada de correções a partir de auditoria técnica completa**
  (5 frentes: backend, banco de dados, frontend, UX/identidade,
  segurança/infra). Achados críticos e importantes corrigidos nesta rodada:
  - **Segurança**: proxy de arquivos (`arquivos.routes.js`) não conferia
    dono do path -- corrigido; upload de anexo do chat sem sanitizar nome
    de arquivo -- corrigido; rate limiting básico adicionado em toda a API
    (geral + limite apertado nas rotas de disparo/importação/upload); webhook
    de saída ganhou assinatura HMAC-SHA256 (`X-Webhook-Signature`).
  - **Banco de dados**: `numero_contrato` ganhou unique parcial por
    operador + `casarCliente` tratando duplicata de contrato como ambíguo
    (mesmo cuidado que já existia pra nome); `envio_itens.message_id`
    ganhou índice único parcial (hot path de status do WhatsApp); cascade
    delete de cliente agora registra em auditoria quantos
    `envio_itens`/`tratativas` foram junto (migration-22).
  - **Backend**: removido `lib/estrategia.js` (código morto e quebrado);
    wrapper de erro de upload (413 amigável) padronizado em
    clientes/faturasPendentes/chat, igual importacao/pix já tinham.
  - **Frontend**: `GET /clientes` agora pagina de verdade (`{itens, total}`)
    -- antes truncava silenciosamente acima de 1000; `api.d.ts` sincronizado
    com `api.js` (removidos 3 métodos fantasma, `api.chat.*` tipado
    corretamente com `Conversa`/`Mensagem` movidos pra `lib/types.ts`);
    removida rota órfã `/conexao` (modelo de 1 slot desatualizado,
    substituído por `/conexoes`).
  - **UX/produto -- maior gap encontrado**: não existia NENHUMA tela pro
    operador registrar a tratativa de cobrança, mesmo o backend
    (`qualidade.routes.js`/`lib/statusOperador.js`) já existindo inteiro
    desde a migration-20 e `status_operador` já bloqueando disparo. Nova
    tela **Qualidade** (`routes/qualidade.tsx`, menu "Gestão"): cards de
    resumo (carteira/fila/tocados/resolvidos/taxa de resolução), fila de
    trabalho paginada com busca e filtro por status, e diálogo "Registrar
    tratativa" (seletor de desfecho + observação + histórico de tratativas
    anteriores do cliente). Consome `GET /qualidade/status`, `/fila`,
    `/resumo`, `POST /:clienteId/tratativa`, `GET /:clienteId/historico` --
    todos já existentes, só sem cliente nenhum até agora.
  - **Identidade**: `package.json` (front) trocado de `tanstack_start_ts`
    pra `voxcel-faturas-front`; `README.md` reescrito (antes só falava do
    editor Lovable, sem mencionar o produto).
  - Corrigidos comentários desatualizados que ainda diziam "1 sessão de
    WhatsApp, slot removido" (o produto suporta 2 slots por operador desde
    a migration-13) em `lib/types.ts` e `api.js`.
  - **Não corrigido nesta rodada** (fora de escopo/maior risco, registrado
    como achado): ~10 erros de TypeScript pré-existentes em
    `pixWorkerClient.ts`/`historico.tsx`/`supervisor.tsx` (só ficaram
    visíveis depois que `npm install` completou o `node_modules`, que
    estava parcial); mensagem de erro crua do Postgres ainda vazando em
    boa parte das rotas (só o wrapper de upload foi padronizado); nice-to-
    haves de qualidade de código (duplicações menores, acessibilidade,
    testes automatizados, naming `created_at`/`criado_em` no banco).

## [2026-08] Safras (FPD/SPD) e histórico consolidado

Pedido: acompanhar clientes por "safra" mensal de 60 dias (primeira fatura + segunda
fatura), a partir da lista crua de clientes (mesmo formato já reconhecido por
`backend/src/lib/parseListaClientes.js`).

- **Regra de negócio**: a safra de um cliente é o **mês/ano da data de PRAZO** da
  fatura em acompanhamento (não o mês em que o cliente foi importado). Ex.: cliente
  com prazo 24/09/2026 pertence à safra "2026-09" ("Setembro/2026"), esteja ele sendo
  trabalhado em agosto ou setembro. FPD (Fatura 1) e SPD (Fatura 2) são as duas
  faturas de ~30 dias cada que, juntas, cobrem o ciclo de ~60 dias por cliente.
- **Parser (`backend/src/lib/parseListaClientes.js`) ampliado**: até essa mudança, a
  linha "Fatura N" e a data de prazo (formato real: depois do valor, uma linha
  "— DD/MM/AAAA") eram **descartadas silenciosamente** -- confirmado escrevendo um
  teste com o exemplo de dado real antes de mexer no código. Agora extrai
  `tipo_fatura` ("Fatura 1"→"FPD", "Fatura 2"→"SPD"), `data_prazo` (ISO,
  `YYYY-MM-DD`) e `numero_contrato` (a linha de dígitos logo após o nome, que já era
  parseada por posição mas nunca guardada). 100% retrocompatível: listas sem essas
  linhas continuam funcionando exatamente como antes (campos ficam `null`).
  **Decisão consciente**: não existe "data de contrato" separada em nenhum formato de
  lista crua observado até hoje (a linha de dígitos após o nome é um número
  identificador, não uma data) -- a coluna `data_contrato` foi reservada no schema
  pra um formato futuro que eventualmente traga isso, mas fica sempre `null` por
  enquanto. Não inventei um valor pra ela.
- **Schema (`migration-19-safras-faturas.sql`)**: `clientes` ganhou `tipo_fatura`
  ("FPD"|"SPD"|null), `data_prazo` (date), `numero_contrato` (text), `data_contrato`
  (date, reservado) e a coluna **gerada** `safra` (`to_char(data_prazo, 'YYYY-MM')`
  stored) -- gerada de propósito pra nunca ficar dessincronizada de `data_prazo` sem
  precisar de trigger. A coluna `vencimento` (texto livre, já usada em
  `{{vencimento}}` na mensagem) foi mantida como estava; `data_prazo` é a fonte de
  verdade nova para cálculo/filtro por data, `vencimento` continua sendo só exibição.
  Nova tabela `safras_historico` (1 linha por usuário+safra, upsert) guarda o
  snapshot permanente das métricas.
- **`POST /clientes/importar-lista` ampliado**: persiste os 4 campos novos no upsert
  e passou a também preencher `vencimento` (formatado `DD/MM/AAAA`) a partir de
  `data_prazo` -- esse fluxo nunca preenchia `vencimento`, então `{{vencimento}}` na
  mensagem ficava sempre vazio pra quem vinha da lista crua; agora fica preenchido.
- **`GET /clientes` ganhou os filtros `?safra=` e `?tipo_fatura=`** (mesmo padrão dos
  filtros existentes `com_pix`/`sem_pdf`/etc.). **`PUT /clientes/:id` também passou a
  aceitar `tipo_fatura`/`data_prazo`/`numero_contrato`/`data_contrato`** -- adicionados
  em `CAMPOS_FATURA` (`lib/faturaPropagacao.js`), então uma edição manual propaga pro
  grupo de números vinculados igual já acontecia com `valor`/`vencimento` (migration-15).
  `safra` nunca entra nesse allowlist -- é coluna gerada, um UPDATE nela falharia.
- **Métricas de safra (`backend/src/lib/safras.js`)**: "pagou" reaproveita a tag
  "Pago" que já existe (`POST /clientes/importar-pagos`) -- não é um status novo por
  baixo. "Recebeu disparo" reaproveita a mesma contagem de
  `envio_itens.status='enviado'` já usada em `GET /clientes`/dashboard. Só a linha
  principal de cada grupo de números vinculados conta (mesmo critério de
  `dashboard.routes.js`/`supervisor.routes.js`, migration-15), pra não contar a mesma
  pessoa 2x. Também calcula uma contagem simples de "duplicidade" (nomes idênticos
  normalizados dentro da mesma safra), como alerta pro operador -- não corrige nada
  sozinho.
- **`GET /safras`, `GET /safras/:safra`, `POST /safras/:safra/consolidar`**
  (`backend/src/routes/safras.routes.js`) -- "safra" não tem tabela operacional
  própria, é uma visão sobre `clientes` (mesmo espírito de `/faturas`, que também é
  uma visão sobre `clientes`). Ver contrato completo em `README_CLAUDE_BACKEND.md`,
  seção 11.
- **Consolidação automática (`iniciarConsolidacaoSafras`, chamada em `server.js`,
  mesmo padrão de `iniciarLimpezaAutomatica`)**: roda 1x/dia, grava (upsert) em
  `safras_historico` toda safra cujo mês de prazo já passou há mais de
  `SAFRA_DIAS_FOLGA_FECHAMENTO` dias (default 75 -- cobre o ciclo de ~60 dias
  FPD+SPD com folga). **Importante**: hoje o sistema **não apaga clientes** (só PDFs,
  ver `limpezaAutomatica.js` mais abaixo) -- então tecnicamente nada obrigava
  consolidar antes de uma exclusão que não existe. Decidi consolidar por TEMPO
  mesmo assim (não atrelado a nenhum evento de exclusão), pra que o histórico já
  fique protegido e disponível via `GET /safras` independentemente de qualquer
  mudança futura na política de retenção de `clientes` -- é a interpretação mais
  segura de "antes que esses dados sejam eliminados" dado que a exclusão de fato
  ainda não existe. Se um dia `clientes` passar a ser apagado de verdade, esse job
  já garante que a safra correspondente foi consolidada bem antes disso acontecer.
- **Frontend**: `src/lib/types.ts` ganhou os campos novos em `Cliente` + tipo
  `SafraResumo`; `src/api.js` ganhou `api.safras.*`; a tela `/importar` (conversor de
  lista crua) mostra as colunas "Fatura" e "Prazo" no preview; nova tela `/safras`
  (`src/routes/safras.tsx`, item de menu novo em `AppShell.tsx`) lista as safras com
  os totais acima, incluindo as já arquivadas (só no histórico).
- **Não fiz** (fora do escopo do pedido, risco desnecessário): não toquei em
  `services/importLote.js` (fluxo de planilha+zip) -- esse fluxo tem sua própria
  lógica de colunas (`nome`/`telefone`/`valor`/`vencimento`) e não recebe uma "lista
  crua" no formato que `parseListaClientes.js` entende; se um dia a planilha também
  precisar trazer fatura/prazo, dá pra reconhecer uma coluna `fatura`/`prazo`
  seguindo o mesmo padrão de `nome`/`telefone`, mas não implementei isso agora pra
  não arriscar regressão num fluxo já usado em produção sem necessidade.

### Ativação Chip (campanha nova, em paralelo à de cobrança) — 2026-09

- **O que é**: o sistema foi criado originalmente pra uma campanha de
  cobrança (disparo de fatura). Passou a rodar, EM PARALELO, uma segunda
  campanha -- ativação de chip da operadora -- com clientes, planilha,
  disparo e chat **separados** da carteira de cobrança que continua ativa. O
  mesmo telefone pode existir nas duas campanhas como cadastros distintos.
- **Arquitetura escolhida** (ver `docs/superpowers/specs/2026-09-10-ativacao-chip-design.md`
  no repo do backend): reaproveitar `clientes`/`envios`/`conversas` com uma
  coluna `campanha` (`'cobranca'` | `'chip_ativacao'`, default `'cobranca'`),
  em vez de tabelas paralelas dedicadas -- decisão consciente de menor
  mudança possível agora; uma migração mais robusta pode vir no futuro se o
  volume justificar. Ver `Backend-Trabalho/migration-25-ativacao-chip.sql`.
- **Banco**: `clientes` ganhou `campanha` + campos exclusivos de chip
  (`operadora`, `os_numero`, `cpf`, `cidade`, `bko_responsavel`, `vendedor`,
  `telefone_2`, `telefone_3` -- planilha de chip traz até 3 telefones por
  cliente). `conversas` ganhou `campanha`; o índice único de telefone (tanto
  em `clientes` quanto em `conversas`) passou a incluir `campanha` -- **todo
  upsert de `clientes` no código usa `onConflict: 'usuario_id,telefone,campanha'`**,
  nunca mais só `'usuario_id,telefone'`. `envios` ganhou `campanha`.
  `envio_itens` ganhou `telefone_usado` (qual dos 3 telefones respondeu de
  verdade no WhatsApp).
- **Disparo**: cliente de chip não tem PDF/Pix (conceitos que não existem
  nessa campanha) -- elegibilidade é sempre "livre". O disparo tenta
  `telefone` → `telefone_2` → `telefone_3` em sequência até achar um que
  exista no WhatsApp (ver `dispatchQueue.js`, `enviarItem`).
- **Chat**: como o mesmo telefone pode existir nas duas campanhas, uma
  mensagem de ENTRADA que não sabe de qual campanha é (WhatsApp não manda
  esse dado) cai na conversa com atividade mais recente entre as duas; sem
  nenhuma conversa ainda, a campanha nasce a partir do cadastro em `clientes`
  (só numa campanha = usa essa; nas duas ou nenhuma = `'cobranca'`, default
  seguro). Mensagem de SAÍDA (disparo ou resposta manual) sempre sabe a
  campanha de contexto, nunca ambígua. Ver `chatIngest.js`.
- **Status/tratativa de chip**: reaproveita a mesma tabela `tratativas` e
  coluna `clientes.status_operador` que a campanha de cobrança já usa (ver
  "Qualidade" abaixo), com vocabulário próprio em `src/lib/statusChip.js`
  (pendente / tentativa de contato / contato estabelecido / chip ativado /
  recusado / número inválido).
- **Rota nova**: `POST /api/ativacao-chip/importar` (planilha própria:
  OPERADORA, OS, CLIENTE, CPF, cidade, BKO, VENDEDOR, TEL 1/2/3, parse
  server-side via `services/importLoteChip.js` -- sem PDF/OCR envolvido,
  diferente do fluxo de fatura). `GET /api/ativacao-chip/status`,
  `POST/GET /api/ativacao-chip/clientes/:id/status` e `.../historico` pro
  status/tratativa. CRUD de clientes de chip reaproveita as rotas normais de
  `/api/clientes` (aceitam `?campanha=chip_ativacao`).
- **Frontend**: item de menu novo "Ativação Chip" (grupo próprio na
  sidebar) com duas telas: `/ativacao-chip` (listagem/gerenciamento +
  importar planilha + status, com seleção de linhas e um disparo simplificado
  de texto direto da tabela) e `/ativacao-chip/chat` (chat separado, mesma
  UI do `/chat` normal só sem "Enviar fatura" -- não existe PDF/Pix pra
  chip). A tela de **Disparos completa não foi estendida** pra chip nesta
  primeira leva: a seleção de clientes de lá é acoplada ao estado global
  `useAppState` (usado em várias telas) -- misturar campanhas ali seria um
  risco maior que o "por enquanto" pedido, então o disparo de chip vive como
  uma ação simples e isolada dentro da própria tela de Ativação Chip.
- **[CRÍTICO] Realtime do Chat**: como `conversas` agora carrega as duas
  campanhas, a subscription do Supabase Realtime em `routes/chat.tsx`
  (lista ao vivo de conversas) precisou ganhar um filtro
  `campanha=eq.cobranca` -- sem isso, uma conversa de chip vazaria pra
  dentro da lista de chat de cobrança em tempo real. `ativacao-chip.chat.tsx`
  tem o filtro espelhado (`campanha=eq.chip_ativacao`).

### Painel de Exclusão em massa (só supervisor) — 2026-09

- **O que é**: aba nova "Exclusão" em `/supervisor` (só quem tem
  `role=supervisor`) pra apagar em massa, por critério, em vez de 1 registro
  de cada vez. Pedido explícito: "apagar um grupo de PDFs... deve aparecer
  em lista oque mais está ocupando espaço no banco... apagar esse grupo de
  PDFs de tal safra ou FPD ou SPD ou pagos ou deletar histórico de
  mensagens". Ver
  `Backend-Trabalho/docs/superpowers/specs/2026-09-10-painel-exclusao-design.md`.
- **Medição de espaço**: por CONTAGEM de linhas/arquivos (não bytes reais —
  o sistema nunca guardou tamanho de arquivo em byte nenhum lugar, e somar
  via Storage API sob demanda seria lento). `GET /api/supervisor/exclusao/resumo`
  varre 4 critérios com um filtro natural cada e devolve tudo numa lista só,
  ordenada do maior pro menor.
- **4 critérios (v1)**, cada um com escopo de exclusão diferente:
  `pdfs_por_safra`/`pdfs_por_tipo_fatura` (só o ARQUIVO some,
  `pdf_path`/`pdf_url`/`pdf_atualizado_em` viram null — cliente sobrevive,
  mesmo efeito da limpeza automática de 40 dias só que sob demanda);
  `clientes_por_tag` (cliente INTEIRO, cascade já existente cuida de
  `envio_itens`/`tratativas`/`cliente_tags` — casa por NOME da tag,
  case-insensitive, cobrindo todos os operadores de uma vez);
  `historico_mensagens` (conversas inteiras, mensagens cascadeiam — filtro
  por campanha cobrança/ativação chip + idade opcional). Catálogo em
  `Backend-Trabalho/src/lib/exclusaoCriterios.js`.
- **Salvaguardas obrigatórias** (ação irreversível em massa): preview
  sempre antes (`POST /:criterio/preview`, nunca apaga nada, mostra
  contagem exata + amostra de até 5 itens); confirmação por texto — precisa
  digitar literalmente "APAGAR", validado tanto no frontend quanto **no
  backend** (`POST /:criterio/executar` rejeita qualquer outra coisa em
  `confirmacao`); auditoria em `auditoria_exclusoes` com **uma linha resumo
  por operação** (não uma por item apagado, pra não inundar a tabela numa
  exclusão de milhares de linhas) — `{criterio, filtro, total_apagado,
  amostra_ids}`.
- **Acesso**: só supervisor (`requireSupervisor`, mesmo middleware de
  `/api/supervisor/*`) — decisão consciente do brainstorm, dado o risco de
  uma ação destrutiva em massa; operador comum não vê a aba nem tem acesso
  à rota.
- **Frontend**: componente próprio
  `Front-Trabalho/src/components/supervisor/PainelExclusao.tsx` (não dentro
  de `routes/supervisor.tsx`, que já estava grande) — lista "o que mais
  ocupa espaço" clicável + formulário manual pra um filtro que não apareceu
  na lista, os dois levando ao mesmo fluxo de preview → digitar "APAGAR" →
  confirmar.

## Bugs corrigidos (histórico)

> Formato: **[data aproximada] título** — sintoma, causa raiz, arquivo(s) tocado(s).

- **[2026-09] Extração de PIX falhava (sem erro nenhum) em boletos cuja
  página é uma imagem rasterizada de baixa resolução -- não tem fix de
  scanner que resolva, só entrada manual.** Reportado: um boleto real
  (Claro/NET) tinha o Pix visível a olho nu mas a extração automática
  nunca achava. Investigado renderizando a página em várias resoluções/
  regiões e testando o algoritmo real (`pixExtractor.ts`, incluindo a
  varredura em blocos) contra o PDF -- a causa raiz NÃO é bug no código de
  scan: `pagina.getOperatorList()` mostrou que a página 2 desse PDF é UMA
  ÚNICA imagem embutida (`paintImageXObject`, ~1190x1682px cobrindo a
  página inteira -- a fatura inteira é uma "foto", sem texto/vetor real),
  e dentro dela o QR do Pix ocupa uns ~150x150px nativos -- menos de 3px
  por módulo pra um QR denso (payload Pix tem 140+ caracteres). Testado
  exaustivamente: renderizar em resolução mais alta (até 9000px de alvo),
  desligar suavização (`imageSmoothingEnabled=false`) e até binarização
  Otsu manual antes do jsQR -- nada recupera, porque a informação já não
  existe nos pixels de origem (é upscale do mesmo raster de baixa
  resolução, não tem detalhe novo pra "descobrir"). Improvável ser bug
  isolado desse boleto -- é decisão do gerador de fatura desse operador
  (rasterizar a página inteira), deve se repetir em outras faturas do
  mesmo template. Não dá pra "corrigir" a extração automática nesse caso
  (o dado realmente não é recuperável do PDF), então em vez disso:
  adicionado um jeito de colar a chave PIX manualmente na ficha do cliente
  (`ChavePix` em `src/routes/clientes.tsx`, reusa o `PATCH /clientes/:id/pix`
  que já existia pra "rodar verificação" -- não precisou de rota nova) e um
  aviso explicando o motivo quando um lote de extração termina com falhas
  (`src/routes/pix.tsx`), pra não parecer bug toda vez que isso se repetir.

- **[2026-09] "Chat" da Ativação Chip abria e mostrava a lista de clientes
  em vez do chat dedicado.** Causa raiz: `src/routes/ativacao-chip.tsx` e
  `src/routes/ativacao-chip.chat.tsx` compartilham o prefixo
  `ativacao-chip` no nome do arquivo, e no roteamento por arquivos do
  TanStack Router isso automaticamente torna `/ativacao-chip/chat` uma rota
  FILHA de `/ativacao-chip` (nesting implícito por convenção de nome, não
  precisa configurar nada explicitamente). `ativacao-chip.tsx`, porém,
  continha a página inteira da lista de clientes e nunca renderizava um
  `<Outlet/>` -- e sem `<Outlet/>` no componente pai, o Router nunca chega a
  montar o componente da rota filha, pra NENHUM caminho abaixo de
  `/ativacao-chip`. Resultado: clicar em "Chat" no menu sempre mostrava a
  mesma lista de clientes, porque o componente do chat dedicado
  (`ChatAtivacaoChip`) nunca era renderizado. Corrigido separando em dois
  arquivos: `ativacao-chip.tsx` virou um layout puro (só
  `component: () => <Outlet/>`), e a página da lista de clientes (conteúdo
  antigo) foi movida pra `ativacao-chip.index.tsx` (rota índice
  `/ativacao-chip/`) -- `ativacao-chip.chat.tsx` não mudou, só passou a
  renderizar de verdade agora que o pai tem `<Outlet/>`.

- **[2026-09] Painel de Exclusão podia deixar PDF órfão no Storage sem
  avisar (relatado: Storage size não caía depois de apagar).** Se a chamada
  ao Storage pra remover o arquivo falhasse por qualquer motivo (rede,
  permissão pontual), o código mesmo assim limpava `pdf_path` do cliente no
  banco logo em seguida -- perdendo a única referência que permitiria achar
  aquele arquivo de novo. O operador via "sucesso" (N clientes apagados) sem
  saber que o espaço não foi liberado de verdade. Corrigido em
  `backend/src/lib/exclusaoCriterios.js`: `removerDoStorageEmLotes` agora
  devolve quais caminhos falharam, e `apagarPdfsDeClientes` só limpa
  `pdf_path` de quem teve o arquivo CONFIRMADAMENTE removido -- cliente com
  falha continua com o ponteiro intacto (reaparece no próximo preview/
  execução em vez de virar órfão irrastreável). Os outros dois critérios
  (`clientes_por_tag`, `historico_mensagens`) continuam apagando a
  linha/conversa mesmo com falha isolada no Storage (é o propósito deles),
  mas agora logam alto quando isso acontece.

- **[2026-09] (continuação do bug acima) Fix anterior não bastou -- Storage
  falhava SEM devolver erro nenhum.** Depois do fix acima, o usuário ainda
  relatou que TODOS os PDFs continuavam no bucket após usar o painel.
  Causa raiz mais funda: `removerDoStorageEmLotes` só considerava falha
  quando a API do Supabase devolvia `error` preenchido -- só que a API pode
  devolver `error: null` e mesmo assim não remover nada (não erra pra
  "arquivo não encontrado" nem pra alguns cenários de permissão, só
  devolve em `data` a lista do que FOI removido de verdade). Corrigido:
  agora compara o tamanho de `data` com o do lote pedido -- qualquer
  diferença, mesmo sem erro, conta como falha (loga um "ATENÇÃO" nos logs
  do Render). Também adicionado
  `GET /api/supervisor/exclusao/diagnostico-storage` (botão "Rodar
  diagnóstico" na própria aba Exclusão) -- sobe + tenta apagar um arquivo
  de teste descartável (nunca toca em fatura real) e mostra o resultado
  cru de cada etapa, pra isolar upload vs. remoção vs. bucket errado sem
  precisar de acesso externo ao Supabase.

- **[2026-09] Converter lista crua descartava cliente inteiro quando cada
  campo vinha em linha separada por linha em branco.** Listas coladas direto
  de PDF/relatório (ex.: nome, linha em branco, número de contrato, linha em
  branco, "CPF ...", linha em branco, telefone(s)) faziam o parser fechar o
  bloco do cliente em CADA linha em branco (`ehSeparador` tratava `''` igual
  a `#####`), então o nome era finalizado sem telefone (virava aviso "nenhum
  telefone encontrado" e sumia) e os campos seguintes (contrato/telefone/
  fatura/valor) viravam "trecho não reconhecido" por não ter bloco aberto —
  o cliente inteiro era perdido na conversão, mesmo com fatura/valor
  presentes. Corrigido em `backend/src/lib/parseListaClientes.js`: só o
  separador explícito `#####` fecha o bloco atual agora; linha em branco
  pura é ignorada (um NOME novo já fecha o bloco anterior sozinho, então não
  dependia da linha em branco pra separar clientes diferentes).

- **[2026-09] Converter lista crua perdia valor/Fatura N/prazo de TODOS os
  clientes quando a lista tinha o nome do plano/operadora (ex.: "CLARO
  MEGA") entre os telefones e a linha "Fatura N".** Esse texto tem letra e
  não bate com nenhum campo reconhecido (CPF/Fatura/valor/data/dígitos), então
  o parser tratava como o NOME do PRÓXIMO cliente — fechando o bloco do
  cliente real ANTES da linha "Fatura N"/valor/prazo (que ficavam `null`) e
  abrindo um bloco fantasma ("CLARO MEGA") sem telefone, descartado com
  aviso "nenhum telefone encontrado". Os telefones/contrato continuavam
  sendo importados, mas sem valor/tipo_fatura/data_prazo nenhum — silencioso,
  só percebido comparando com a lista original. Corrigido em
  `backend/src/lib/parseListaClientes.js` com lookahead: um trecho com letra
  só abre bloco novo se o PRÓXIMO campo reconhecido não for Fatura/valor/
  prazo (cliente de verdade sempre tem contrato/CPF/telefone antes desses
  campos); parser reescrito pra operar sobre um stream de tokens (em vez de
  linha por linha) pra viabilizar esse lookahead através de quebras de linha.

- **[2026-08] Dashboard do Supervisor contava clientes com números vinculados
  em dobro.** `GET /api/supervisor/dashboard` (`backend/src/routes/
  supervisor.routes.js`) contava toda linha da tabela `clientes` sem filtrar
  `cliente_principal_id` — um cliente com 2+ números vinculados
  (migration-15, PDF/Pix/valor propagados pra todas as linhas do grupo via
  `faturaPropagacao.js`) virava 2+ "clientes" nos cards "Clientes", "Com PDF"
  e "Com PIX", tanto por operador (`por_operador[]`) quanto no total geral
  (`totais`). A mesma regra já valia em `GET /api/supervisor/operadores`
  (só a linha principal conta) e no dashboard do próprio operador
  (`dashboard.routes.js`) — só o Dashboard do Supervisor tinha ficado pra
  trás. Corrigido com um helper único (`somenteLinhasPrincipais()`) aplicado
  em toda contagem de clientes da rota.

- **[2026-08] `render.yaml` sobrescrevia o `DAILY_LIMIT` do código.** Ao subir o
  limite diário pra 300 direto no default de `dispatchQueue.js`, o
  `backend/render.yaml` ainda tinha `DAILY_LIMIT: value: 100` hardcoded como env
  var do serviço no Render — que tem prioridade sobre o default do código. O
  limite mudado só valeria em ambiente local sem essa env var setada; em
  produção continuaria em 100. Corrigido sincronizando os dois (e aproveitado
  pra já adicionar as novas env vars de PIX/retenção de faturas no mesmo
  arquivo, pro deploy não ficar dependendo só dos defaults do código).
- **[2026-08] Filtro "Entregues"/"Lidos" no Histórico sempre devolvia lista
  vazia.** `GET /envios/:id/itens?filtro=entregue` filtrava
  `.eq('status', filtro)`, mas `status_entrega` (não `status`) é a coluna que
  guarda `entregue`/`lido` — a coluna `status` só tem
  `pendente|enviado|erro|numero_invalido|cancelado`. Bug pré-existente,
  encontrado ao revisar o mesmo arquivo por causa de outra mudança. Corrigido
  em `backend/src/routes/envios.routes.js` mapeando esses dois filtros pra
  `status_entrega`.
- **[2026-08] Itens de um disparo cancelado ficavam "pendente" pra sempre.**
  Ao implementar cancelar disparo, a primeira versão só mudava
  `envios.status` pra `cancelado` e não tocava nos `envio_itens` ainda
  pendentes — eles continuavam contando como "pendente" no dashboard e nos
  filtros do Histórico mesmo depois do lote ser interrompido de vez (nunca
  mais seriam enviados). Corrigido: cancelar agora também marca esses itens
  como `cancelado` (novo valor de `envio_itens.status`,
  `marcarItensPendentesComoCancelados` em `dispatchQueue.js`).
- **[2026-08] Backend não subia de jeito nenhum — `useMultiFileAuthState is not a
  function`.** Causa: `whatsapp.js` importava o pacote Baileys como
  `import baileysPkg from '@whiskeysockets/baileys'` e depois desestruturava
  `baileysPkg.default`, `baileysPkg.useMultiFileAuthState` etc — mas a versão instalada
  do pacote (`6.7.24`) exporta `makeWASocket` **diretamente** como default export (uma
  função), não como um objeto com essas propriedades dentro. `baileysPkg` era na
  verdade a própria função `makeWASocket`, então `baileysPkg.useMultiFileAuthState`
  era `undefined`. **Esse era o bug mais crítico do projeto: o sistema inteiro não
  funcionava, o servidor crashava logo na inicialização.** Corrigido trocando pra
  `import makeWASocket, { useMultiFileAuthState, DisconnectReason } from
  '@whiskeysockets/baileys'` (named imports direto). Arquivo:
  `backend/src/services/whatsapp.js`.
- **[2026-08] Números com DDD 55 (região de Santa Maria/RS) ficavam com JID errado.**
  Causa: `formatJid`/`validarNumero` decidiam se o número "já tinha código do país"
  checando `numero.startsWith('55')` — mas DDD 55 existe de verdade no Brasil, então um
  número local tipo `55991234567` (DDD 55 + celular) era confundido com um número já
  internacionalizado, e ficava faltando o `55` de código do país de verdade
  (resultado: JID teria só 11 dígitos em vez de 13, mensagem não seria entregue).
  Corrigido: decisão agora é por **tamanho** (≤11 dígitos = sem código do país, precisa
  prefixar `55`), não por prefixo. Extraído pra um helper compartilhado
  `backend/src/lib/telefone.js` (`normalizarTelefone`, `formatJid`).
- **[2026-08] Telefone salvo sem normalização — upsert por telefone podia duplicar
  cliente.** Causa: `clientes.routes.js` e `importLote.js` salvavam o telefone
  exatamente como veio do formulário/planilha (`"(11) 99999-9999"`,
  `"11 99999-9999"`, `"11999999999"` etc.), mas o unique index do banco
  (`clientes_telefone_key`) é comparação exata de string — reimportar a mesma pessoa
  com formatação levemente diferente criava um cliente duplicado em vez de atualizar.
  Corrigido: telefone é normalizado (`normalizarTelefone`, mesmo helper acima) antes de
  qualquer insert/update/upsert. **Atenção**: isso não migra automaticamente clientes já
  cadastrados antes dessa correção — script de migração (com checagem de colisão) está
  comentado no fim de `backend/supabase-schema.sql`.
- **[2026-08] Limite diário de disparo resetava 3h mais cedo que a meia-noite real (em
  Brasília).** Causa: `contarEnviadosHoje`/`proximaJanela` calculavam "início do dia"
  com `new Date(); setHours(0,0,0,0)`, que usa o fuso do **servidor** — no Render isso é
  UTC, então "meia-noite" pro código era 21h em Brasília. Corrigido: início do dia
  agora é calculado explicitamente no fuso `America/Sao_Paulo` (Brasil não tem mais
  horário de verão desde 2019, offset fixo `-03:00`), independente do fuso do servidor.
  Arquivo: `backend/src/services/dispatchQueue.js`.
- **[2026-08] PDF de cliente removido ficava órfão no Storage.** `DELETE
  /api/clientes/:id` apagava só a linha do banco, nunca o arquivo no bucket `faturas`
  — acumulava lixo pra sempre. Corrigido: agora busca `pdf_path` antes de deletar e
  remove do Storage também (best-effort — se falhar, só loga, não derruba a resposta
  já que o cliente já foi removido do banco, que é o que importa pro usuário).
- **[2026-08] Uploads sem validação de tipo/tamanho.** `POST /api/clientes/:id/pdf`
  aceitava qualquer arquivo (sem checar mimetype) e sem limite de tamanho (multer
  default = ilimitado). Mesma lacuna em `POST /api/importacao` pros campos `planilha`
  e `zip`. Corrigido: `fileFilter` validando mimetype esperado + `limits.fileSize`
  (20MB pra PDF de cliente, 200MB já existia pro zip/planilha da importação em massa).
  Junto com isso, adicionado um error handler global no Express (`server.js`) — sem
  ele, um erro do multer (ex: tipo de arquivo rejeitado) caía no handler padrão do
  Express e devolvia uma página HTML de erro em vez de JSON, quebrando o
  `res.json().catch()` do `frontend/src/api.js`.
- **[2026-09] Responder um contato de "@lid" pelo WhatsApp OFICIAL no celular (fora
  da plataforma) criava um contato NOVO "Contato não identificado" duplicado.**
  Causa: quando o WhatsApp esconde o número real de um contato atrás de um `@lid`
  (identificador opaco, cada vez mais comum), o Baileys só manda os campos que
  permitem resolver o telefone real (`remoteJidAlt`/`senderPn`) em certas mensagens —
  normalmente resolve na primeira mensagem que o cliente manda pra gente, mas o eco de
  uma resposta enviada pelo WhatsApp oficial no celular (sincronização multi-device,
  fora da plataforma) chega sem esses campos e sem cache do Baileys, então cada
  resposta assim criava uma conversa-fantasma nova. Corrigido: a conversa já resolvida
  guarda o `@lid` numa coluna própria (`conversas.lid`, ver
  `migration-24-lid-persistente.sql`) na primeira vez que resolve com sucesso; da
  próxima vez que esse mesmo lid aparecer sem dar pra resolver pelos campos do
  Baileys, o código consulta essa coluna antes de desistir e reaproveita a conversa já
  existente. Arquivo: `backend/src/services/chatIngest.js`
  (`resolverTelefonePorLid`).
- **[2026-09] Contador de "não lidas" do chat podia inflar em reentrega de
  mensagem.** `upsertConversa` incrementava `nao_lidas` (e trocava "última mensagem")
  toda vez que uma mensagem era PROCESSADA, mesmo quando ela já tinha sido gravada
  antes (o `mensagens.upsert` com `ignoreDuplicates` evita duplicar a LINHA da
  mensagem, mas o contador já tinha subido antes dessa checagem) — um replay do mesmo
  evento pelo WhatsApp (reconexão, sincronização de histórico) inflava o badge de não
  lidas de mensagens que o operador já tinha lido. Corrigido: a atualização de
  resumo/contador (`atualizarResumoConversa`) só roda depois de confirmar que o
  `upsert` da mensagem devolveu uma linha nova (mensagem realmente inédita), não mais
  incondicionalmente. Arquivo: `backend/src/services/chatIngest.js`.
- **[2026-09] `GET /chat/conversas` sem paginação — mesmo padrão do bug já corrigido
  em `GET /clientes`.** Sem `.range()`, o PostgREST cortava em 1000 conversas por
  padrão sem avisar; uma carteira de chat com mais uso (meses de conversas) perderia
  as mais antigas da lista em silêncio. Corrigido: rota agora devolve
  `{ itens, total }` paginado (mesmo `lerPaginacao` das outras rotas); o front pagina
  por baixo dos panos até coletar tudo (`frontend/src/lib/conversasPaginadas.ts`,
  mesmo padrão de `clientesPaginados.ts`).

## Deploy

- **Backend**: Render, Web Service configurado manualmente pelo painel (não
  via Blueprint/`render.yaml` — se existir um `render.yaml` no repo, é só
  referência/histórico, não é a fonte de verdade do deploy real; ver
  `backend/CLAUDE.md`). Sessão do WhatsApp persistida no Supabase (tabela
  `whatsapp_sessions`), não precisa de Persistent Disk.
- **Frontend**: 100% estático, hospedável em qualquer CDN. Suporte oficial a:
  - **Render Static Site** (via `render.yaml`, já configurado).
  - **Vercel** (`[2026-08]`) — `frontend/vercel.json` (build command, output
    directory `dist`, rewrite de SPA pra `index.html`, cache imutável pros assets com
    hash). Passo a passo completo (incluindo o detalhe de setar "Root Directory" =
    `frontend` no dashboard do Vercel, já que o repo é monorepo com `backend/` junto)
    em `frontend/README.md`. Depois do deploy, é preciso atualizar `FRONTEND_ORIGIN`
    no backend com a URL gerada pelo Vercel, senão o CORS bloqueia.
  - Netlify/Cloudflare Pages funcionam do mesmo jeito (build `npm run build`, output
    `dist/`) mas não têm um arquivo de config dedicado no repo ainda — se alguém pedir
    isso, seguir o mesmo padrão do `vercel.json` (equivalente seria `netlify.toml` ou
    config direto no dashboard do Cloudflare Pages).

## Decisões e não-decisões

- **Não migrado multer 1.x → 2.x apesar do aviso de segurança do `npm install`.** O
  advisory é sobre DoS em parsing de multipart, não RCE/leak — risco aceitável pra uso
  pessoal com poucos usuários confiáveis. Migrar exigiria revisar toda a API de
  `multer.fields()`/`multer.single()` usada nas rotas, o que é mudança maior demais
  pra fazer sem testes de regressão completos. **Se for revisitar, ver `backend/src/
  routes/clientes.routes.js` e `importacao.routes.js`.**
- **JID assume sempre Brasil (código de país 55).** `normalizarTelefone` não suporta
  números internacionais — decisão consciente porque o sistema é de uso pessoal/local.
  Se algum dia precisar de clientes fora do Brasil, essa função precisa aceitar o
  código do país como parâmetro em vez de assumir `55`.
- **RLS**: a `migration-13-multi-tenant.sql` (2026-08) já adicionou policies reais de
  isolamento por `usuario_id` nas tabelas principais (`clientes`, `envios`, `envio_itens`,
  `conversas`, `mensagens`, `tags`, `cliente_tags`, `respostas_rapidas`, `pix_extracoes`,
  e depois `faturas_pendentes`/`safras_historico`). Só `whatsapp_sessions`,
  `auditoria_exclusoes`, `perfis` e `tratativas` continuam com RLS habilitado **sem**
  policy — intencional, não bug: o backend usa a `service_role key` (ignora RLS de
  qualquer forma), e a ausência de policy nessas tabelas específicas faz uma tentativa
  de acesso direto via `anon key` (bypassando o backend) retornar zero linhas — postura
  mais segura por padrão. Vale lembrar: um vazamento da `service_role key` ainda expõe
  tudo mesmo com as policies das tabelas principais (ela sempre ignora RLS) — elas
  protegem contra outro cenário (JWT de usuário comum vazado, ou bug de rota que
  esqueça o filtro `usuario_id`), não contra isso.
- **WhatsApp normal (Baileys/QR Code), não a API oficial da Meta.** Decisão original do
  projeto — mais barato e sem burocracia de aprovação de template, mas com risco real
  de bloqueio de número (ver `README.md`, seção "Avisos importantes"). O código já foi
  desenhado pra troca ser isolada (`backend/src/services/whatsapp.js` mantendo a mesma
  interface pública) caso migre pra Cloud API no futuro — não reescrever o resto do
  sistema quando isso acontecer.

## Riscos conhecidos (não são bugs de código, são do modelo do produto)

- Automatizar o WhatsApp normal viola os Termos de Uso da Meta — risco de bloqueio do
  número existe mesmo com delay/pausa/limite diário, cresce com volume e com mensagens
  muito idênticas/genéricas.
- Free tier do Render "dorme" o serviço — ao acordar, a conexão do WhatsApp precisa
  reconectar (a sessão salva evita reescanear QR, mas leva alguns segundos).

## [2026-08] Rodada de features: extração no servidor, clientes pagos, dashboard, disparos por cliente, perfil no header, upload avulso

Seis mudanças pedidas numa tacada só. Documentando juntas porque se apoiam nas mesmas
libs novas.

- **Libs novas compartilhadas no backend** (`backend/src/lib/`): `pixValidacao.js`
  (CRC16 do payload Pix, espelha `pixExtractor.ts`), `nomeMatch.js` (espelha
  `clienteMatch.ts` do frontend, pro backend também poder casar nome de cliente sem
  depender do navegador), `pixPersistencia.js` (resolver cliente + gravar
  `pix_extracoes` + propagar pro cliente — usada por `boletos.routes.js` e pela nova
  extração no servidor), `tagsEfeito.js` (cancelamento de itens pendentes ao aplicar
  tag `permite_disparo:false`, extraída de `tags.routes.js`), `faturasPendentes.js`
  (fila de PDFs avulsos sem cliente correspondente ainda).

- **Extração de Pix no servidor ("opção 2")** — `backend/src/services/
  extratorServidorPix.js` + `POST /api/pix/extracoes/extrair-servidor`. A extração
  PADRÃO continua 100% no navegador (ver decisão de 2026-08 mais acima nesse mesmo
  arquivo sobre por que o servidor não deve tocar em bytes de PDF). Esta é uma
  alternativa explícita, escolhida pelo operador na tela `/pix`, pra quando o
  navegador não dá conta. **O que evita repetir o erro de RAM de antes:** processa
  UM PDF por requisição (nunca um lote inteiro), usa `diskStorage` (nunca guarda o
  PDF inteiro num Buffer da aplicação), tem uma fila em memória
  (`executarSequencial`) que serializa as extrações mesmo se chegarem requisições
  concorrentes, e faz cleanup explícito de canvas/página/documento entre um PDF e o
  próximo (mais `global.gc()` opcional se o processo subir com `--expose-gc` — ver
  `render.yaml`/`package.json`, `npm start` agora usa essa flag). Usa `pdfjs-dist`
  (build legacy, sem DOM) + `@napi-rs/canvas` (binário pré-compilado, não precisa de
  libs nativas do sistema) + `jsqr` — três dependências novas, **rodar `npm install`
  antes do deploy**. Este endpoint só extrai o Pix (texto) — não sobe o PDF em si pro
  Storage (isso é papel do upload de faturas avulsas ou do modo navegador).
  Limite `PIX_SERVIDOR_MAX_ARQUIVO_MB` (padrão 12MB, só por arquivo já que é 1 por
  vez).

- **Importar clientes PAGOS** — `POST /api/clientes/importar-pagos` (tela Clientes,
  botão "Importar pagos"). Cola uma lista de nomes (1 por linha), casa cada um contra
  os clientes já cadastrados (mesmo critério de nome usado no resto do sistema) e
  aplica a tag "Pago" (criada automaticamente na primeira vez, já como
  `permite_disparo:false` — então quem leva essa tag sai dos disparos pendentes e
  futuros, efeito reaproveitado de `lib/tagsEfeito.js`). Devolve quem foi encontrado
  e quem não bateu com ninguém, pra revisão manual.

- **Dashboard: valores e dados dinâmicos** — `GET /api/dashboard/resumo` ganhou
  `valor_medio`, `valor_total`, `faturas_com_valor` (média/soma de `clientes.valor`
  não nulo) e `serie_disparos_7dias` (contagem diária de `envio_itens` enviados, fuso
  de SP). Front (`routes/index.tsx`) ganhou 3 cards novos + um `BarChart` (recharts,
  já era dependência do projeto) dos disparos por dia.

- **Disparos recebidos por cliente** — `GET /api/clientes` agora devolve
  `disparos_recebidos` (contagem de `envio_itens` com `status='enviado'`, histórico
  completo, calculada só pra página atual) em cada cliente, e aceita
  `?recebeu_disparo=true|false` como filtro (resolvido via subquery antes da query
  principal, mesmo padrão já usado pro filtro por tag). O front (`clientes.tsx`)
  filtra client-side sobre esse campo (mesma filosofia do resto da tela, que já
  carrega a lista inteira via `useAppState` e filtra em memória) e mostra uma coluna
  "Disparos" na tabela.

- **Perfil no canto superior direito, sem e-mail** — o bloco de perfil (avatar + nome
  + e-mail + sair) saiu do rodapé da sidebar (`AppShell.tsx`) e virou um
  `DropdownMenu` no header, ao lado do `ThemeToggle`. Só mostra nome + avatar — o
  e-mail não aparece mais por padrão em lugar nenhum do shell (só em Configurações,
  se o operador for lá editar o perfil). A sidebar manteve o indicador de status do
  WhatsApp no rodapé, só perdeu o bloco de perfil/logout.

- **Upload de faturas avulsas, sem planilha** — `POST /api/faturas/avulsas` (tela
  Faturas, nova seção no topo). Sobe 1 PDF por vez (front chama uma vez por arquivo),
  tenta casar pelo nome do arquivo com um cliente já cadastrado — achando, associa na
  hora (mesmo efeito de `POST /clientes/:id/pdf`); não achando, o PDF fica guardado
  no Storage sob `pendentes/<usuario_id>/...` e uma linha em `faturas_pendentes`
  (`migration-18-faturas-pendentes.sql`) registra a pendência. **A parte que fecha o
  ciclo:** `associarPendentesAoCliente` (lib/faturasPendentes.js) é chamada logo após
  qualquer criação de cliente (`POST /clientes` e `POST /clientes/importar-lista`) —
  se o nome bater com alguma pendência, o PDF é movido pra pasta do cliente e
  associado automaticamente, sem o operador precisar voltar e re-subir nada. **Não
  fiz o mesmo wiring em `services/importLote.js`** (upsert da importação em
  massa/zip): esse arquivo já tem uma lógica própria de "sem PDF correspondente = não
  cria o cliente" que teria que ser repensada pra caber a checagem de pendências sem
  risco de regressão — deixei de fora por segurança, não por esquecimento. Se algum
  dia isso for pedido, é o lugar certo pra olhar. A tela de Faturas também lista as
  pendências com um botão de vínculo manual (`POST /faturas/avulsas/pendentes/:id/
  associar`) e de descarte.

- **Não testado end-to-end** (sem ambiente com `npm install`/rede neste trabalho) —
  só `node --check` (sintaxe) nos arquivos de backend tocados. Testar particularmente
  a extração no servidor num ambiente real do Render antes de confiar nela em
  produção (rendering de PDF com `@napi-rs/canvas` é a parte mais nova/arriscada
  desta rodada).

