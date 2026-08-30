import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { toSpanishError } from '../lib/errors'
import {
  shortUserId,
  statusLabel,
  type Membership,
  type Room,
} from '../lib/room'
import { supabase } from '../lib/supabase'

type Tab = 'suggestions' | 'members' | 'settings'
type ProfileStatus = 'complete' | 'incomplete' | 'unknown'

type SuggestionReasonMember = {
  user_id: string
  access: Array<{ type: 'platform' | 'subscription'; name: string }>
  matching_genres: string[]
}

type Suggestion = {
  id: string
  title: string
  cover_url: string | null
  genres: string[]
  reason: {
    members: SuggestionReasonMember[]
  }
  average_rating: number | null
  my_rating: number | null
}

type RatingStarsProps = {
  value: number | null
  disabled: boolean
  saving: boolean
  onChange: (score: number) => void
}

function RatingStars({ value, disabled, saving, onChange }: RatingStarsProps) {
  return (
    <div className="rating-control" aria-label="Tu valoración">
      <span className="rating-label">Tu valoración</span>
      <div className="rating-stars" role="group" aria-label="Valorar de 1 a 5 estrellas">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            type="button"
            className="rating-star"
            key={score}
            aria-label={`${score} ${score === 1 ? 'estrella' : 'estrellas'}`}
            aria-pressed={value === score}
            disabled={disabled || saving}
            onClick={() => onChange(score)}
          >
            {value !== null && score <= value ? '★' : '☆'}
          </button>
        ))}
      </div>
      <span className="rating-hint">
        {saving ? 'Guardando…' : value === null ? 'Sin votar' : `${value}/5`}
      </span>
    </div>
  )
}

function normalizeSuggestionReason(value: unknown): Suggestion['reason'] {
  if (!value || typeof value !== 'object' || !('members' in value)) {
    return { members: [] }
  }
  const members = value.members
  if (!Array.isArray(members)) {
    return { members: [] }
  }
  return {
    members: members.filter(
      (member): member is SuggestionReasonMember =>
        Boolean(member) &&
        typeof member === 'object' &&
        'user_id' in member &&
        'access' in member &&
        'matching_genres' in member &&
        typeof member.user_id === 'string' &&
        Array.isArray(member.access) &&
        Array.isArray(member.matching_genres),
    ),
  }
}

