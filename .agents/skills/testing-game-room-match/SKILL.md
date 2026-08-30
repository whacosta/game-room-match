---
name: testing-game-room-match
description: Cómo probar end-to-end Game Room Match (SPA React + Supabase, hash routing) en el sitio publicado de GitHub Pages, incluyendo creación de cuentas de prueba, flujos multiusuario (owner / solicitante / tercero), perfiles de gustos, sugerencias vía Edge Function, ratings y verificación del asset desplegado.
---

# Probar Game Room Match end-to-end

## Entornos
- Sitio publicado: https://whacosta.github.io/game-room-match/ (GitHub Pages, hash routing: `/#/auth`, `/#/create`, `/#/room/<slug>`, `/#/join/<slug>`).
- Verificar qué build está sirviéndose: `curl -s https://whacosta.github.io/game-room-match/ | grep assets/index-` y comparar el hash con el esperado. GitHub Pages puede tardar en propagar.
- Backend Supabase live (proyecto de desarrollo). La `anon/publishable key` va embebida en el bundle: `curl -s <url>/assets/index-*.js | grep -o "sb_publishable_[A-Za-z0-9_-]*"` y la URL con `grep -o "https://[a-z0-9]*\.supabase\.co"`. Útil para sondear la API de auth durante el *setup* (no para simular la UI).

## Cuentas de prueba (importante)
- Supabase **rechaza `@example.com`** con `email_address_invalid`. Usar `@mailinator.com` (p. ej. `devin-test-a<rand>@mailinator.com`), contraseña ≥8 (`TestPass1234`).
- Si `mailer_autoconfirm=false` en el proyecto, el registro NO devuelve sesión y el login falla con `email_not_confirmed`; además el SMTP por defecto limita a ~2 correos/hora, así que no se pueden crear varias cuentas. Comprobarlo y, en proyectos de desarrollo, activarlo con la Management API (requiere `SUPABASE_ACCESS_TOKEN`):
  ```bash
  curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    https://api.supabase.com/v1/projects/<ref>/config/auth | grep -o '"mailer_autoconfirm":[a-z]*'
  curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    https://api.supabase.com/v1/projects/<ref>/config/auth -d '{"mailer_autoconfirm":true}'
  ```
  Reportarlo siempre como hallazgo/decisión de producto (¿se quiere confirmación de correo?), y consultar antes de revertirlo.

## Sesiones simultáneas (flujos multiusuario)
- Ventana normal = cuenta A (owner); `google-chrome --incognito <url>` = cuenta B. El perfil incógnito es compartido entre ventanas incógnito, así que para una tercera cuenta hay que "Cerrar sesión" en incógnito y registrar la cuenta C ahí.
- Mosaico lado a lado en KDE/Plasma: `wmctrl -r ... -e` y `xdotool windowsize` suelen ser ignorados; lo que funciona es activar la ventana y usar `xdotool key super+Left` / `super+Right`. Ideal para demostrar polling/tiempo real (owner aprueba a la izquierda, el solicitante se actualiza solo a la derecha).

## Trampas conocidas de la UI
- En `/#/auth`, al alternar entre "Iniciar sesión" y "Regístrate" los campos se re-renderizan y el foco/posición cambian: rellenar SIEMPRE después de cambiar de modo y verificar con captura que el email no acabó en el campo de contraseña.
- Los `<input>` llevan `minLength`/`min`/`max` de HTML, por lo que las validaciones nativas del navegador (en inglés) se disparan antes que los mensajes en español del código (`src/pages/AuthPage.tsx`, `src/pages/CreateRoomPage.tsx`). Al probar mensajes localizados, distinguir claramente el aviso nativo del banner de la app.
- `JoinPage` refresca el estado de la membresía por *polling* cada 5 s (`window.setInterval`), no por Realtime: esperar ~10 s antes de declarar fallo, sin recargar la página.
- Los slugs incluyen sufijo aleatorio (`slugify` en `src/lib/room.ts`): copiar el slug real de la URL tras crear el room.
- Las tarjetas de "Mis rooms" en `HomePage.tsx` fijan `member_count: 0`, así que muestran "0/N miembros" aunque haya miembros: no confundirlo con un fallo de datos del backend.

