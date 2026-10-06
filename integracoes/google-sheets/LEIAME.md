# Pix na planilha oficial (Google Sheets)

Botão **"Atualizar Pix na planilha"** no site (tela **Extrator de PIX** e
**Supervisor → Planilha de PIX**). Ao clicar, o backend manda os Pix extraídos
por **todos** os operadores pra este script, que preenche a coluna **COD PIX**
da planilha oficial.

- Não precisa de Google Cloud: o script roda dentro da planilha, com a conta
  Google de quem instalar.
- É de graça (cota gratuita do Apps Script sobra muito pra 1 clique por mês).
- Só preenche célula de Pix **vazia**. Não mexe em cor, borda, fórmula nem em
  outra célula. Coluna com nome de Pix mas com outro conteúdo (ex.: "PAGO
  14-08") não é tocada: o Pix vai pra uma coluna "COD PIX" nova ao lado (e nas
  próximas vezes essa mesma coluna é reaproveitada).
- Casamento igual ao upload manual: OS + vencimento + nome; senão OS +
  vencimento (se não houver 2 Pix diferentes possíveis). Na dúvida, vazio.
- Tudo que foi preenchido fica registrado na aba **Log Pix**.

## Instalação (uma vez, ~10 min)

Quem instalar precisa ter **permissão de edição** na planilha oficial.

1. **Gerar a chave** (senha entre o site e a planilha, mínimo 20 caracteres,
   só letras e números). Ex.: num terminal, `openssl rand -hex 24`.
2. **Planilha oficial → Extensões → Apps Script.** Apague o que estiver no
   editor, cole o conteúdo de `PixPlanilha.gs` e salve (ícone de disquete).
3. Volte pra planilha e **recarregue a página**. Aparece o menu
   **Pix automático**. Clique **Pix automático → Configurar chave** e cole a
   chave do passo 1. Na 1ª vez o Google pede autorização:
   - "O Google não verificou este app" é normal (o script é seu, não foi
     publicado): **Avançado → Acessar (não seguro)** → **Permitir**.
4. No editor do Apps Script: **Implantar → Nova implantação**.
   - Tipo (engrenagem): **App da Web**.
   - Executar como: **Eu**.
   - Quem pode acessar: **Qualquer pessoa**. (Isso libera só o endereço; sem
     a chave o script recusa tudo e não mostra nada da planilha.)
   - **Implantar** e copie o **URL do app da Web** (termina em `/exec`).
5. **Render → serviço do backend → Environment**, adicione:
   - `PLANILHA_WEBAPP_URL` = o URL do passo 4
   - `PLANILHA_CHAVE_INTEGRACAO` = a chave do passo 1 (a MESMA do passo 3)
   Salve (o Render reinicia o backend).
6. Teste: abra o URL do passo 4 no navegador. Deve aparecer
   `{"ok":true,"script":"Pix automático","chaveConfigurada":true}`.
7. No site, clique **Atualizar Pix na planilha** e confira a aba **Log Pix**.

## Se alterar o script depois

Cole a versão nova e use **Implantar → Gerenciar implantações → (lápis) →
Versão: Nova versão → Implantar**. Assim o URL continua o mesmo. (Uma
"Nova implantação" gera URL novo — aí precisa atualizar o Render.)

## Problemas comuns

| Mensagem no site | O que fazer |
|---|---|
| "Integração com a planilha ainda não configurada" | Passo 5 (variáveis no Render). |
| "Planilha recusou: chave inválida" | Chave do Render diferente da salva no passo 3. |
| "chave não configurada na planilha" | Passo 3. |
| "respondeu algo inesperado" | Implantação sem "Qualquer pessoa", ou URL não termina em `/exec`. |
| "demorou demais" | Backend acordando (Render gratuito) ou planilha muito grande — clique de novo. |

## Teste local (sem Google)

`node integracoes/google-sheets/PixPlanilha.check.mjs`
