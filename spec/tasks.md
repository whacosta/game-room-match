# Tasks — Game Room Match

Plan de implementación por fases. Cada tarea incluye su criterio de validación (✔).

## Fase 0 — Infraestructura
- [ ] T0.1 Crear proyecto Supabase y guardar `SUPABASE_URL` / `SUPABASE_ANON_KEY`.
  - ✔ El proyecto responde en el dashboard y la anon key funciona con `supabase-js`.
- [ ] T0.2 Scaffold del frontend (Vite + React + TS) con `HashRouter` y cliente Supabase.
  - ✔ `npm run dev` levanta la app y `npm run build` genera `dist/` sin errores.
- [ ] T0.3 Workflow de GitHub Actions que publica `dist/` a GitHub Pages en cada push a `main`.
  - ✔ La app carga en `https://whacosta.github.io/game-room-match/`.

## Fase 1 — Datos y seguridad
- [ ] T1.1 Migración con catálogos: `platforms`, `subscriptions`, `genres`, `games`, `game_genres`, `game_availability`.
  - ✔ Constraints CHECK/UNIQUE aplicados; `SELECT` público funciona con anon key.
- [ ] T1.2 Migración con tablas de usuario: `rooms`, `room_members`, `member_platforms`, `member_subscriptions`, `member_genres`, `suggestions`, `ratings`.
  - ✔ UNIQUE(room_id,user_id), UNIQUE(suggestion_id,user_id) y CHECKs verificados con inserts de prueba.
- [ ] T1.3 Políticas RLS + funciones `is_room_owner` / `is_approved_member`.
  - ✔ Tests: pending no lee el room; no-owner no aprueba; miembro solo edita su perfil.
- [ ] T1.4 Seed de catálogos (plataformas con versiones, suscripciones incl. Amazon Luna/GeForce NOW, géneros, ~50 juegos iniciales con disponibilidad).
  - ✔ Los catálogos aparecen en la UI y cada juego seed tiene ≥1 género y ≥1 disponibilidad.

## Fase 2 — Auth y rooms
- [ ] T2.1 Pantalla de registro/inicio de sesión (email + contraseña).
  - ✔ Validación de email y contraseña ≥8; errores de Supabase mostrados en español.
- [ ] T2.2 Crear room (nombre → slug único) y membresía approved del owner.
  - ✔ Al crear, se redirige al room y el owner aparece como miembro aprobado.
- [ ] T2.3 Link de invitación con botón copiar + página `/#/join/<slug>`.
  - ✔ Abrir el link sin sesión pide login y luego crea la solicitud `pending`.
- [ ] T2.4 Panel de miembros del owner: aprobar/rechazar solicitudes.
  - ✔ El solicitante ve el cambio de estado sin recargar (realtime o polling).

## Fase 3 — Perfil de gustos
- [ ] T3.1 Formulario de plataformas (por familia y versión), suscripciones y servicios en la nube.
  - ✔ Guarda y recarga selecciones; exige ≥1 plataforma.
- [ ] T3.2 Selección de géneros favoritos y géneros a evitar.
  - ✔ Exige ≥1 favorito; impide marcar un género en ambas listas.
- [ ] T3.3 Indicador de perfil completo por miembro en el panel del room.
  - ✔ El room lista quiénes tienen perfil incompleto.

## Fase 4 — Sugerencias
- [ ] T4.1 Edge Function `generate-suggestions`: intersección de disponibilidad, exclusión de géneros vetados y juegos recientes, score por géneros.
  - ✔ Con perfiles de prueba, cada juego devuelto es jugable por el 100% de los miembros; test con un miembro sin plataformas comunes devuelve lista vacía y mensaje claro.
- [ ] T4.2 UI de sugerencias: tanda con cover, géneros, `reason` por miembro y botón regenerar.
  - ✔ Botón deshabilitado con perfiles incompletos, mostrando quiénes faltan.
- [ ] T4.3 No repetir juegos de los últimos N batches.
  - ✔ Dos generaciones consecutivas no comparten juegos (mientras haya candidatos suficientes).

## Fase 5 — Calificaciones
- [ ] T5.1 Rating 1–5 estrellas por sugerencia con upsert.
  - ✔ Un segundo voto del mismo usuario actualiza, no duplica; promedio del room visible.
- [ ] T5.2 Incorporar ratings al score de la Edge Function.
  - ✔ Tras calificar mal todos los juegos de un género, la siguiente tanda reduce ese género; test automatizado del score.

## Fase 6 — Cierre
- [ ] T6.1 Pruebas E2E del flujo dorado (crear → invitar → aprobar → perfiles → sugerir → calificar → regenerar).
  - ✔ Flujo completo pasa en el sitio publicado de GitHub Pages con 2+ cuentas.
- [ ] T6.2 README con setup (Supabase, variables, deploy) y capturas.
  - ✔ Una persona nueva puede desplegar su propia instancia siguiendo el README.
