-- Funciones helper, vista pública y políticas RLS.

create function public.is_room_owner(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from rooms where id = p_room_id and owner_id = auth.uid()
  );
$$;

create function public.is_approved_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_members
    where room_id = p_room_id and user_id = auth.uid() and status = 'approved'
  );
$$;

-- true si la membresía p_member_id pertenece al usuario actual y está aprobada.
create function public.owns_member(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_members
    where id = p_member_id and user_id = auth.uid() and status = 'approved'
  );
$$;

-- room del que forma parte una membresía (para políticas de member_*).
create function public.member_room(p_member_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select room_id from room_members where id = p_member_id;
$$;

-- Listado público: expone solo datos no sensibles de rooms públicos y abiertos.
create view public.public_rooms
with (security_invoker = off)
as
select
  r.slug,
  r.name,
  r.description,
  (select count(*) from public.room_members m
   where m.room_id = r.id and m.status = 'approved') as member_count,
  r.max_members
from public.rooms r
where r.is_public and r.is_open;

grant select on public.public_rooms to anon, authenticated;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.member_platforms enable row level security;
alter table public.member_subscriptions enable row level security;
alter table public.member_genres enable row level security;
alter table public.suggestions enable row level security;
alter table public.ratings enable row level security;

-- rooms: anon solo ve la vista public_rooms; authenticated puede leer cualquier
-- room (necesario para resolver el slug de un link de invitación privado).
create policy "rooms select" on public.rooms
for select to authenticated using (true);

create policy "rooms insert own" on public.rooms
for insert to authenticated with check (owner_id = auth.uid());

create policy "rooms update owner" on public.rooms
for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "rooms delete owner" on public.rooms
for delete to authenticated using (owner_id = auth.uid());

-- room_members
create policy "members select" on public.room_members
for select to authenticated
using (user_id = auth.uid() or is_room_owner(room_id) or is_approved_member(room_id));

-- INSERT propio: pending en room abierto; approved solo si eres el owner
-- o el room es público con auto_approve (el trigger valida cupo y cierre).
create policy "members insert own" on public.room_members
for insert to authenticated
with check (
  user_id = auth.uid()
  and (
    (status = 'approved' and is_room_owner(room_id))
    or exists (
      select 1 from public.rooms r
      where r.id = room_id
        and r.is_open
        and (
          status = 'pending'
          or (status = 'approved' and r.is_public and r.auto_approve)
        )
    )
  )
);

-- Solo el owner cambia el status (un rejected no puede auto-reactivarse).
create policy "members update owner" on public.room_members
for update to authenticated
using (is_room_owner(room_id)) with check (is_room_owner(room_id));

-- Salir del room (no si fuiste rechazado: impediría el bloqueo de re-solicitudes).
create policy "members delete" on public.room_members
for delete to authenticated
using ((user_id = auth.uid() and status <> 'rejected') or is_room_owner(room_id));

-- member_*: CRUD del propio miembro aprobado; lectura para el room.
create policy "member_platforms select" on public.member_platforms
for select to authenticated
using (owns_member(member_id) or is_approved_member(member_room(member_id)));

create policy "member_platforms write" on public.member_platforms
for all to authenticated
using (owns_member(member_id)) with check (owns_member(member_id));

create policy "member_subscriptions select" on public.member_subscriptions
for select to authenticated
using (owns_member(member_id) or is_approved_member(member_room(member_id)));

create policy "member_subscriptions write" on public.member_subscriptions
for all to authenticated
using (owns_member(member_id)) with check (owns_member(member_id));

create policy "member_genres select" on public.member_genres
for select to authenticated
using (owns_member(member_id) or is_approved_member(member_room(member_id)));

create policy "member_genres write" on public.member_genres
for all to authenticated
using (owns_member(member_id)) with check (owns_member(member_id));

-- suggestions: solo lectura para miembros aprobados; las inserta la
-- Edge Function con service role (bypassa RLS), sin política de INSERT.
create policy "suggestions select" on public.suggestions
for select to authenticated using (is_approved_member(room_id));

-- ratings: un voto propio por sugerencia, actualizable.
create policy "ratings select" on public.ratings
for select to authenticated
using (is_approved_member((select s.room_id from public.suggestions s where s.id = suggestion_id)));

create policy "ratings insert own" on public.ratings
for insert to authenticated
with check (
  user_id = auth.uid()
  and is_approved_member((select s.room_id from public.suggestions s where s.id = suggestion_id))
);

create policy "ratings update own" on public.ratings
for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
