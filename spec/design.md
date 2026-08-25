# Design — Game Room Match

## 1. Arquitectura

```
[GitHub Pages]  SPA estática (Vite + React + TS)
      |
      | supabase-js (HTTPS, anon key)
      v
[Supabase]  Auth (email/password)
            Postgres + RLS
            Edge Function: generate-suggestions
```

- **Hosting**: GitHub Pages con deploy vía GitHub Actions (`actions/deploy-pages`, sin branch `gh-pages`). Routing con hash router (`/#/...`) para evitar 404 en Pages.
- **Backend**: proyecto Supabase. El cliente usa solo la `anon key`; toda la autorización vive en RLS.
- **Generación de sugerencias**: Edge Function `generate-suggestions` (Deno/TS) que consulta el catálogo de juegos y los perfiles del room.

## 2. Modelo de datos (Postgres)

Catálogos (lectura pública):
- `platforms(id, family, name)` — ej. family=`xbox`, name=`Xbox Series X`; family=`mobile`, name=`Android`.
- `subscriptions(id, name, tier, kind ∈ {subscription, cloud})` — ej. `Xbox Game Pass / Ultimate`, `Amazon Luna`, `GeForce NOW`. Los servicios en la nube se modelan como filas de esta tabla con `kind='cloud'`.
- `genres(id, name)`.
- `games(id, title, cover_url, metadata)`.
- `game_genres(game_id, genre_id)`.
- `game_availability(game_id, platform_id NULL, subscription_id NULL)` — un juego es accesible por plataforma (compra) o por suscripción/nube. CHECK: exactamente uno de los dos no nulo.

Datos de usuario:
- `rooms(id, slug UNIQUE, name, description, is_public boolean, max_members int DEFAULT 10 CHECK (max_members BETWEEN 2 AND 10), auto_approve boolean DEFAULT false, is_open boolean DEFAULT true, owner_id → auth.users, created_at)`.
  - CHECK: `auto_approve` solo puede ser true si `is_public`.
  - Vista `public_rooms` (SECURITY DEFINER / `security_invoker=off`) que expone solo `slug, name, description, member_count, max_members` de rooms públicos y abiertos (`is_public AND is_open`); el conteo se calcula en la vista sin exponer `room_members` a `anon`.
- `room_members(id, room_id, user_id, status ∈ {pending, approved, rejected}, UNIQUE(room_id, user_id))`.
- `member_platforms(member_id, platform_id)`.
- `member_subscriptions(member_id, subscription_id)`.
- `member_genres(member_id, genre_id, preference ∈ {like, avoid})` con CHECK que impide duplicar genre por miembro.
- `suggestions(id, room_id, game_id, batch_id, reason jsonb, created_at)`.
- `ratings(suggestion_id, user_id, score int CHECK 1..5, UNIQUE(suggestion_id, user_id))`.

### RLS (resumen)
- Catálogos: `SELECT` para `anon` y `authenticated`.
- `rooms`: SELECT para `anon`/`authenticated` de rooms públicos (vía vista `public_rooms`) y por slug para authenticated (para poder solicitar unirse a privados); INSERT con `owner_id = auth.uid()`; UPDATE/DELETE solo owner.
- `room_members`: INSERT propio con status `pending` (o `approved` si `user_id = owner`, o si el room es público con `auto_approve`); UPDATE de `status` solo por el owner del room; SELECT para el propio usuario y para miembros aprobados del room.
- Cupo: trigger/función `enforce_room_capacity` impide aprobar o auto-aprobar miembros por encima de `max_members`, y rechaza bajar `max_members` por debajo de los aprobados actuales.
- Re-solicitudes: UNIQUE(room_id, user_id) impide crear una segunda solicitud; un `rejected` no puede cambiar su propio status (solo el owner).
- `member_*`: CRUD solo del propio miembro; SELECT para miembros aprobados del mismo room.
- `suggestions`: SELECT miembros aprobados; INSERT solo por la Edge Function (service role).
- `ratings`: INSERT/UPDATE propio si es miembro aprobado; SELECT miembros aprobados.

Funciones helper en SQL: `is_room_owner(room_id)`, `is_approved_member(room_id)` (SECURITY DEFINER) para usar en políticas.

## 3. Flujos

### 3.0 Landing / listado de rooms
1. Sin sesión: la home lista los rooms públicos abiertos (nombre, descripción, miembros/máximo) con botón "Solicitar unirse" (lleva a login) y CTA "Crear room".
2. Con sesión: sección "Mis rooms" primero (rooms donde soy owner o miembro, con mi estado), luego el listado público.

