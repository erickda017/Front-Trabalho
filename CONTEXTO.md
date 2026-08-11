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
  Roda no Render como Web Service com Persistent Disk (sessão do WhatsApp precisa
  sobreviver a redeploys).
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

## Bugs corrigidos (histórico)

> Formato: **[data aproximada] título** — sintoma, causa raiz, arquivo(s) tocado(s).

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

## Deploy

- **Backend**: Render (Web Service + Persistent Disk pra sessão do WhatsApp), via
  `render.yaml` na raiz (Blueprint). Detalhes no `README.md` raiz.
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
- **RLS habilitado no Postgres mas sem policies.** Isso é intencional, não um bug: o
  backend usa a `service_role key` (ignora RLS), e a ausência de policies faz com que
  qualquer tentativa de acesso direto via `anon key` (bypassando o backend) retorne
  zero linhas — é a postura mais segura por padrão. Se um dia o frontend precisar
  falar direto com o Supabase (sem passar pelo backend) pra algo, aí sim vai precisar
  escrever policies explícitas.
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
