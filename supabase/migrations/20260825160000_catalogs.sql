-- Catálogos de solo lectura: plataformas, suscripciones/cloud, géneros y juegos.

create table public.platforms (
  id serial primary key,
  family text not null,
  name text not null unique
);

create table public.subscriptions (
  id serial primary key,
  name text not null,
  tier text,
  kind text not null check (kind in ('subscription', 'cloud')),
  unique nulls not distinct (name, tier)
);

create table public.genres (
  id serial primary key,
  name text not null unique
);

create table public.games (
  id serial primary key,
  title text not null unique,
  cover_url text,
  metadata jsonb not null default '{}'::jsonb
);

create table public.game_genres (
  game_id int not null references public.games (id) on delete cascade,
  genre_id int not null references public.genres (id) on delete cascade,
  primary key (game_id, genre_id)
);

-- Un juego es accesible comprándolo en una plataforma o vía suscripción/nube:
-- exactamente uno de platform_id / subscription_id es no nulo.
create table public.game_availability (
  id serial primary key,
  game_id int not null references public.games (id) on delete cascade,
  platform_id int references public.platforms (id) on delete cascade,
  subscription_id int references public.subscriptions (id) on delete cascade,
  check (num_nonnulls(platform_id, subscription_id) = 1),
  unique nulls not distinct (game_id, platform_id, subscription_id)
);

alter table public.platforms enable row level security;
alter table public.subscriptions enable row level security;
alter table public.genres enable row level security;
alter table public.games enable row level security;
alter table public.game_genres enable row level security;
alter table public.game_availability enable row level security;

create policy "catalog read" on public.platforms for select to anon, authenticated using (true);
create policy "catalog read" on public.subscriptions for select to anon, authenticated using (true);
create policy "catalog read" on public.genres for select to anon, authenticated using (true);
create policy "catalog read" on public.games for select to anon, authenticated using (true);
create policy "catalog read" on public.game_genres for select to anon, authenticated using (true);
create policy "catalog read" on public.game_availability for select to anon, authenticated using (true);