export default function RoomPage() {
  const { slug } = useParams()
  const { loading: authLoading, user } = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<Room | null>(null)
  const [members, setMembers] = useState<Membership[]>([])
  const [profileStatuses, setProfileStatuses] = useState<Record<string, ProfileStatus>>({})
  const [profileError, setProfileError] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionError, setSuggestionError] = useState('')
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generationIncompleteIds, setGenerationIncompleteIds] = useState<string[]>([])
  const [ratingSavingId, setRatingSavingId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('suggestions')
  const [loading, setLoading] = useState(true)
  const [accessMessage, setAccessMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({
    name: '',
    description: '',
    isPublic: false,
    maxMembers: 10,
    autoApprove: false,
    isOpen: true,
  })

  const loadSuggestions = useCallback(async (roomId: string) => {
    setSuggestionsLoading(true)
    setSuggestionError('')
    const suggestionsResult = await supabase
      .from('suggestions')
      .select('id,game_id,batch_id,reason,created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })

    if (suggestionsResult.error) {
      setSuggestionError(toSpanishError(suggestionsResult.error))
      setSuggestionsLoading(false)
      return
    }
    const rows = suggestionsResult.data ?? []
    const latestBatchId = rows[0]?.batch_id
    if (!latestBatchId) {
      setSuggestions([])
      setSuggestionsLoading(false)
      return
    }
    const latestRows = rows.filter((row) => row.batch_id === latestBatchId)
    const gameIds = latestRows.map((row) => row.game_id)
    const suggestionIds = latestRows.map((row) => row.id)
    const [gamesResult, gameGenresResult, ratingsResult] = await Promise.all([
      supabase.from('games').select('id,title,cover_url').in('id', gameIds),
      supabase.from('game_genres').select('game_id,genre_id').in('game_id', gameIds),
      supabase.from('ratings').select('suggestion_id,score').in('suggestion_id', suggestionIds),
    ])
    if (gamesResult.error || gameGenresResult.error || ratingsResult.error) {
      setSuggestionError(
        toSpanishError(gamesResult.error ?? gameGenresResult.error ?? ratingsResult.error),
      )
      setSuggestionsLoading(false)
      return
    }
    const genreIds = [...new Set((gameGenresResult.data ?? []).map((row) => row.genre_id))]
    const genresResult =
      genreIds.length > 0
        ? await supabase.from('genres').select('id,name').in('id', genreIds)
        : { data: [], error: null }
    if (genresResult.error) {
      setSuggestionError(toSpanishError(genresResult.error))
      setSuggestionsLoading(false)
      return
    }

    const gameById = new Map((gamesResult.data ?? []).map((game) => [game.id, game]))
    const genreNames = new Map((genresResult.data ?? []).map((genre) => [genre.id, genre.name]))
    const genresByGame = new Map<number, string[]>()
    for (const row of gameGenresResult.data ?? []) {
      const names = genresByGame.get(row.game_id) ?? []
      const name = genreNames.get(row.genre_id)
      if (name) {
        names.push(name)
      }
      genresByGame.set(row.game_id, names)
    }
    const ratingsBySuggestion = new Map<string, number[]>()
    const myRatings = new Map<string, number>()
    for (const rating of ratingsResult.data ?? []) {
      const scores = ratingsBySuggestion.get(rating.suggestion_id) ?? []
      scores.push(rating.score)
      ratingsBySuggestion.set(rating.suggestion_id, scores)
      if (rating.user_id === user?.id) {
        myRatings.set(rating.suggestion_id, rating.score)
      }
    }
    setSuggestions(
      latestRows.flatMap((row) => {
        const game = gameById.get(row.game_id)
        if (!game) {
          return []
        }
        const scores = ratingsBySuggestion.get(row.id) ?? []
        return [
          {
            average_rating:
              scores.length > 0
                ? scores.reduce((sum, score) => sum + score, 0) / scores.length
                : null,
            cover_url: game.cover_url,
            genres: genresByGame.get(row.game_id) ?? [],
            id: row.id,
            my_rating: myRatings.get(row.id) ?? null,
            reason: normalizeSuggestionReason(row.reason),
            title: game.title,
          },
        ]
      }),
    )
    setSuggestionsLoading(false)
  }, [user?.id])

  const loadRoom = useCallback(async () => {
    if (!user || !slug) {
      return
    }
    setLoading(true)
    setError('')
    setProfileError('')
    setProfileStatuses({})
    setGenerationIncompleteIds([])
    const roomResult = await supabase
      .from('rooms')
      .select('id,slug,name,description,is_public,max_members,auto_approve,is_open,owner_id')
      .eq('slug', slug)
      .maybeSingle()

    if (roomResult.error || !roomResult.data) {
      setError(toSpanishError(roomResult.error ?? new Error('Room no encontrado.')))
      setLoading(false)
      return
    }

    const nextRoom = roomResult.data as Room
    const ownResult = await supabase
      .from('room_members')
      .select('id,room_id,user_id,status,created_at')
      .eq('room_id', nextRoom.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (ownResult.error || !ownResult.data) {
      setAccessMessage('No tienes una membresía en este room.')
      setRoom(nextRoom)
      setMembers([])
      setLoading(false)
      return
    }

    if (ownResult.data.status !== 'approved') {
      setAccessMessage(
        ownResult.data.status === 'pending'
          ? 'Tu solicitud todavía está pendiente de aprobación.'
          : 'Tu solicitud para este room fue rechazada.',
      )
      setRoom(nextRoom)
      setMembers([])
      setLoading(false)
      return
    }

    const membersResult = await supabase
      .from('room_members')
      .select('id,room_id,user_id,status,created_at')
      .eq('room_id', nextRoom.id)
      .order('created_at')

    if (membersResult.error) {
      setError(toSpanishError(membersResult.error))
    } else {
      const nextMembers = (membersResult.data ?? []) as Membership[]
      setMembers(nextMembers)
      const nextStatuses: Record<string, ProfileStatus> = {}
      const approvedMemberIds = nextMembers
        .filter((member) => member.status === 'approved')
        .map((member) => member.id)
      for (const member of nextMembers) {
        if (member.status !== 'approved') {
          nextStatuses[member.id] = 'incomplete'
        }
      }

      if (approvedMemberIds.length > 0) {
        const [platformsResult, genresResult] = await Promise.all([
          supabase
            .from('member_platforms')
            .select('member_id')
            .in('member_id', approvedMemberIds),
          supabase
            .from('member_genres')
            .select('member_id,preference')
            .in('member_id', approvedMemberIds)
            .eq('preference', 'like'),
        ])
        if (platformsResult.error || genresResult.error) {
          setProfileError(
            'No se pudo comprobar el estado de los perfiles de todos los miembros.',
          )
          for (const memberId of approvedMemberIds) {
            nextStatuses[memberId] = 'unknown'
          }
        } else {
          const platformCounts = new Map<string, number>()
          const favoriteCounts = new Map<string, number>()
          for (const row of platformsResult.data ?? []) {
            platformCounts.set(row.member_id, (platformCounts.get(row.member_id) ?? 0) + 1)
          }
          for (const row of genresResult.data ?? []) {
            favoriteCounts.set(row.member_id, (favoriteCounts.get(row.member_id) ?? 0) + 1)
          }
          for (const memberId of approvedMemberIds) {
            nextStatuses[memberId] =
              (platformCounts.get(memberId) ?? 0) > 0 &&
              (favoriteCounts.get(memberId) ?? 0) > 0
                ? 'complete'
                : 'incomplete'
          }
        }
      }
      setProfileStatuses(nextStatuses)
    }
    await loadSuggestions(nextRoom.id)
    setAccessMessage('')
    setRoom(nextRoom)
    setSettings({
      name: nextRoom.name,
      description: nextRoom.description,
      isPublic: nextRoom.is_public,
      maxMembers: nextRoom.max_members,
      autoApprove: nextRoom.auto_approve,
      isOpen: nextRoom.is_open,
    })
    setLoading(false)
  }, [loadSuggestions, slug, user])

  useEffect(() => {
    if (authLoading) {
      return
    }
    if (!user) {
      navigate(`/auth?redirect=${encodeURIComponent(`/room/${slug ?? ''}`)}`, {
        replace: true,
      })
      return
    }
    void loadRoom()
  }, [authLoading, loadRoom, navigate, slug, user])

  const isOwner = Boolean(room && user && room.owner_id === user.id)
  const approvedMembers = members.filter((member) => member.status === 'approved')
  const incompleteApprovedMembers = approvedMembers.filter(
    (member) => profileStatuses[member.id] !== 'complete',
  )
  const canGenerate = approvedMembers.length > 0 && incompleteApprovedMembers.length === 0
  const inviteUrl = useMemo(() => {
    if (!room) {
      return ''
    }
    return `${window.location.origin}${window.location.pathname}#/join/${room.slug}`
  }, [room])

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('No se pudo copiar el enlace. Cópialo manualmente.')
    }
  }

  const updateMember = async (memberId: string, status: 'approved' | 'rejected') => {
    setError('')
    const result = await supabase
      .from('room_members')
      .update({ status })
      .eq('id', memberId)
    if (result.error) {
      setError(toSpanishError(result.error))
      return
    }
    await loadRoom()
  }

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!room || !isOwner) {
      return
    }
    const cleanName = settings.name.trim()
    const cleanDescription = settings.description.trim()
    if (cleanName.length < 3 || cleanName.length > 50) {
      setError('El nombre debe tener entre 3 y 50 caracteres.')
      return
    }
    if (cleanDescription.length > 200) {
      setError('La descripción no puede superar los 200 caracteres.')
      return
    }
    if (settings.maxMembers < 2 || settings.maxMembers > 10) {
      setError('El máximo de miembros debe estar entre 2 y 10.')
      return
    }

    setSaving(true)
    setError('')
    const result = await supabase
      .from('rooms')
      .update({
        name: cleanName,
        description: cleanDescription,
        is_public: settings.isPublic,
        max_members: settings.maxMembers,
        auto_approve: settings.isPublic && settings.autoApprove,
        is_open: settings.isOpen,
      })
      .eq('id', room.id)

    if (result.error) {
      setError(toSpanishError(result.error))
    } else {
      await loadRoom()
    }
    setSaving(false)
  }

  const handleGenerate = async () => {
    if (!room || !canGenerate) {
      return
    }
    setGenerating(true)
    setSuggestionError('')
    setGenerationIncompleteIds([])
    const { error: invokeError } = await supabase.functions.invoke('generate-suggestions', {
      body: { room_id: room.id },
    })
    if (invokeError) {
      const response = (invokeError as { context?: Response }).context
      let payload: { incomplete_user_ids?: string[] } | null = null
      if (response) {
        try {
          payload = (await response.clone().json()) as { incomplete_user_ids?: string[] }
        } catch {
          payload = null
        }
      }
      if (response?.status === 409 && payload?.incomplete_user_ids) {
        setGenerationIncompleteIds(payload.incomplete_user_ids)
        setSuggestionError('Completa el perfil de todos los miembros antes de generar.')
      } else if (response?.status === 403) {
        setSuggestionError('Solo los miembros aprobados pueden generar sugerencias.')
      } else {
        setSuggestionError('No se pudieron generar las sugerencias. Inténtalo de nuevo.')
      }
    } else {
      await loadSuggestions(room.id)
    }
    setGenerating(false)
  }

  const handleRate = async (suggestionId: string, score: number) => {
    if (!user || !room || !approvedMembers.some((member) => member.user_id === user.id)) {
      return
    }
    setRatingSavingId(suggestionId)
    setSuggestionError('')
    const result = await supabase.from('ratings').upsert(
      {
        score,
        suggestion_id: suggestionId,
        user_id: user.id,
      },
      { onConflict: 'suggestion_id,user_id' },
    )
    if (result.error) {
      setSuggestionError('No se pudo guardar tu valoración. Inténtalo de nuevo.')
    } else {
      await loadSuggestions(room.id)
    }
    setRatingSavingId(null)
  }

  const memberLabel = (member: Membership) =>
    member.user_id === room?.owner_id
      ? 'Owner'
      : member.user_id === user?.id
        ? 'Tú'
        : shortUserId(member.user_id)

  const labelForUserId = (userId: string) => {
    const member = members.find((item) => item.user_id === userId)
    return member ? memberLabel(member) : shortUserId(userId)
  }

  if (authLoading || loading) {
    return <p className="page-message">Cargando room…</p>
  }
  if (!room) {
    return (
      <main className="narrow-shell">
        <section className="card empty-state">
          <h1>Room no encontrado</h1>
          <Link className="primary-link" to="/">
            Volver al inicio
          </Link>
        </section>
      </main>
    )
  }
  if (accessMessage) {
    return (
      <main className="narrow-shell">
        <Link className="text-link" to="/">
          ← Volver al inicio
        </Link>
        <section className="card empty-state">
          <h1>{room.name}</h1>
          <p>{accessMessage}</p>
          <Link className="primary-link" to={`/join/${room.slug}`}>
            Ver solicitud
          </Link>
        </section>
      </main>
    )
  }

  const sortedMembers = [...members].sort((left, right) => {
    const order = { approved: 0, pending: 1, rejected: 2 }
    return order[left.status] - order[right.status]
  })

  return (
    <main className="page-shell">
      <Link className="text-link" to="/">
        ← Volver al inicio
      </Link>
      <header className="room-header">
        <div>
          <span className="eyebrow">{room.is_public ? 'Room público' : 'Room privado'}</span>
          <h1>{room.name}</h1>
          <p className="muted">{room.description || 'Sin descripción.'}</p>
        </div>
        <div className="invite-box">
          <span className="muted">Enlace de invitación</span>
          <div className="invite-actions">
            <code>{inviteUrl}</code>
            <button type="button" className="secondary-button" onClick={copyInvite}>
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Secciones del room">
        <button
          type="button"
          className={tab === 'suggestions' ? 'tab active' : 'tab'}
          onClick={() => setTab('suggestions')}
        >
          Sugerencias
        </button>
        <button
          type="button"
          className={tab === 'members' ? 'tab active' : 'tab'}
          onClick={() => setTab('members')}
        >
          Miembros ({members.length})
        </button>
        {isOwner && (
          <button
            type="button"
            className={tab === 'settings' ? 'tab active' : 'tab'}
            onClick={() => setTab('settings')}
          >
            Configuración
          </button>
        )}
        <Link className="tab tab-link" to={`/room/${room.slug}/profile`}>
          Mi perfil
        </Link>
      </div>

      {error && <p className="form-error">{error}</p>}
      {profileError && <p className="form-error">{profileError}</p>}
      {suggestionError && <p className="form-error">{suggestionError}</p>}

      {tab === 'suggestions' ? (
        <section className="suggestions-section">
          <div className="card suggestion-toolbar">
            <div>
              <h2>Sugerencias para el grupo</h2>
              {incompleteApprovedMembers.length > 0 ? (
                <p className="muted">
                  Completa el perfil de estos miembros para generar una tanda:
                </p>
              ) : (
                <p className="muted">
                  Encontraremos juegos compatibles con todos los miembros aprobados.
                </p>
              )}
            </div>
            <button type="button" onClick={() => void handleGenerate()} disabled={!canGenerate || generating}>
              {generating ? 'Generando…' : 'Generar sugerencias'}
            </button>
          </div>
          {incompleteApprovedMembers.length > 0 && (
            <div className="card incomplete-list">
              {incompleteApprovedMembers.map((member) => (
                <span className="status status-pending" key={member.id}>
                  {memberLabel(member)}
                </span>
              ))}
            </div>
          )}
          {generationIncompleteIds.length > 0 && (
            <div className="card incomplete-list">
              <strong>Perfiles incompletos indicados por el servidor:</strong>
              {generationIncompleteIds.map((userId) => (
                <span className="status status-pending" key={userId}>
                  {labelForUserId(userId)}
                </span>
              ))}
            </div>
          )}
          {suggestionsLoading ? (
            <p className="page-message">Cargando sugerencias…</p>
          ) : suggestions.length === 0 ? (
            <section className="card empty-state">
              Todavía no hay una tanda de sugerencias para este room.
            </section>
          ) : (
            <div className="suggestion-grid">
              {suggestions.map((suggestion) => (
                <article className="card suggestion-card" key={suggestion.id}>
                  <div className="suggestion-cover">
                    {suggestion.cover_url ? (
                      <img src={suggestion.cover_url} alt="" />
                    ) : (
                      <span>Sin portada</span>
                    )}
                  </div>
                  <div className="suggestion-content">
                    <div className="section-heading">
                      <h3>{suggestion.title}</h3>
                      {suggestion.average_rating !== null && (
                        <span className="rating-average">
                          ★ {suggestion.average_rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <p className="suggestion-genres">
                      {suggestion.genres.length > 0
                        ? suggestion.genres.join(' · ')
                        : 'Géneros no disponibles'}
                    </p>
                    <div className="suggestion-rating">
                      <div className="rating-room-average">
                        {suggestion.average_rating !== null
                          ? `Promedio del room: ★ ${suggestion.average_rating.toFixed(1)}`
                          : 'El room todavía no tiene valoraciones.'}
                      </div>
                      {approvedMembers.some((member) => member.user_id === user?.id) && (
                        <RatingStars
                          disabled={false}
                          onChange={(score) => void handleRate(suggestion.id, score)}
                          saving={ratingSavingId === suggestion.id}
                          value={suggestion.my_rating}
                        />
                      )}
                    </div>
                    <details>
                      <summary>Por qué encaja</summary>
                      <div className="suggestion-reasons">
                        {suggestion.reason.members.map((reasonMember) => (
                          <p key={reasonMember.user_id}>
                            <strong>{labelForUserId(reasonMember.user_id)}:</strong>{' '}
                            {reasonMember.access.length > 0
                              ? `Disponible por ${reasonMember.access
                                  .map((access) => access.name)
                                  .join(', ')}. `
                              : ''}
                            {reasonMember.matching_genres.length > 0
                              ? `Coincide en ${reasonMember.matching_genres.join(', ')}.`
                              : 'Sin coincidencias de género favoritas.'}
                          </p>
                        ))}
                      </div>
                    </details>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : tab === 'members' ? (
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Miembros</h2>
              <p className="muted">
                {members.filter((member) => member.status === 'approved').length}/
                {room.max_members} plazas ocupadas
              </p>
            </div>
          </div>
          <div className="member-list">
            {sortedMembers.map((member) => {
              const label =
                member.user_id === room.owner_id
                  ? 'Owner'
                  : member.user_id === user?.id
                    ? 'Tú'
                    : shortUserId(member.user_id)
              return (
                <div className="member-row" key={member.id}>
                  <div>
                    <strong>{label}</strong>
                    {member.user_id === room.owner_id && (
                      <span className="muted member-note">Creador del room</span>
                    )}
                    <span className="profile-status">
                      {profileStatuses[member.id] === 'complete'
                        ? 'Perfil completo'
                        : profileStatuses[member.id] === 'unknown'
                          ? 'Perfil no disponible'
                          : 'Perfil incompleto'}
                    </span>
                  </div>
                  <div className="member-actions">
                    <span className={`status status-${member.status}`}>
                      {statusLabel(member.status)}
                    </span>
                    {isOwner && member.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          className="small-button"
                          onClick={() => void updateMember(member.id, 'approved')}
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          className="small-button danger-button"
                          onClick={() => void updateMember(member.id, 'rejected')}
                        >
                          Rechazar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <section className="card form-card">
          <h2>Configuración</h2>
          <p className="muted">Solo el owner puede modificar estos valores.</p>
          <form onSubmit={saveSettings} className="stack">
            <label>
              Nombre
              <input
                value={settings.name}
                onChange={(event) =>
                  setSettings({ ...settings, name: event.target.value })
                }
                maxLength={50}
                required
              />
            </label>
            <label>
              Descripción
              <textarea
                value={settings.description}
                onChange={(event) =>
                  setSettings({ ...settings, description: event.target.value })
                }
                maxLength={200}
                rows={4}
              />
            </label>
            <label>
              Máximo de miembros
              <input
                type="number"
                min={2}
                max={10}
                value={settings.maxMembers}
                onChange={(event) =>
                  setSettings({ ...settings, maxMembers: Number(event.target.value) })
                }
                required
              />
            </label>
            <label className="choice checkbox-choice">
              <input
                type="checkbox"
                checked={settings.isPublic}
                onChange={(event) => {
                  const nextPublic = event.target.checked
                  setSettings({
                    ...settings,
                    isPublic: nextPublic,
                    autoApprove: nextPublic && settings.autoApprove,
                  })
                }}
              />
              <span>
                <strong>Room público</strong>
                <small>Los rooms públicos aparecen en el listado.</small>
              </span>
            </label>
            {settings.isPublic && (
              <label className="choice checkbox-choice">
                <input
                  type="checkbox"
                  checked={settings.autoApprove}
                  onChange={(event) =>
                    setSettings({ ...settings, autoApprove: event.target.checked })
                  }
                />
                <span>
                  <strong>Aprobación automática</strong>
                  <small>Acepta solicitudes mientras haya plazas.</small>
                </span>
              </label>
            )}
            <label className="choice checkbox-choice">
              <input
                type="checkbox"
                checked={settings.isOpen}
                onChange={(event) =>
                  setSettings({ ...settings, isOpen: event.target.checked })
                }
              />
              <span>
                <strong>Room abierto</strong>
                <small>Permitir nuevas solicitudes de unión.</small>
              </span>
            </label>
            <button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </form>
        </section>
      )}
    </main>
  )
}
