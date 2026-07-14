-- ============================================================================
-- SETUP DO BANCO — rode este arquivo inteiro no SQL Editor do Supabase
-- (Painel do projeto > SQL Editor > New query > cole tudo > Run)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tabela: portfolio_events
-- Guarda os eventos de navegação do site (visitas, cliques, vídeos vistos)
-- ---------------------------------------------------------------------------
create table if not exists public.portfolio_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,        -- 'page_view' | 'button_click' | 'video_view'
  event_name text,                 -- nome do botão, id do vídeo, etc.
  session_id text,                 -- identifica um visitante (não é login)
  page_path text,                  -- caminho da página onde ocorreu o evento
  metadata jsonb,                  -- dados extras (ex.: { "title": "...", "brand": "...", "category": "..." })
  created_at timestamptz not null default now()
);

create index if not exists idx_portfolio_events_created_at
  on public.portfolio_events (created_at desc);

create index if not exists idx_portfolio_events_type
  on public.portfolio_events (event_type);

-- ---------------------------------------------------------------------------
-- Tabela: portfolio_leads
-- Guarda as mensagens de contato enviadas pelo site
-- ---------------------------------------------------------------------------
create table if not exists public.portfolio_leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  phone text,
  brand text,
  budget text,
  message text,
  source text,                     -- 'contact' | 'popup'
  created_at timestamptz not null default now()
);

create index if not exists idx_portfolio_leads_created_at
  on public.portfolio_leads (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS) — liga a proteção nas duas tabelas
-- ---------------------------------------------------------------------------
alter table public.portfolio_events enable row level security;
alter table public.portfolio_leads enable row level security;

-- Permite que qualquer usuário LOGADO no painel (authenticated) possa LER
-- os dados. Isso é o que faz o painel administrativo funcionar.
create policy "Painel logado pode ler eventos"
  on public.portfolio_events
  for select
  to authenticated
  using (true);

create policy "Painel logado pode ler leads"
  on public.portfolio_leads
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- IMPORTANTE — sobre a escrita (INSERT) dos dados:
--
-- De propósito, este arquivo NÃO cria nenhuma policy de INSERT para o papel
-- "anon" (público). Isso significa que o site público, usando a chave anon,
-- NÃO conseguirá gravar eventos ou leads diretamente no banco — e isso é o
-- comportamento correto.
--
-- A gravação de portfolio_events e portfolio_leads deve ser feita a partir
-- de um servidor (ex.: uma função serverless, uma Edge Function do Supabase
-- ou um backend seu) usando a chave de SERVIÇO (service_role), nunca a
-- chave anon exposta no navegador. Isso evita que qualquer pessoa envie
-- eventos falsos ou spam de mensagens diretamente pelo console do navegador.
--
-- Se no futuro você quiser permitir que o próprio site (sem servidor) grave
-- os dados com a chave anon, crie policies de INSERT específicas para o
-- papel "anon" nas colunas necessárias — mas isso reduz a segurança contra
-- spam e não é recomendado.
-- ---------------------------------------------------------------------------
