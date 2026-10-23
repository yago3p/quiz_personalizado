-- Quiz interativo: schema completo (rode uma única vez no SQL Editor do Supabase)

-- Configuração geral (sempre 1 linha) + chave de acesso do painel admin
create table if not exists quiz_config (
  id int primary key default 1 check (id = 1),
  per_quiz int not null default 5,               -- perguntas sorteadas por participante
  max_points int not null default 1000,          -- pontos máximos por acerto
  penalty_per_sec numeric not null default 40,   -- pontos perdidos por segundo na pergunta
  min_points int not null default 100,           -- mínimo por acerto
  active boolean not null default true,          -- quiz aberto/encerrado
  admin_key text not null default replace(gen_random_uuid()::text, '-', '')
);
insert into quiz_config (id) values (1) on conflict do nothing;

-- Banco de perguntas (importado pela planilha no painel)
create table if not exists quiz_questions (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  correct text not null,
  wrongs jsonb not null,
  created_at timestamptz not null default now()
);

-- Participantes. A matrícula é única, ignorando zeros à esquerda (0123 = 123)
create table if not exists quiz_participants (
  id uuid primary key default gen_random_uuid(),
  matricula text not null unique,
  matricula_norm text generated always as (regexp_replace(upper(matricula), '^0+(?=.)', '')) stored,
  nome text not null,
  local text,
  token text not null,
  question_ids uuid[] not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int not null default 0,
  correct_count int not null default 0,
  total_time_ms int
);
create index if not exists quiz_participants_matricula_norm_idx on quiz_participants (matricula_norm);

-- Respostas de cada participante (opções embaralhadas, gabarito e tempos ficam só aqui, no servidor)
create table if not exists quiz_answers (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references quiz_participants(id) on delete cascade,
  position int not null,
  question_id uuid,
  question_text text not null,
  correct_text text not null,
  options jsonb not null,
  served_at timestamptz not null default now(),
  answered_at timestamptz,
  chosen text,
  is_correct boolean,
  points int,
  elapsed_ms int,
  unique (participant_id, position)
);

-- Segurança: ninguém acessa as tabelas direto pelo navegador.
-- Todo acesso passa pelas Edge Functions (que usam a service role).
alter table quiz_config enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_participants enable row level security;
alter table quiz_answers enable row level security;
revoke all on quiz_config, quiz_questions, quiz_participants, quiz_answers from anon, authenticated;