### 3.1 Crear room
1. Sign up / sign in (email + contraseña) → sesión Supabase.
2. Formulario de configuración: nombre, descripción corta, público/privado, máx. de miembros (2–10, default 10), aprobación automática (solo públicos) → INSERT `rooms` (slug generado) + INSERT `room_members(status='approved')` para el owner.
3. Pantalla del room muestra el link de invitación `https://<user>.github.io/game-room-match/#/join/<slug>` con botón copiar.
4. Tab "Configuración" (solo owner) para editar estos campos y cerrar el room a nuevas solicitudes.

### 3.2 Unirse a un room
1. Abrir link de invitación (o "Solicitar unirse" en un room público) → sign up / sign in.
2. INSERT `room_members(status='pending')` → pantalla "esperando aprobación"; si el room es público con `auto_approve` y hay cupo, entra directo como `approved`. Si el room está cerrado (`is_open=false`) o lleno, se muestra el motivo y no se crea la solicitud.
3. El owner ve solicitudes pendientes en el panel del room y aprueba/rechaza (UPDATE status).
4. Realtime (supabase channel) o polling refresca el estado del solicitante.

### 3.3 Perfil de gustos
Wizard de 2 pasos para el miembro aprobado:
1. Plataformas (checkboxes agrupados por familia con versión) + suscripciones + servicios en la nube.
2. Géneros favoritos y géneros a evitar.
Guardado incremental en `member_platforms` / `member_subscriptions` / `member_genres`. El perfil es editable después.

### 3.4 Generar sugerencias
1. Botón "Generar sugerencias" (habilitado solo si todos los aprobados tienen perfil completo; si no, lista quiénes faltan).
2. Llama a la Edge Function `generate-suggestions(room_id)` con el JWT del usuario; la función verifica membresía aprobada.
3. Algoritmo (en la función, con service role):
   - `accessible(member)` = juegos con `game_availability` que intersecte las plataformas o suscripciones del miembro.
   - Candidatos = ∩ accessible(m) para todos los miembros aprobados con perfil completo.
   - Excluir juegos con algún género en `avoid` de cualquier miembro y juegos sugeridos en las últimas N=3 tandas del room.
   - Score = cobertura de géneros `like` del grupo + ajuste por historial de `ratings` (promedio de ratings previos del room sobre juegos del mismo género, normalizado).
   - Insertar top K (K=5) en `suggestions` con `reason` (qué plataforma/suscripción habilita a cada miembro y qué géneros coinciden).
4. La UI muestra la tanda con cover, géneros, `reason` y promedio de rating.

### 3.5 Calificar
- Componente de 1–5 estrellas por sugerencia; upsert en `ratings`. El agregado del room se muestra en vivo.

## 4. Frontend

- Vite + React + TypeScript, `@supabase/supabase-js`, hash routing (react-router `HashRouter`).
- Páginas: `Home` (mis rooms + rooms públicos, crear room), `Auth`, `Room` (tabs: Sugerencias, Miembros, Mi perfil, Configuración [owner]), `Join/<slug>`.
- Estado de sesión con el listener de Supabase Auth; guards por estado de membresía.
- Config `SUPABASE_URL` y `SUPABASE_ANON_KEY` como constantes de build (la anon key es pública por diseño).

## 5. Despliegue y CI/CD

- Workflow `.github/workflows/deploy.yml`: en cada push a `main` — instalar deps (`npm ci`), lint + typecheck, build de Vite y deploy de `dist/` a GitHub Pages (actions `upload-pages-artifact` + `deploy-pages`). En PRs corre solo lint/typecheck/build.
- `README.md` en la raíz: descripción del proyecto, arquitectura (Pages + Supabase), setup local, configuración de Supabase (migraciones, seeds, Edge Functions) y guía de despliegue.
- Migraciones SQL versionadas en `supabase/migrations/`; seeds de catálogos (`platforms`, `subscriptions`, `genres`, `games` iniciales) en `supabase/seed.sql`.
- Edge Function en `supabase/functions/generate-suggestions/`.

## 6. Validación del diseño

- RLS probada con tests SQL (pgTAP o scripts): un usuario `pending` no lee datos del room; un no-owner no puede aprobar miembros; un miembro no puede calificar dos veces.
- La Edge Function rechaza llamadas de usuarios no aprobados (401/403).
- Verificación E2E del flujo dorado: crear room → invitar → aprobar → perfiles → generar sugerencias → calificar → regenerar y observar el efecto de los ratings.
