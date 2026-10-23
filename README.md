# 🧠 Quiz Interativo

Quiz web cronometrado, com perguntas importadas de uma planilha, ranking por **local** e painel de resultados em tempo real.

- **Participantes** entram por um link, informam nome, matrícula e local, e respondem a perguntas sorteadas, com as opções em ordem aleatória.
- **Pontuação:** vence quem acerta mais e responde mais rápido.
- **Painel do organizador:** envia as perguntas, acompanha o progresso e vê o pódio de cada local.

## Como funciona

| Regra | Detalhe |
|---|---|
| Perguntas por pessoa | 5 sorteadas do banco (configurável no painel) |
| Opções | Embaralhadas a cada pergunta, para cada pessoa |
| Cronômetro | Tempo decorrido visível no topo. Ele é medido no **servidor**, então atualizar a página não zera nem dá para alterar |
| Pontuação | Acerto = **1000 − 40 pontos por segundo** gasto na pergunta (mínimo 100). Erro = 0 |
| Desempate | Menor tempo total |
| Matrícula | **Uma resposta por matrícula**, ignorando zeros à esquerda (`0123456` = `123456`) |
| Locais | Sede administrativa, Lote 1, Lote 2, Lote 3. O painel mostra **um pódio por local** |
| Resultado do participante | Vê só acertos e tempo. **Os pontos não aparecem** para ele |
| Navegação | Escolhe a resposta e clica em "Próxima pergunta". Também dá para usar o teclado: letras A, B, C… e Enter |

### Segurança (anti-burla)

- O gabarito, a ordem das opções, os pontos e os tempos ficam **só no servidor**. O navegador nunca recebe a resposta certa.
- As tabelas do banco não são acessíveis pelo navegador (RLS ligado, sem permissão para `anon`). Tudo passa pelas Edge Functions.
- Cada participante recebe um token de sessão. Quem recarregar a página continua de onde parou.
- O painel `/admin` só funciona com a **chave de administrador** (veja o passo 5).

## Estrutura do projeto

```
quiz-interativo/
├── README.md
├── perguntas_modelo.xlsx            # modelo de planilha de perguntas
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 20261023000000_quiz_schema.sql   # tabelas e segurança
│   └── functions/
│       ├── quiz/index.ts            # API dos participantes
│       └── admin/index.ts           # API do painel
└── web/                             # site estático (HTML puro, sem build)
    ├── index.html                   # página dos participantes
    ├── admin.html                   # painel do organizador
    ├── config.js                    # URL do seu projeto Supabase  ← edite
    └── vercel.json
```

## Publicando (passo a passo)