## Perfiles, sugerencias y ratings (Fases 3–5)
- Rutas: el tab "Mi perfil" del room es un `<Link>` a `/#/room/<slug>/profile` (página aparte con "← Volver al room"), no un tab in-place. El tab por defecto del room es "Sugerencias".
- El formulario de perfil usa `noValidate`, así que sus mensajes en español SÍ son alcanzables: "Selecciona al menos una plataforma.", "Selecciona al menos un género favorito.", éxito "Perfil guardado correctamente.".
- Exclusión mutua favorito/evitado: marcar un género en "Prefiero evitar" desmarca automáticamente el mismo género en "Me gustan" (y viceversa). Verificarlo por los contadores "N favoritos" / "N seleccionadas".
- Bloqueo por perfil incompleto: `RoomPage` calcula `canGenerate` leyendo `member_platforms`/`member_genres` de TODOS los aprobados (RLS lo permite a miembros aprobados). Si falta alguno, se muestra "Completa el perfil de estos miembros para generar una tanda:" + un chip por miembro (Owner / Tú / uuid abreviado) y el botón "Generar sugerencias" queda **deshabilitado**. Por eso el 409 del servidor con `incomplete_user_ids` (y el texto "Perfiles incompletos indicados por el servidor:") **no es alcanzable desde la UI**: no intentar probarlo por navegador; verificarlo, si hace falta, invocando la Edge Function con un token de sesión.
- `RoomPage` NO refresca solo: después de que otra cuenta guarde su perfil, vote o genere una tanda hay que **recargar (F5)** la ventana. No hay polling ni Realtime en el tab de sugerencias (solo `JoinPage` hace polling). Antes de declarar "no se actualiza en vivo" como bug, contrastar con el requisito del usuario.
- La Edge Function `generate-suggestions` está desplegada si un POST sin sesión responde **401** (un 404 significaría que no existe).
- Diseñar los perfiles con `supabase/seed.sql` para poder predecir la tanda: candidatos = intersección de juegos accesibles por plataforma/suscripción de todos los miembros, menos la **unión de géneros evitados de todos** (un evitado de un miembro veta el género aunque otro lo tenga como favorito), menos los juegos de las **últimas 3 tandas**; se ordena por cobertura de géneros gustados (0.8) + rating histórico (0.2) con desempate **alfabético** y se cortan 5. Con ambos en "PC", A gustos {Cooperativo, Battle Royale} y B gustos {Puzzle, Aventura} + evitado {Battle Royale}, la tanda 1 es exactamente: A Way Out, Don't Starve Together, Grounded, Human: Fall Flat, It Takes Two.
- Ratings: cada card muestra "Promedio del room: ★ N.N" (calculado en cliente) y "Tu valoración" con hint "Sin votar"/"N/5". El voto es un upsert por `(suggestion_id,user_id)`, así que revotar cambia el voto y no crea uno nuevo: comprobarlo con la aritmética del promedio (p. ej. 3 y 2 → ★ 2.5, no 4.0).
- Ojo con las "razones por miembro": `matching_genres` se calcula con la **unión** de géneros gustados del room, de modo que todos los miembros muestran la misma lista de géneros aunque no sean sus gustos. Podría estar corregido más adelante; si se ve, comprobarlo con un juego cuyo género solo guste a uno de los miembros.

## Datos de prueba
Los rooms/cuentas de prueba pueden quedarse en el proyecto de desarrollo. Cuentas ya existentes y reutilizables: `devin-test-{a,b,c}4821@mailinator.com` con contraseña `TestPass1234` (verificar antes con un POST a `/auth/v1/token?grant_type=password`). Cerrar un room (Configuración → desmarcar "Room abierto") lo saca de la vista `public_rooms`, por lo que deja de aparecer en el listado público.

## Devin Secrets Needed
- `SUPABASE_ACCESS_TOKEN`: Management API de Supabase (leer/ajustar config de auth, migraciones, Edge Functions).
