# Voxcel Faturas — Front

Painel operacional do Voxcel Faturas: disparo de faturas em PDF via WhatsApp,
dashboard, controle de safras (FPD/SPD), extrator de PIX de boletos e chat
com clientes. Front estático (React 19 + Vite + TanStack Router/Start),
separado do backend (`Backend-Trabalho/`, Node + Express + Baileys +
Supabase) — os dois vivem em repositórios/pastas irmãos no mesmo monorepo.

Para contexto completo de produto, regras de negócio e histórico de
funcionalidades/bugs corrigidos, ver [`CONTEXTO.md`](./CONTEXTO.md) — é a
fonte de verdade, leia antes de qualquer mudança não-trivial.

## Rodando localmente

Precisa de Node.js e npm — [instale com o nvm](https://github.com/nvm-sh/nvm#installing-and-updating)
se ainda não tiver.

```sh
npm install
cp .env.example .env   # preencher VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev            # vite dev
```

`VITE_API_URL` precisa apontar pro backend rodando (local: `http://localhost:3333/api`;
produção: a URL do serviço no Render + `/api`). Sem os três valores reais
preenchidos, a tela sobe mas todo request dá `Failed to fetch`.

## Deploy

Estático na Vercel. Ver seção "Deploy em produção" do `CLAUDE.md` do backend
(`Backend-Trabalho/CLAUDE.md`) para o passo a passo completo (variáveis de
ambiente obrigatórias, CORS, etc.).

## Scripts

- `npm run dev` — servidor de desenvolvimento (Vite)
- `npm run build` — build de produção
- `npm run lint` — ESLint
- `npm run format` — Prettier
