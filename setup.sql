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
-- Escrita (INSERT) a partir do site público:
--
-- O site do portfólio é estático (GitHub Pages, sem servidor), então ele só
-- consegue gravar usando a chave anon direto do navegador do visitante. Por
-- isso liberamos INSERT para o papel "anon" nas duas tabelas — mas só
-- INSERT: o papel anon continua sem conseguir LER nada (não há policy de
-- SELECT para "anon", só para "authenticated").
--
-- Risco aceito: alguém tecnicamente capaz poderia, em teoria, gravar eventos
-- ou mensagens falsas usando essa chave pública. Para um portfólio pessoal
-- isso é raro e de baixo impacto. Se um dia isso virar problema (spam de
-- mensagens, números inflados), a solução mais segura é trocar por uma Edge
-- Function do Supabase que valide e grave os dados no lugar do INSERT direto.
-- ---------------------------------------------------------------------------
create policy "Site pode gravar eventos"
  on public.portfolio_events
  for insert
  to anon
  with check (true);

create policy "Site pode gravar leads"
  on public.portfolio_leads
  for insert
  to anon
  with check (true);

-- ---------------------------------------------------------------------------
-- Tabela: portfolio_tasks
-- Agenda pessoal da aba "Calendário" do painel: entregas e pendências.
-- Só quem está logado no painel usa essa tabela (não tem relação com o site
-- público), então não existe nenhuma policy para o papel "anon" aqui.
-- ---------------------------------------------------------------------------
create table if not exists public.portfolio_tasks (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  tipo text not null check (tipo in ('entrega', 'pendencia')),
  data_venc date not null,         -- dia em que a tarefa aparece no calendário
  concluida boolean not null default false,
  marca text,                      -- marca/cliente relacionado (opcional)
  hora_inicio time,                -- horário de início (opcional)
  hora_fim time,                   -- horário de término (opcional)
  notas text,
  created_at timestamptz not null default now()
);

create index if not exists idx_portfolio_tasks_data
  on public.portfolio_tasks (data_venc);

alter table public.portfolio_tasks enable row level security;

-- Quem está logado no painel pode ler, criar, editar e excluir suas tarefas.
create policy "Painel logado pode gerenciar tarefas"
  on public.portfolio_tasks
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- INSTAGRAM INTELLIGENCE (MVP) — aba "Instagram" do painel
-- Guarda a configuração de acesso, um retrato (snapshot) diário da conta e um
-- cache das publicações, tudo vindo da Instagram Graph API. O campo "perfil"
-- já existe pensando em, no futuro, suportar mais de uma conta conectada.
-- Só quem está logado no painel usa essas tabelas — nenhuma delas tem policy
-- para "anon", já que o token de acesso é dado sensível.
-- ---------------------------------------------------------------------------
create table if not exists public.instagram_config (
  id uuid primary key default gen_random_uuid(),
  perfil text not null default 'lucimarareis.ugc',
  ig_user_id text not null,
  access_token text not null,
  updated_at timestamptz not null default now(),
  unique (perfil)
);
alter table public.instagram_config enable row level security;
create policy "Painel logado pode gerenciar config do Instagram"
  on public.instagram_config
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists public.instagram_snapshots (
  id uuid primary key default gen_random_uuid(),
  perfil text not null default 'lucimarareis.ugc',
  data date not null,
  seguidores int,
  seguindo int,
  publicacoes int,
  alcance int,
  impressoes int,
  visitas_perfil int,
  cliques_link int,
  created_at timestamptz not null default now(),
  unique (perfil, data)
);
alter table public.instagram_snapshots enable row level security;
create policy "Painel logado pode gerenciar snapshots do Instagram"
  on public.instagram_snapshots
  for all
  to authenticated
  using (true)
  with check (true);

create table if not exists public.instagram_posts (
  id text primary key,              -- id da publicação no Instagram
  perfil text not null default 'lucimarareis.ugc',
  tipo text,                        -- IMAGE | VIDEO | CAROUSEL_ALBUM
  is_reel boolean not null default false,
  legenda text,
  permalink text,
  midia_url text,
  thumbnail_url text,
  publicado_em timestamptz,
  curtidas int,
  comentarios int,
  compartilhamentos int,
  salvamentos int,
  alcance int,
  impressoes int,
  plays int,                        -- reproduções (Reels/vídeos)
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_instagram_posts_publicado_em
  on public.instagram_posts (publicado_em desc);
alter table public.instagram_posts enable row level security;
create policy "Painel logado pode gerenciar posts do Instagram"
  on public.instagram_posts
  for all
  to authenticated
  using (true)
  with check (true);
