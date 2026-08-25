-- Rooms, membresías, perfiles de gustos, sugerencias y ratings.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (char_length(name) between 3 and 50),
  description text not null default '' check (char_length(description) <= 200),
  is_public boolean not null default false,
  max_members int not null default 10 check (max_members between 2 and 10),
  auto_approve boolean not null default false,
  is_open boolean not null default true,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (not auto_approve or is_public)
);

create table public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create index room_members_room_idx on public.room_members (room_id);

create table public.member_platforms (
  member_id uuid not null references public.room_members (id) on delete cascade,
  platform_id int not null references public.platforms (id) on delete cascade,
  primary key (member_id, platform_id)
);

create table public.member_subscriptions (
  member_id uuid not null references public.room_members (id) on delete cascade,
  subscription_id int not null references public.subscriptions (id) on delete cascade,
  primary key (member_id, subscription_id)
);

-- La PK (member_id, genre_id) impide que un género esté a la vez en like y avoid.
create table public.member_genres (
  member_id uuid not null references public.room_members (id) on delete cascade,
  genre_id int not null references public.genres (id) on delete cascade,
  preference text not null check (preference in ('like', 'avoid')),
  primary key (member_id, genre_id)
);

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  game_id int not null references public.games (id),
  batch_id uuid not null,
  reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index suggestions_room_batch_idx on public.suggestions (room_id, batch_id);

create table public.ratings (
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  score int not null check (score between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);

-- Cupo: impide aprobar miembros (o crear solicitudes) por encima de max_members
-- o en rooms cerrados, y rechaza bajar max_members por debajo de los aprobados.
create function public.enforce_member_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms%rowtype;
  v_approved int;
begin
  select * into v_room from rooms where id = new.room_id;

  if tg_op = 'INSERT' and not v_room.is_open then
    raise exception 'El room está cerrado a nuevas solicitudes';
  end if;

  select count(*) into v_approved
  from room_members
  where room_id = new.room_id and status = 'approved' and id <> new.id;

  if v_approved >= v_room.max_members
     and (new.status = 'approved' or tg_op = 'INSERT') then
    raise exception 'El room alcanzó su máximo de % miembros', v_room.max_members;
  end if;

  return new;
end;
$$;

create trigger room_members_capacity
before insert or update of status on public.room_members
for each row execute function public.enforce_member_capacity();

create function public.enforce_room_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approved int;
begin
  select count(*) into v_approved
  from room_members
  where room_id = new.id and status = 'approved';

  if new.max_members < v_approved then
    raise exception 'No puedes bajar el máximo (%) por debajo de los % miembros aprobados',
      new.max_members, v_approved;
  end if;

  return new;
end;
$$;

create trigger rooms_capacity
before update of max_members on public.rooms
for each row execute function public.enforce_room_capacity();
