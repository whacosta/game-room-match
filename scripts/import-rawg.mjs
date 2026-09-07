// Importa juegos populares desde la API de RAWG (https://rawg.io/apidocs) y
// genera SQL idempotente para poblar los catálogos de Supabase.
//
// Uso:
//   RAWG_API_KEY=... node scripts/import-rawg.mjs [paginas] > /tmp/rawg-import.sql
//
// - Cada página trae 40 juegos ordenados por popularidad (-added). Por defecto 8 páginas (~320 juegos).
// - Solo se importan juegos con al menos una plataforma y un género mapeables al catálogo.
// - Los juegos ya existentes (mismo título) actualizan su cover_url y metadata.
// - La disponibilidad por suscripción/cloud no viene de RAWG y se mantiene manual.

const API_KEY = process.env.RAWG_API_KEY
if (!API_KEY) {
  console.error('Falta RAWG_API_KEY en el entorno.')
  process.exit(1)
}

const PAGES = Number(process.argv[2] ?? '8')

// RAWG genre slug -> nombre en public.genres
const GENRE_MAP = new Map([
  ['action', 'Acción'],
  ['adventure', 'Aventura'],
  ['role-playing-games-rpg', 'RPG'],
  ['shooter', 'Shooter'],
  ['strategy', 'Estrategia'],
  ['sports', 'Deportes'],
  ['racing', 'Carreras'],
  ['puzzle', 'Puzzle'],
  ['platformer', 'Plataformas'],
  ['fighting', 'Lucha'],
  ['simulation', 'Simulación'],
  ['indie', 'Indie'],
])

// RAWG tag slug -> nombre en public.genres (géneros que RAWG modela como tags)
const TAG_MAP = new Map([
  ['horror', 'Terror'],
  ['survival-horror', 'Terror'],
  ['co-op', 'Cooperativo'],
  ['online-co-op', 'Cooperativo'],
  ['local-co-op', 'Cooperativo'],
  ['battle-royale', 'Battle Royale'],
  ['sandbox', 'Sandbox'],
])

// RAWG platform slug -> nombre en public.platforms
const PLATFORM_MAP = new Map([
  ['pc', 'PC'],
  ['ios', 'iOS'],
  ['android', 'Android'],
  ['xbox-one', 'Xbox One'],
  ['xbox-series-x', 'Xbox Series S|X'],
  ['playstation4', 'PlayStation 4'],
  ['playstation5', 'PlayStation 5'],
  ['nintendo-switch', 'Nintendo Switch'],
])

const q = (value) => `'${String(value).replaceAll("'", "''")}'`

async function fetchPage(page) {
  const url = `https://api.rawg.io/api/games?key=${API_KEY}&ordering=-added&page_size=40&page=${page}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`RAWG respondió ${response.status} en la página ${page}`)
  }
  return response.json()
}

const games = []
for (let page = 1; page <= PAGES; page += 1) {
  const data = await fetchPage(page)
  for (const item of data.results ?? []) {
    const platforms = [
      ...new Set(
        (item.platforms ?? [])
          .map((entry) => PLATFORM_MAP.get(entry.platform?.slug))
          .filter(Boolean),
      ),
    ]
    const genres = new Set(
      (item.genres ?? []).map((genre) => GENRE_MAP.get(genre.slug)).filter(Boolean),
    )
    for (const tag of item.tags ?? []) {
      const mapped = TAG_MAP.get(tag.slug)
      if (mapped) {
        genres.add(mapped)
      }
    }
    if (!item.name || platforms.length === 0 || genres.size === 0) {
      continue
    }
    games.push({
      title: item.name.trim(),
      cover: item.background_image ?? null,
      platforms,
      genres: [...genres],
      metadata: {
        rawg_id: item.id,
        rawg_slug: item.slug,
        released: item.released ?? null,
        rating: item.rating ?? null,
      },
    })
  }
  if (!data.next) {
    break
  }
}

// Dedupe por título (RAWG puede repetir entre páginas)
const byTitle = new Map()
for (const game of games) {
  if (!byTitle.has(game.title)) {
    byTitle.set(game.title, game)
  }
}
const list = [...byTitle.values()]

const lines = []
lines.push('begin;')
lines.push(
  'insert into public.games (title, cover_url, metadata) values',
  list
    .map(
      (game) =>
        `  (${q(game.title)}, ${game.cover ? q(game.cover) : 'null'}, ${q(JSON.stringify(game.metadata))}::jsonb)`,
    )
    .join(',\n'),
  'on conflict (title) do update set cover_url = coalesce(excluded.cover_url, games.cover_url), metadata = games.metadata || excluded.metadata;',
)

const genreValues = list.flatMap((game) =>
  game.genres.map((genre) => `  (${q(game.title)}, ${q(genre)})`),
)
lines.push(
  'insert into public.game_genres (game_id, genre_id)',
  'select g.id, ge.id from (values',
  genreValues.join(',\n'),
  ') as v(title, genre)',
  'join public.games g on g.title = v.title',
  'join public.genres ge on ge.name = v.genre',
  'on conflict do nothing;',
)

const platformValues = list.flatMap((game) =>
  game.platforms.map((platform) => `  (${q(game.title)}, ${q(platform)})`),
)
lines.push(
  'insert into public.game_availability (game_id, platform_id)',
  'select g.id, p.id from (values',
  platformValues.join(',\n'),
  ') as v(title, platform)',
  'join public.games g on g.title = v.title',
  'join public.platforms p on p.name = v.platform',
  'on conflict do nothing;',
)
lines.push('commit;')

console.log(lines.join('\n'))
console.error(`Juegos importables: ${list.length}`)
