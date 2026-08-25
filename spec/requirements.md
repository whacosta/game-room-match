# Requirements — Game Room Match

Aplicación web pública (GitHub Pages + Supabase) que genera sugerencias de juegos para un grupo de amigos ("room") según las plataformas, suscripciones y gustos de cada miembro.

## R1 — Creación de rooms
- R1.1: Cualquier visitante puede crear un room registrándose con correo y contraseña (Supabase Auth, email/password).
- R1.2: Al crear el room, el creador se convierte automáticamente en su **owner** y miembro aprobado.
- R1.3: Cada room tiene un nombre y un código/slug único usado en el link de invitación.
- R1.4: Al crear el room se configura: nombre, descripción corta, visibilidad (público/privado) y cantidad máxima de miembros (por defecto 10, tope máximo 10).

**Validaciones R1**
- Correo con formato válido; contraseña mínimo 8 caracteres.
- No se puede crear un room sin sesión autenticada.
- El slug del room es único (constraint UNIQUE en BD).
- Nombre 3–50 caracteres; descripción ≤200 caracteres; `max_members` entre 2 y 10 (CHECK en BD).

## R1b — Configuración y visibilidad de rooms
- R1b.1: El owner puede editar la configuración del room en cualquier momento: nombre, descripción, visibilidad, máximo de miembros, y si la aprobación de miembros es manual (por defecto) o automática para rooms públicos.
- R1b.2: Rooms **públicos**: aparecen en el listado público y cualquiera puede solicitar unirse desde ahí. Rooms **privados**: solo accesibles vía link de invitación.
- R1b.3: La página de inicio muestra el listado de rooms públicos (nombre, descripción, nº de miembros / máximo) sin necesidad de sesión.
- R1b.4: Con sesión iniciada, primero se muestran "Mis rooms" (donde soy owner o miembro) y debajo los rooms públicos.
- R1b.5: El owner puede cerrar el room a nuevas solicitudes.

**Validaciones R1b**
- Solo el owner puede modificar la configuración (RLS).
- No se aceptan solicitudes ni aprobaciones si el room alcanzó `max_members` (validado en BD/función, no solo en UI).
- No se puede reducir `max_members` por debajo del número actual de miembros aprobados.
- El listado público solo expone datos no sensibles del room (nunca correos de los miembros).

## R2 — Invitación y aprobación de miembros
- R2.1: El owner puede copiar/compartir un link de invitación (`/#/join/<slug>`).
- R2.2: Quien abre el link (o un room público del listado) se registra o inicia sesión con su correo y solicita unirse; queda en estado `pending` (o `approved` directo si el room público tiene aprobación automática).
- R2.3: El owner ve la lista de solicitudes y puede aprobar (`approved`) o rechazar (`rejected`) a cada solicitante.
- R2.4: Solo los miembros `approved` pueden ver el contenido del room y participar.

**Validaciones R2**
- Un correo solo puede tener una membresía por room (UNIQUE(room_id, user_id)).
- Un miembro `pending`/`rejected` no puede leer datos internos del room (RLS).
- Solo el owner puede cambiar el estado de una membresía.

## R3 — Formulario de plataformas y suscripciones
- R3.1: Cada miembro aprobado completa un formulario indicando las plataformas que posee: PC, celular (iOS / Android), Xbox (One, Series S/X), PlayStation (PS4, PS5), Nintendo Switch (Switch, Switch 2), etc., con su versión/modelo.
- R3.2: Cada miembro indica sus suscripciones de juegos: Xbox Game Pass (Core/Standard/Ultimate), PlayStation Plus (Essential/Extra/Premium), Nintendo Switch Online, EA Play, Ubisoft+, Apple Arcade, Google Play Pass, etc.
- R3.3: Incluye servicios de juego en la nube: Amazon Luna, GeForce NOW, Xbox Cloud Gaming, etc.
- R3.4: El formulario es editable en cualquier momento; los cambios afectan las siguientes sugerencias.

**Validaciones R3**
- Debe seleccionarse al menos una plataforma para considerar el perfil "completo".
- Las opciones provienen de catálogos (tablas `platforms`, `subscriptions`) — no texto libre.
- Un miembro solo puede editar su propio perfil (RLS).

## R4 — Categorías / géneros favoritos
- R4.1: Cada miembro elige las categorías de juegos que le gustan (acción, aventura, RPG, shooter, deportes, carreras, estrategia, puzzle, party, cooperativo, terror, simulación, etc.) desde un catálogo `genres`.
- R4.2: Se pueden marcar múltiples categorías, y opcionalmente categorías que se quieren evitar.

**Validaciones R4**
- Al menos una categoría "me gusta" para considerar el perfil completo.
- Una categoría no puede estar a la vez en "me gusta" y "evitar".

## R5 — Generación de sugerencias
- R5.1: El room genera sugerencias de juegos que **todos** los miembros aprobados con perfil completo puedan jugar: el juego debe estar disponible en al menos una plataforma/suscripción/servicio en la nube de **cada** miembro.
- R5.2: Las sugerencias priorizan la intersección de categorías favoritas del grupo y excluyen las categorías vetadas.
- R5.3: Cualquier miembro aprobado puede solicitar generar una nueva tanda de sugerencias; no se repiten juegos ya sugeridos recientemente.
- R5.4: Cada sugerencia muestra el juego, sus géneros y por qué cumple (plataformas/suscripciones que lo hacen accesible a cada miembro).

**Validaciones R5**
- No se generan sugerencias si algún miembro aprobado no completó su perfil (se muestra quiénes faltan).
- Cada juego sugerido cumple la disponibilidad para el 100% de los miembros aprobados con perfil completo.
- La generación se ejecuta en el backend (Edge Function / SQL), nunca con lógica confiable solo en el cliente.

## R6 — Calificación y aprendizaje
- R6.1: Cada miembro puede calificar cada sugerencia (p. ej. 1–5 estrellas o 👍/👎).
- R6.2: Las calificaciones ajustan las siguientes sugerencias: juegos/géneros mal calificados pierden prioridad; los bien calificados suben géneros afines.
- R6.3: Se muestra la calificación agregada del room por sugerencia.

**Validaciones R6**
- Un miembro solo puede calificar una vez por sugerencia (UNIQUE(suggestion_id, user_id)), pudiendo actualizar su voto.
- Solo miembros aprobados del room pueden calificar sus sugerencias.

## Requisitos no funcionales
- Frontend estático (SPA) desplegado en GitHub Pages; sin servidor propio.
- Backend 100% Supabase: Auth, Postgres con Row Level Security, Edge Functions.
- Toda regla de autorización se aplica con RLS; las claves usadas en el cliente son solo la `anon key`.
- UI responsive (uso principal en celular) y en español.
- El repositorio incluye un `README.md` con descripción, arquitectura, setup local y guía de despliegue.
- CI/CD con GitHub Actions: build y deploy automático a GitHub Pages en cada push a `main`.
