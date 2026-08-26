---
name: testing-game-room-match
description: Cómo probar end-to-end Game Room Match (SPA React + Supabase, hash routing) en el sitio publicado de GitHub Pages, incluyendo creación de cuentas de prueba, flujos multiusuario (owner / solicitante / tercero) y verificación del asset desplegado.
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

## Datos de prueba
Los rooms/cuentas de prueba pueden quedarse en el proyecto de desarrollo. Cerrar un room (Configuración → desmarcar "Room abierto") lo saca de la vista `public_rooms`, por lo que deja de aparecer en el listado público.

## Devin Secrets Needed
- `SUPABASE_ACCESS_TOKEN`: Management API de Supabase (leer/ajustar config de auth, migraciones, Edge Functions).
