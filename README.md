# Game Room Match

Game Room Match ayuda a grupos de jugadores a encontrar juegos que puedan
disfrutar juntos. Cada miembro indica sus plataformas, suscripciones y
preferencias de género; la aplicación usa esa información para generar
sugerencias compartidas.

## Arquitectura

- **Frontend:** aplicación SPA construida con Vite, React y TypeScript.
- **Hosting:** GitHub Pages, con despliegue automatizado mediante GitHub Actions.
- **Backend:** Supabase, utilizado para autenticación, base de datos PostgreSQL
  protegida con RLS y Edge Functions.
- **Routing:** `HashRouter`, para que las rutas funcionen correctamente en
  GitHub Pages.

La aplicación usa únicamente la clave pública `anon` de Supabase en el
frontend. La autorización y la protección de los datos se implementan en
Supabase mediante RLS.

## Configuración y ejecución local

Requisitos:

- Node.js 20 o superior
- npm
- Un proyecto de Supabase

Instala las dependencias:

```bash
npm install
```

Copia `.env.example` a `.env.local` y completa las variables de tu proyecto:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Inicia el servidor de desarrollo:

```bash
npm run dev
```

Para validar el proyecto localmente:

```bash
npm run lint
npm run typecheck
npm run build
```

## Despliegue

El despliegue en GitHub Pages se ejecuta automáticamente al hacer push a la
rama `main`. La configuración detallada de Supabase, las migraciones, los
seeds y las Edge Functions se completará en fases posteriores del proyecto.
