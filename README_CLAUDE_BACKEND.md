# Contrato de Backend — Voxcel Faturas

Documento técnico do que o **frontend** já implementa e espera do backend.
O frontend não contém mocks: toda tela consome exclusivamente `src/api.js`.

- Base URL: `import.meta.env.VITE_API_URL` (fallback `http://localhost:3333/api`)
- Auth: Supabase (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Toda request envia
  `Authorization: Bearer <access_token>`. Responder `401` quando inválido.
- Formato: JSON (`Content-Type: application/json`); uploads via `multipart/form-data`.
- Erros: qualquer status != 2xx deve retornar `{ "error": "mensagem legível" }` — o
  frontend exibe essa string diretamente.
- Tipos canônicos: `src/lib/types.ts` (fonte da verdade dos nomes de campos).

---

## 1. Dashboard

`GET /dashboard/resumo` → `DashboardResumo`

```json
{ "clientes": 0, "faturas": 0, "disparos_hoje": 0, "enviados": 0, "entregues": 0,
  "lidos": 0, "falhas": 0, "numeros_invalidos": 0, "pendentes": 0 }
```

## 2. WhatsApp — dois slots independentes

O sistema opera com no máximo **duas** sessões (`slot: 1 | 2`).

| Método | Rota | Retorno |
| --- | --- | --- |
| GET | `/whatsapp/conexoes` | `WhatsappConexao[]` (sempre 2 itens, slots 1 e 2) |
| GET | `/whatsapp/conexoes/:slot/status` | `WhatsappConexao` |
| POST | `/whatsapp/conexoes/:slot/conectar` | `WhatsappConexao` (com `qr` quando aplicável) |
| POST | `/whatsapp/conexoes/:slot/logout` | `WhatsappConexao` |
| GET | `/whatsapp/status` | status agregado (compat. legado) |
| POST | `/whatsapp/logout` | encerra todas as sessões (compat. legado) |

```ts
WhatsappConexao = {
  slot: 1 | 2
  configurada: boolean            // false = slot nunca pareado
  status: "disconnected" | "connecting" | "qr" | "connected"
  qr: string | null               // data URL ou string do QR
  telefone: string | null
  nome: string | null
  ultima_conexao: string | null   // ISO 8601
  mensagens_enviadas: number | null
}
```

Polling: o frontend consulta `/whatsapp/conexoes` a cada poucos segundos enquanto
houver slot em `connecting`/`qr`. O endpoint deve ser leve e idempotente.

## 3. Estratégia de envio

| Método | Rota | Corpo/Retorno |
| --- | --- | --- |
| GET | `/configuracoes/estrategia` | `EstrategiaConfig` |
| PUT | `/configuracoes/estrategia` | `{ estrategia }` → `EstrategiaConfig` |
| GET | `/configuracoes/disparo` | `ConfigDisparo` (delay, limite diário, pausa automática por lote) |

```ts
EstrategiaConfig = {
  estrategia: "slot_1" | "slot_2" | "round_robin" | "qualquer"
  next_slot: 1 | 2 | null   // próximo slot no round robin
  slots_ativos: (1 | 2)[]
}
```

O backend é responsável por escolher o slot de cada mensagem conforme a estratégia
(round robin = alternar mensagem a mensagem entre os slots conectados).

## 4. Extrator de PIX

| Método | Rota | Observações |
| --- | --- | --- |
| GET | `/pix/extracoes?busca&status&cliente_id&page&per_page` | `{ items: PixExtracao[], total }` |
| POST | `/pix/extracoes` | `multipart`, campo repetido `arquivos` (PDFs, até 400 arquivos / 800MB por requisição — o front envia em lotes menores) → `PixExtracao[]` |
| POST | `/pix/extracoes/:id/reprocessar` | `PixExtracao` |
| POST | `/pix/extracoes/:id/aplicar` | `{ cliente_id }` → grava `pix_code` no cliente |
| GET | `/pix/extracoes/exportar?formato=csv\|xlsx` | binário (download) |

```ts
PixExtracao = {
  id, arquivo, cliente_id: string|null, cliente_nome: string|null,
  status: "aguardando"|"processando"|"encontrado"|"nao_encontrado"|"erro",
  pix_code: string|null, erro: string|null, criado_em: string
}
```

## 5. Clientes

| Método | Rota |
| --- | --- |
| GET | `/clientes?busca&tag&com_pix&sem_pix&com_pdf&sem_pdf&recebeu_disparo&safra&tipo_fatura&page&per_page` → `Cliente[]` |
| GET | `/clientes/:id` → `Cliente` |
| POST | `/clientes` → `Cliente` |
| PUT | `/clientes/:id` → `Cliente` (aceita `nome`, `telefone`, `valor`, `vencimento`, `tipo_fatura`, `data_prazo`, `numero_contrato`, `data_contrato` — os 4 últimos propagam pro grupo de números vinculados, mesmo tratamento de `valor`/`vencimento`; nunca envie `safra`, é coluna gerada) |
| DELETE | `/clientes/:id` |
| GET | `/clientes/:id/historico` → `EnvioItem[]` (envios do cliente) |
| POST | `/clientes/:id/pdf` → `multipart` campo `pdf` → `Cliente` atualizado |
| POST | `/clientes/converter-lista` → `{ texto }` → `{ itens: ItemConvertido[], avisos: string[], total }` |
| POST | `/clientes/importar-lista` → `{ itens: ItemConvertido[] }` → `{ criados, erros, total }` |

```ts
Cliente = {
  id, nome, telefone, valor: string|null, vencimento: string|null,
  pdf_url: string|null, pdf_path: string|null, pix_code: string|null,
  tags: Tag[], ultimo_envio_em?: string|null, ultimo_envio_status?: ItemStatus|null,
  // [2026-08] Safras (ver seção 11) -- preenchidos quando o cliente veio da
  // lista crua com essa informação (nulos para cadastro manual/planilha antiga).
  tipo_fatura: "FPD"|"SPD"|null,       // FPD = primeira fatura, SPD = segunda fatura
  data_prazo: string|null,             // "YYYY-MM-DD"
  numero_contrato: string|null,
  data_contrato: string|null,          // "YYYY-MM-DD" -- hoje sempre null (ver seção 11)
  safra: string|null,                  // "YYYY-MM", GERADO a partir de data_prazo -- nunca enviar no PUT/POST
}
Tag = { id, nome, cor }

// Item devolvido por /converter-lista e aceito por /importar-lista.
ItemConvertido = {
  nome, numero, valor: number|null, arquivo,
  tipo_fatura: "FPD"|"SPD"|null, data_prazo: string|null,
  numero_contrato: string|null, data_contrato: string|null,
}
```

## 6. Faturas

- `GET /faturas?busca&com_pdf&sem_pdf&page&per_page` → `{ items, total }`
- `GET /faturas/exportar?formato=csv|xlsx` → binário

## 7. Importação em massa

- `POST /importacao` — `multipart`: `planilha` (xlsx/csv), `zip` (PDFs), `mensagem` (opcional)
  → `{ criados, atualizados, ignorados, erros: string[] }`
- `GET /importacao/modelo` → planilha modelo (binário)

## 8. Disparos (envios)

| Método | Rota | Observações |
| --- | --- | --- |
| POST | `/envios` | `{ mensagem, cliente_ids[], tag_ids[], intervalo_ms, agendado_para?, slot? }` → `EnvioResumo` |
| POST | `/envios/:id/disparar` | inicia a fila |
| POST | `/envios/:id/pausar` | pausa um envio em andamento (retomada só manual) |
| POST | `/envios/:id/cancelar` | interrompe de vez (não é retomável) |
| GET | `/envios/ativo` | `{ id, status }` do envio em_andamento/pausado mais recente (ou `{ id: null }`) |
| POST | `/envios/:id/reenviar-erros` | novo lote apenas com falhas |
| PATCH | `/envios/:id/agendar` | `{ agendado_para }` (ISO) |
| GET | `/envios/:id` | `EnvioResumo` |
| GET | `/envios?busca&status&de&ate&slot&page&per_page` | `{ items: EnvioResumo[], total }` |
| GET | `/envios/:id/itens?status&busca` | `{ items: EnvioItem[], total }` |
| GET | `/envios/:id/progresso` | contadores para polling durante o disparo |
| GET | `/envios/exportar?formato=csv\|xlsx` | binário |
| POST | `/envios/teste` | `{ telefone, mensagem }` — envio único de teste |

```ts
EnvioResumo = { id, criado_em, lote: string|null,
  status: "pendente"|"agendado"|"em_andamento"|"pausado"|"concluido",
  slot: 1|2|null, total, enviados, entregues, lidos, falhas, numeros_invalidos, pendentes }

EnvioItem = { id, status: "pendente"|"enviado"|"erro"|"numero_invalido",
  status_entrega: "entregue"|"lido"|null, erro: string|null, slot: 1|2|null,
  enviado_em: string|null, clientes: { nome, telefone, valor?, vencimento? } | null }
```

Variáveis interpoladas na mensagem (substituição no backend):
`{{nome}}`, `{{telefone}}`, `{{valor}}`, `{{vencimento}}`, `{{pix}}`.

## 9. Chat

- `GET /chat/conversas` → `{ items: [{ id, cliente_id, nome, telefone, ultima_mensagem, ultima_em, nao_lidas, slot }] }`
- `GET /chat/conversas/:id/mensagens` → `{ items: [{ id, direcao: "in"|"out", texto, anexo_url, criado_em, status }] }`
- `POST /chat/conversas/:id/mensagens` — `multipart`: `mensagem` e/ou `anexo`
- `POST /chat/conversas/:id/marcar-lida`
- `DELETE /chat/conversas/:id`
- `POST /chat/conversas/:id/enviar-fatura` — `{ modo: "pdf" | "pix" | "pdf_pix" }`

## 10. Tags e respostas rápidas

- `GET/POST /tags`, `PUT/DELETE /tags/:id`
- `POST/DELETE /tags/:tagId/clientes/:clienteId`
- `GET/POST /respostas-rapidas`, `PUT/DELETE /respostas-rapidas/:id` (`{ titulo, texto }`)

## 11. Safras (FPD/SPD) e histórico

Acompanhamento por safra de 60 dias (FPD = primeira fatura, SPD = segunda fatura --
ver CONTEXTO.md pra regra de negócio completa). Não existe tabela operacional própria:
é uma visão sobre `clientes` agrupada pela coluna gerada `safra` ('YYYY-MM', mês/ano da
`data_prazo`) -- mesmo espírito de `/faturas` (visão sobre `clientes` filtrada por PDF).

| Método | Rota | Observações |
| --- | --- | --- |
| GET | `/safras` | Lista todas as safras (ativas com métrica ao vivo + históricas arquivadas) |
| GET | `/safras/:safra` | Detalhe de uma safra (`YYYY-MM`) -- ao vivo se tiver cliente ativo, senão cai pro snapshot do histórico |
| POST | `/safras/:safra/consolidar` | Força o snapshot em `safras_historico` agora (o job automático roda 1x/dia) |

```ts
SafraResumo = {
  safra: string,               // "2026-09"
  rotulo: string,               // "Setembro/2026"
  total_clientes: number,
  total_fpd: number,
  total_spd: number,
  sem_tipo_fatura: number,
  pagos: number,                // tag "Pago" (ver /clientes/importar-pagos)
  nao_pagos: number,
  receberam_disparo: number,
  nao_receberam_disparo: number,
  valor_total: number,
  valor_medio: number,
  duplicidades_detectadas: number,
  consolidado_em: string | null, // última vez que essa safra foi salva em safras_historico
  arquivada: boolean,            // true = sem cliente ativo, métricas vêm só do snapshot
}
```

---

## Checklist de implementação

- [ ] Validar JWT Supabase em todas as rotas (`401` + `{ error }`)
- [ ] Endpoints de status/progresso leves (são consultados por polling)
- [ ] Paginação com `{ items, total }` em todas as listagens
- [ ] Duas sessões WhatsApp isoladas + estratégia de seleção de slot
- [ ] Extração de PIX assíncrona com status por arquivo
- [ ] Fila de disparo com intervalo configurável e contadores de entrega/leitura
- [ ] Exportações CSV/XLSX com `Content-Disposition: attachment`
- [ ] Mensagens de erro em português (exibidas cruas na UI)