Você precisa de uma conta gratuita no [Supabase](https://supabase.com) (banco e servidor) e de uma hospedagem de sites estáticos, como a [Vercel](https://vercel.com). Nenhuma instalação é obrigatória, mas o Passo 3 tem uma opção mais rápida pela linha de comando.

### 1. Criar o projeto no Supabase

1. Em supabase.com, clique em **New project** e escolha nome, senha do banco e região (para o Brasil, `South America (São Paulo)`).
2. Aguarde o projeto ficar pronto.
3. Em **Project Settings → API**, copie a **Project URL** (algo como `https://abcdefgh.supabase.co`). Você vai usá-la no passo 4.

### 2. Criar as tabelas

1. No Supabase, abra **SQL Editor → New query**.
2. Cole todo o conteúdo de `supabase/migrations/20261023000000_quiz_schema.sql` e clique em **Run**.

### 3. Publicar as duas funções do servidor

São duas funções: `quiz` (participantes) e `admin` (painel). Escolha **uma** das opções:

**Opção A: pelo site (sem instalar nada)**

1. Em **Edge Functions → Deploy a new function → Via Editor**, crie uma função chamada exatamente `quiz` e cole o conteúdo de `supabase/functions/quiz/index.ts`.
2. **Desligue** a opção **Verify JWT** (ou *Enforce JWT verification*) dessa função e faça o deploy.
3. Repita para a função `admin` com `supabase/functions/admin/index.ts`, também com a verificação de JWT **desligada**.

**Opção B: pela linha de comando**

```bash
npm i -g supabase            # ou veja outras formas em supabase.com/docs/guides/cli
supabase login
supabase link --project-ref SEU_PROJECT_REF   # o "abcdefgh" da URL do projeto
supabase functions deploy quiz  --no-verify-jwt
supabase functions deploy admin --no-verify-jwt
```

> ⚠️ A verificação de JWT precisa ficar **desligada**. Se ficar ligada, o navegador receberá erro 401 ao chamar as funções.

### 4. Configurar o site

Abra `web/config.js` e troque pela URL copiada no passo 1:

```js
window.QUIZ_CONFIG = {
  supabaseUrl: "https://abcdefgh.supabase.co",
};
```

### 5. Pegar a chave do painel

No **SQL Editor** do Supabase, rode:

```sql
select admin_key from quiz_config;
```

Guarde esse valor. Ele é a "senha" do painel. Ele fica só no banco, nunca no código.

### 6. Publicar o site

**Na Vercel:**

1. Em vercel.com/new, importe o repositório do projeto (ou envie a pasta).
2. Defina **Root Directory = `web`**, **Framework Preset = Other** e deixe o build vazio.
3. Faça o deploy. O endereço será algo como `https://meu-quiz.vercel.app`.

Também funciona em Netlify, Cloudflare Pages ou GitHub Pages: publique o conteúdo da pasta `web/`. Fora da Vercel, o painel fica em `/admin.html` em vez de `/admin`.

### 7. Usar

- **Link dos participantes:** `https://SEU-SITE/`
- **Painel (só para o organizador):** abra **uma vez** `https://SEU-SITE/admin#k=SUA_ADMIN_KEY`. O navegador guarda a chave, e depois basta `/admin`. Não compartilhe esse link.
- No painel, aba **Perguntas**, envie a planilha (veja abaixo). Depois acompanhe os pódios na aba **Resultados**.

## Planilha de perguntas

Use `perguntas_modelo.xlsx` como base. Cada linha é uma pergunta:

| Pergunta | Resposta correta | Opção errada 1 | Opção errada 2 | … |
|---|---|---|---|---|
| Qual é a capital do Brasil? | Brasília | Rio de Janeiro | São Paulo | … |

- A primeira linha é o cabeçalho e é ignorada.
- Pode ter **qualquer quantidade** de opções erradas (de 1 em diante) e misturar perguntas com 3 e com 5 opções.
- Todas as abas marcadas são importadas. Perguntas repetidas ficam com a versão de mais opções.
- Você escolhe **Substituir** as perguntas atuais ou **Adicionar** às existentes.
- Se o banco tiver menos perguntas que o configurado (padrão 5), cada pessoa recebe todas.

## Personalização

| O que mudar | Onde |
|---|---|
| Perguntas por pessoa / abrir e encerrar o quiz | Painel → **Configurações** |
| Fórmula de pontos | Tabela `quiz_config`: `max_points`, `penalty_per_sec`, `min_points` (no SQL Editor: `update quiz_config set penalty_per_sec = 20;`) |
| Lista de locais | 3 lugares: `LOCAIS` em `supabase/functions/quiz/index.ts` (e novo deploy), botões `.loc` em `web/index.html` e `LOCAIS` em `web/admin.html` |
| Textos e cores | `web/index.html` e `web/admin.html` (variáveis CSS no topo) |
| Trocar a chave do painel | `update quiz_config set admin_key = replace(gen_random_uuid()::text,'-','');` e depois `select admin_key from quiz_config;` |

## Operação

- **Novo evento:** no painel, em **Configurações → Apagar todos os participantes**, e importe as perguntas novas com "Substituir".
- **Liberar uma matrícula** (para a pessoa repetir): em **Resultados**, clique em **Excluir** na linha dela.
- **Encerrar as respostas:** desligue **Quiz aberto** em Configurações.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| "Configuração pendente" na página | `web/config.js` ainda com `SEU-PROJETO`. Edite e publique de novo |
| Erro 401 ao abrir o quiz ou o painel | **Verify JWT** ligado nas funções. Refaça o deploy com `--no-verify-jwt` ou desligue no painel do Supabase |
| "Sem acesso" no painel | Chave errada ou não informada. Abra o link com `#k=` e a chave do passo 5 |
| "Quiz ainda sem perguntas" | Falta importar a planilha |
| Mudanças no site não aparecem | Cache do navegador. Use Ctrl+F5 |
| "Selecione o local" | Página antiga em cache sem a lista de locais. Recarregue com Ctrl+F5 |

## Observações

- O site é HTML puro, sem etapa de build e sem dependências próprias. O painel carrega a biblioteca SheetJS por CDN (cdnjs) para ler a planilha.
- A matrícula e o nome ficam no banco do seu projeto Supabase. Trate o acesso a ele de acordo com a política de dados da sua organização.
- O plano gratuito do Supabase pausa projetos sem uso por um período. Se o quiz ficar parado e o site der erro, reative o projeto no painel do Supabase antes do evento.
