import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

type Availability = {
  game_id: number
  platform_id: number | null
  subscription_id: number | null
}

type MemberProfile = {
  id: string
  user_id: string
  platforms: Set<number>
  subscriptions: Set<number>
  likes: Set<number>
  avoids: Set<number>
}

type CatalogGame = {
  id: number
  title: string
  cover_url: string | null
  metadata: Record<string, unknown>
}

type ReasonMember = {
  user_id: string
  access: Array<{ type: 'platform' | 'subscription'; name: string }>
  matching_genres: string[]
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: corsHeaders,
    status,
  })
}

function errorMessage(error: { message?: string } | null | undefined) {
  return error?.message ?? 'No se pudo generar la tanda de sugerencias.'
}

function getAccessToken(request: Request) {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return null
  }
  return authorization.slice('Bearer '.length).trim() || null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Método no permitido.' }, 405)
  }

  const token = getAccessToken(request)
  if (!token) {
    return jsonResponse({ error: 'Falta la sesión del usuario.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'La función no está configurada correctamente.' }, 500)
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const userResult = await serviceClient.auth.getUser(token)
  if (userResult.error || !userResult.data.user) {
    return jsonResponse({ error: 'La sesión no es válida.' }, 401)
  }

  let body: { room_id?: string }
  try {
    const parsedBody: unknown = await request.json()
    body =
      parsedBody && typeof parsedBody === 'object'
        ? (parsedBody as { room_id?: string })
        : {}
  } catch {
    return jsonResponse({ error: 'El cuerpo de la solicitud no es válido.' }, 400)
  }
  if (!body.room_id || typeof body.room_id !== 'string') {
    return jsonResponse({ error: 'Falta el room_id.' }, 400)
  }

  const roomId = body.room_id
  const membershipResult = await serviceClient
    .from('room_members')
    .select('id,user_id,status')
    .eq('room_id', roomId)
    .eq('user_id', userResult.data.user.id)
    .eq('status', 'approved')
    .maybeSingle()
  if (membershipResult.error) {
    return jsonResponse({ error: errorMessage(membershipResult.error) }, 500)
  }
  if (!membershipResult.data) {
    return jsonResponse({ error: 'Solo los miembros aprobados pueden generar sugerencias.' }, 403)
  }

  const membersResult = await serviceClient
    .from('room_members')
    .select('id,user_id,status')
    .eq('room_id', roomId)
    .eq('status', 'approved')
  if (membersResult.error) {
    return jsonResponse({ error: errorMessage(membersResult.error) }, 500)
  }

  const members = (membersResult.data ?? []) as Array<{
    id: string
    user_id: string
    status: string
  }>
  if (members.length === 0) {
    return jsonResponse({ error: 'El room no tiene miembros aprobados.' }, 409)
  }
  const memberIds = members.map((member) => member.id)

  const [platformsResult, subscriptionsResult, genresResult, availabilityResult, gameGenresResult, gamesResult] =
    await Promise.all([
      serviceClient.from('member_platforms').select('member_id,platform_id').in('member_id', memberIds),
      serviceClient
        .from('member_subscriptions')
        .select('member_id,subscription_id')
        .in('member_id', memberIds),
      serviceClient
        .from('member_genres')
        .select('member_id,genre_id,preference')
        .in('member_id', memberIds),
      serviceClient.from('game_availability').select('game_id,platform_id,subscription_id'),
      serviceClient.from('game_genres').select('game_id,genre_id'),
      serviceClient.from('games').select('id,title,cover_url,metadata'),
    ])
  const profileResult = [platformsResult, subscriptionsResult, genresResult].find(
    (result) => result.error,
  )
  const catalogResult = [availabilityResult, gameGenresResult, gamesResult].find(
    (result) => result.error,
  )
  if (profileResult?.error || catalogResult?.error) {
    return jsonResponse(
      { error: errorMessage(profileResult?.error ?? catalogResult?.error) },
      500,
    )
  }

  const profiles = new Map<string, MemberProfile>()
  for (const member of members) {
    profiles.set(member.id, {
      avoids: new Set(),
      id: member.id,
      likes: new Set(),
      platforms: new Set(),
      subscriptions: new Set(),
      user_id: member.user_id,
    })
  }
  for (const row of platformsResult.data ?? []) {
    profiles.get(row.member_id)?.platforms.add(row.platform_id)
  }
  for (const row of subscriptionsResult.data ?? []) {
    profiles.get(row.member_id)?.subscriptions.add(row.subscription_id)
  }
  for (const row of genresResult.data ?? []) {
    const profile = profiles.get(row.member_id)
    if (!profile) {
      continue
    }
    if (row.preference === 'like') {
      profile.likes.add(row.genre_id)
    } else {
      profile.avoids.add(row.genre_id)
    }
  }

  const incompleteUserIds = members
    .filter((member) => {
      const profile = profiles.get(member.id)
      return !profile || profile.platforms.size === 0 || profile.likes.size === 0
    })
    .map((member) => member.user_id)
  if (incompleteUserIds.length > 0) {
    return jsonResponse(
      {
        error: 'Hay miembros con el perfil incompleto.',
        incomplete_user_ids: incompleteUserIds,
      },
      409,
    )
  }

  const platformNamesResult = await serviceClient.from('platforms').select('id,name')
  const subscriptionNamesResult = await serviceClient
    .from('subscriptions')
    .select('id,name,tier,kind')
  const genreNamesResult = await serviceClient.from('genres').select('id,name')
  if (platformNamesResult.error || subscriptionNamesResult.error || genreNamesResult.error) {
    return jsonResponse(
      {
        error: errorMessage(
          platformNamesResult.error ?? subscriptionNamesResult.error ?? genreNamesResult.error,
        ),
      },
      500,
    )
  }

  const platformNames = new Map(
    (platformNamesResult.data ?? []).map((item) => [item.id, item.name]),
  )
  const subscriptionNames = new Map(
    (subscriptionNamesResult.data ?? []).map((item) => [
      item.id,
      item.tier ? `${item.name} — ${item.tier}` : item.name,
    ]),
  )
  const genreNames = new Map((genreNamesResult.data ?? []).map((item) => [item.id, item.name]))
  const availabilityByGame = new Map<number, Availability[]>()
  for (const row of (availabilityResult.data ?? []) as Availability[]) {
    const rows = availabilityByGame.get(row.game_id) ?? []
    rows.push(row)
    availabilityByGame.set(row.game_id, rows)
  }
  const genresByGame = new Map<number, Set<number>>()
  for (const row of gameGenresResult.data ?? []) {
    const genres = genresByGame.get(row.game_id) ?? new Set<number>()
    genres.add(row.genre_id)
    genresByGame.set(row.game_id, genres)
  }
  const gamesById = new Map(
    ((gamesResult.data ?? []) as CatalogGame[]).map((game) => [game.id, game]),
  )

  const accessibleByMember = members.map((member) => {
    const profile = profiles.get(member.id)!
    const accessible = new Set<number>()
    for (const [gameId, rows] of availabilityByGame) {
      if (
        rows.some(
          (row) =>
            (row.platform_id !== null && profile.platforms.has(row.platform_id)) ||
            (row.subscription_id !== null && profile.subscriptions.has(row.subscription_id)),
        )
      ) {
        accessible.add(gameId)
      }
    }
    return accessible
  })
  let candidateIds = new Set(accessibleByMember[0])
  for (const accessible of accessibleByMember.slice(1)) {
    candidateIds = new Set([...candidateIds].filter((gameId) => accessible.has(gameId)))
  }

  const avoidedGenres = new Set<number>()
  const likedGenres = new Set<number>()
  for (const profile of profiles.values()) {
    for (const genreId of profile.avoids) {
      avoidedGenres.add(genreId)
    }
    for (const genreId of profile.likes) {
      likedGenres.add(genreId)
    }
  }
  candidateIds = new Set(
    [...candidateIds].filter((gameId) => {
      const gameGenres = genresByGame.get(gameId) ?? new Set<number>()
      return ![...gameGenres].some((genreId) => avoidedGenres.has(genreId))
    }),
  )

  const historyResult = await serviceClient
    .from('suggestions')
    .select('id,game_id,batch_id,created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
  if (historyResult.error) {
    return jsonResponse({ error: errorMessage(historyResult.error) }, 500)
  }
  const history = historyResult.data ?? []
  const recentBatchIds: string[] = []
  for (const row of history) {
    if (!recentBatchIds.includes(row.batch_id)) {
      recentBatchIds.push(row.batch_id)
    }
    if (recentBatchIds.length === 3) {
      break
    }
  }
  const recentGameIds = new Set(
    history
      .filter((row) => recentBatchIds.includes(row.batch_id))
      .map((row) => row.game_id),
  )
  candidateIds = new Set([...candidateIds].filter((gameId) => !recentGameIds.has(gameId)))

  const ratingsBySuggestion = new Map<string, number[]>()
  const historySuggestionIds = history.map((row) => row.id)
  if (historySuggestionIds.length > 0) {
    const ratingsResult = await serviceClient
      .from('ratings')
      .select('suggestion_id,score')
      .in('suggestion_id', historySuggestionIds)
    if (ratingsResult.error) {
      return jsonResponse({ error: errorMessage(ratingsResult.error) }, 500)
    }
    for (const rating of ratingsResult.data ?? []) {
      const scores = ratingsBySuggestion.get(rating.suggestion_id) ?? []
      scores.push(rating.score)
      ratingsBySuggestion.set(rating.suggestion_id, scores)
    }
  }
  const ratingByGenre = new Map<number, number[]>()
  for (const row of history) {
    const scores = ratingsBySuggestion.get(row.id)
    if (!scores) {
      continue
    }
    for (const genreId of genresByGame.get(row.game_id) ?? []) {
      const ratings = ratingByGenre.get(genreId) ?? []
      ratings.push(...scores)
      ratingByGenre.set(genreId, ratings)
    }
  }

  const totalLikedGenres = Math.max(likedGenres.size, 1)
  const scoredGames = [...candidateIds]
    .map((gameId) => {
      const game = gamesById.get(gameId)
      if (!game) {
        return null
      }
      const gameGenres = genresByGame.get(gameId) ?? new Set<number>()
      const matchingGenres = new Set([...gameGenres].filter((genreId) => likedGenres.has(genreId)))
      const coverage = matchingGenres.size / totalLikedGenres
      const historicalRatings = [...gameGenres].flatMap(
        (genreId) => ratingByGenre.get(genreId) ?? [],
      )
      const historicalRating =
        historicalRatings.length > 0
          ? historicalRatings.reduce((sum, rating) => sum + rating, 0) /
            historicalRatings.length
          : undefined
      const normalizedRating =
        historicalRating === undefined ? 0 : Math.max(0, Math.min(1, (historicalRating - 1) / 4))
      const score = coverage * 0.8 + normalizedRating * 0.2
      const reasonMembers: ReasonMember[] = members.map((member) => {
        const profile = profiles.get(member.id)!
        const access: ReasonMember['access'] = []
        for (const row of availabilityByGame.get(gameId) ?? []) {
          if (row.platform_id !== null && profile.platforms.has(row.platform_id)) {
            access.push({
              name: platformNames.get(row.platform_id) ?? 'Plataforma',
              type: 'platform',
            })
          }
          if (row.subscription_id !== null && profile.subscriptions.has(row.subscription_id)) {
            access.push({
              name: subscriptionNames.get(row.subscription_id) ?? 'Suscripción',
              type: 'subscription',
            })
          }
        }
        const memberMatchingGenres = new Set(
          [...gameGenres].filter((genreId) => profile.likes.has(genreId)),
        )
        const matchingGenreNames: string[] = [...memberMatchingGenres]
          .map((genreId) => genreNames.get(genreId) ?? 'Género')
          .sort()
        return {
          access,
          matching_genres: matchingGenreNames,
          user_id: member.user_id,
        }
      })
      return {
        game,
        historical_rating: historicalRating ?? null,
        reason: { members: reasonMembers },
        score,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.score - left.score || left.game.title.localeCompare(right.game.title))
    .slice(0, 5)

  if (scoredGames.length === 0) {
    return jsonResponse({
      batch_id: null,
      message: 'No hay juegos nuevos que cumplan las preferencias de todos los miembros.',
      suggestions: [],
    })
  }

  const batchId = crypto.randomUUID()
  const insertRows = scoredGames.map((item) => ({
    batch_id: batchId,
    game_id: item.game.id,
    reason: item.reason,
    room_id: roomId,
  }))
  const insertedResult = await serviceClient.from('suggestions').insert(insertRows).select('id,game_id,batch_id,reason,created_at')
  if (insertedResult.error) {
    return jsonResponse({ error: errorMessage(insertedResult.error) }, 500)
  }

  const insertedByGame = new Map((insertedResult.data ?? []).map((item) => [item.game_id, item]))
  return jsonResponse({
    batch_id: batchId,
    suggestions: scoredGames.map((item) => ({
      ...insertedByGame.get(item.game.id),
      cover_url: item.game.cover_url,
      genres: [...(genresByGame.get(item.game.id) ?? [])]
        .map((genreId) => genreNames.get(genreId) ?? 'Género')
        .sort(),
      historical_rating: item.historical_rating,
      title: item.game.title,
    })),
  })
})
