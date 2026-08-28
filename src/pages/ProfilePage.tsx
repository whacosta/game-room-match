import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { toSpanishError } from '../lib/errors'
import {
  platformFamilyLabels,
  platformFamilyOrder,
  type Genre,
  type Platform,
  type Subscription,
} from '../lib/profile'
import { supabase } from '../lib/supabase'

type ProfileRoom = {
  id: string
  slug: string
  name: string
}

type ProfileMember = {
  id: string
  status: 'pending' | 'approved' | 'rejected'
}

function toggleValue(values: number[], value: number, checked: boolean) {
  return checked
    ? values.includes(value)
      ? values
      : [...values, value]
    : values.filter((item) => item !== value)
}

export default function ProfilePage() {
  const { slug } = useParams()
  const { loading: authLoading, user } = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<ProfileRoom | null>(null)
  const [member, setMember] = useState<ProfileMember | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [genres, setGenres] = useState<Genre[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<number[]>([])
  const [selectedSubscriptions, setSelectedSubscriptions] = useState<number[]>([])
  const [favoriteGenres, setFavoriteGenres] = useState<number[]>([])
  const [avoidedGenres, setAvoidedGenres] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [accessMessage, setAccessMessage] = useState('')

  useEffect(() => {
    if (authLoading) {
      return
    }
    if (!user) {
      navigate(`/auth?redirect=${encodeURIComponent(`/room/${slug ?? ''}/profile`)}`, {
        replace: true,
      })
      return
    }

    let active = true
    const loadProfile = async () => {
      setLoading(true)
      setError('')
      setAccessMessage('')

      const roomResult = await supabase
        .from('rooms')
        .select('id,slug,name')
        .eq('slug', slug ?? '')
        .maybeSingle()

      if (roomResult.error || !roomResult.data) {
        if (active) {
          setError(toSpanishError(roomResult.error ?? new Error('Room no encontrado.')))
          setLoading(false)
        }
        return
      }

      const nextRoom = roomResult.data as ProfileRoom
      const memberResult = await supabase
        .from('room_members')
        .select('id,status')
        .eq('room_id', nextRoom.id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (memberResult.error || !memberResult.data) {
        if (active) {
          setRoom(nextRoom)
          setAccessMessage('Necesitas una membresía aprobada para editar tu perfil.')
          setLoading(false)
        }
        return
      }

      const nextMember = memberResult.data as ProfileMember
      if (nextMember.status !== 'approved') {
        if (active) {
          setRoom(nextRoom)
          setMember(nextMember)
          setAccessMessage('Necesitas una membresía aprobada para editar tu perfil.')
          setLoading(false)
        }
        return
      }

      const [
        platformsResult,
        subscriptionsResult,
        genresResult,
        memberPlatformsResult,
        memberSubscriptionsResult,
        memberGenresResult,
      ] = await Promise.all([
        supabase.from('platforms').select('id,family,name').order('family').order('name'),
        supabase
          .from('subscriptions')
          .select('id,name,tier,kind')
          .order('kind')
          .order('name')
          .order('tier'),
        supabase.from('genres').select('id,name').order('name'),
        supabase
          .from('member_platforms')
          .select('platform_id')
          .eq('member_id', nextMember.id),
        supabase
          .from('member_subscriptions')
          .select('subscription_id')
          .eq('member_id', nextMember.id),
        supabase
          .from('member_genres')
          .select('genre_id,preference')
          .eq('member_id', nextMember.id),
      ])

      const failedResult = [
        platformsResult,
        subscriptionsResult,
        genresResult,
        memberPlatformsResult,
        memberSubscriptionsResult,
        memberGenresResult,
      ].find((result) => result.error)

      if (failedResult?.error) {
        if (active) {
          setError(toSpanishError(failedResult.error))
          setLoading(false)
        }
        return
      }

      if (active) {
        setRoom(nextRoom)
        setMember(nextMember)
        setPlatforms((platformsResult.data ?? []) as Platform[])
        setSubscriptions((subscriptionsResult.data ?? []) as Subscription[])
        setGenres((genresResult.data ?? []) as Genre[])
        setSelectedPlatforms(
          (memberPlatformsResult.data ?? []).map((item) => item.platform_id),
        )
        setSelectedSubscriptions(
          (memberSubscriptionsResult.data ?? []).map((item) => item.subscription_id),
        )
        setFavoriteGenres(
          (memberGenresResult.data ?? [])
            .filter((item) => item.preference === 'like')
            .map((item) => item.genre_id),
        )
        setAvoidedGenres(
          (memberGenresResult.data ?? [])
            .filter((item) => item.preference === 'avoid')
            .map((item) => item.genre_id),
        )
        setLoading(false)
      }
    }

    void loadProfile()
    return () => {
      active = false
    }
  }, [authLoading, navigate, slug, user])

  const platformsByFamily = useMemo(() => {
    const grouped = new Map<string, Platform[]>()
    for (const platform of platforms) {
      const family = grouped.get(platform.family) ?? []
      family.push(platform)
      grouped.set(platform.family, family)
    }
    return grouped
  }, [platforms])

  const subscriptionOptions = subscriptions.filter((item) => item.kind === 'subscription')
  const cloudOptions = subscriptions.filter((item) => item.kind === 'cloud')

  const handleGenreChange = (
    genreId: number,
    preference: 'like' | 'avoid',
    checked: boolean,
  ) => {
    if (preference === 'like') {
      setFavoriteGenres((current) => toggleValue(current, genreId, checked))
      if (checked) {
        setAvoidedGenres((current) => current.filter((id) => id !== genreId))
      }
    } else {
      setAvoidedGenres((current) => toggleValue(current, genreId, checked))
      if (checked) {
        setFavoriteGenres((current) => current.filter((id) => id !== genreId))
      }
    }
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')
    if (!member) {
      return
    }
    if (selectedPlatforms.length === 0) {
      setError('Selecciona al menos una plataforma.')
      return
    }
    if (favoriteGenres.length === 0) {
      setError('Selecciona al menos un género favorito.')
      return
    }

    setSaving(true)
    try {
      const platformDelete = await supabase
        .from('member_platforms')
        .delete()
        .eq('member_id', member.id)
      if (platformDelete.error) {
        throw platformDelete.error
      }
      const platformRows = selectedPlatforms.map((platform_id) => ({
        member_id: member.id,
        platform_id,
      }))
      if (platformRows.length > 0) {
        const platformInsert = await supabase.from('member_platforms').insert(platformRows)
        if (platformInsert.error) {
          throw platformInsert.error
        }
      }

      const subscriptionDelete = await supabase
        .from('member_subscriptions')
        .delete()
        .eq('member_id', member.id)
      if (subscriptionDelete.error) {
        throw subscriptionDelete.error
      }
      const subscriptionRows = selectedSubscriptions.map((subscription_id) => ({
        member_id: member.id,
        subscription_id,
      }))
      if (subscriptionRows.length > 0) {
        const subscriptionInsert = await supabase
          .from('member_subscriptions')
          .insert(subscriptionRows)
        if (subscriptionInsert.error) {
          throw subscriptionInsert.error
        }
      }

      const genresDelete = await supabase
        .from('member_genres')
        .delete()
        .eq('member_id', member.id)
      if (genresDelete.error) {
        throw genresDelete.error
      }
      const genreRows = [
        ...favoriteGenres.map((genre_id) => ({
          member_id: member.id,
          genre_id,
          preference: 'like',
        })),
        ...avoidedGenres.map((genre_id) => ({
          member_id: member.id,
          genre_id,
          preference: 'avoid',
        })),
      ]
      if (genreRows.length > 0) {
        const genreInsert = await supabase.from('member_genres').insert(genreRows)
        if (genreInsert.error) {
          throw genreInsert.error
        }
      }
      setMessage('Perfil guardado correctamente.')
    } catch (saveError) {
      setError(toSpanishError(saveError))
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) {
    return <p className="page-message">Cargando perfil…</p>
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
        <Link className="text-link" to={`/room/${room.slug}`}>
          ← Volver al room
        </Link>
        <section className="card empty-state">
          <h1>Mi perfil</h1>
          <p>{accessMessage}</p>
          {member?.status === 'pending' && (
            <Link className="primary-link" to={`/join/${room.slug}`}>
              Ver solicitud
            </Link>
          )}
        </section>
      </main>
    )
  }

  return (
    <main className="page-shell">
      <Link className="text-link" to={`/room/${room.slug}`}>
        ← Volver al room
      </Link>
      <header className="profile-header">
        <div>
          <span className="eyebrow">Perfil de gustos</span>
          <h1>{room.name}</h1>
          <p className="muted">
            Cuéntanos qué tienes disponible y qué te apetece jugar.
          </p>
        </div>
      </header>

      <form className="stack profile-form" onSubmit={saveProfile} noValidate>
        <section className="card profile-section">
          <div className="section-heading">
            <div>
              <h2>Plataformas</h2>
              <p className="muted">Selecciona al menos una plataforma.</p>
            </div>
            <span className="selection-count">{selectedPlatforms.length} seleccionadas</span>
          </div>
          <div className="catalog-groups">
            {platformFamilyOrder.map((family) => {
              const options = platformsByFamily.get(family) ?? []
              if (options.length === 0) {
                return null
              }
              return (
                <fieldset className="catalog-group" key={family}>
                  <legend>{platformFamilyLabels[family] ?? family}</legend>
                  <div className="catalog-grid">
                    {options.map((platform) => (
                      <label className="catalog-option" key={platform.id}>
                        <input
                          type="checkbox"
                          checked={selectedPlatforms.includes(platform.id)}
                          onChange={(event) =>
                            setSelectedPlatforms((current) =>
                              toggleValue(current, platform.id, event.target.checked),
                            )
                          }
                        />
                        <span>{platform.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )
            })}
          </div>
        </section>

        <section className="card profile-section">
          <h2>Suscripciones</h2>
          <p className="muted">Opcionales: marca las suscripciones que tienes.</p>
          <fieldset className="catalog-group">
            <legend>Suscripciones de juegos</legend>
            <div className="catalog-grid">
              {subscriptionOptions.map((subscription) => (
                <label className="catalog-option" key={subscription.id}>
                  <input
                    type="checkbox"
                    checked={selectedSubscriptions.includes(subscription.id)}
                    onChange={(event) =>
                      setSelectedSubscriptions((current) =>
                        toggleValue(current, subscription.id, event.target.checked),
                      )
                    }
                  />
                  <span>
                    {subscription.name}
                    {subscription.tier ? ` — ${subscription.tier}` : ''}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="catalog-group">
            <legend>Servicios en la nube</legend>
            <div className="catalog-grid">
              {cloudOptions.map((subscription) => (
                <label className="catalog-option" key={subscription.id}>
                  <input
                    type="checkbox"
                    checked={selectedSubscriptions.includes(subscription.id)}
                    onChange={(event) =>
                      setSelectedSubscriptions((current) =>
                        toggleValue(current, subscription.id, event.target.checked),
                      )
                    }
                  />
                  <span>{subscription.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="card profile-section">
          <div className="section-heading">
            <div>
              <h2>Géneros</h2>
              <p className="muted">
                Elige tus favoritos y, opcionalmente, los que prefieres evitar.
              </p>
            </div>
            <span className="selection-count">{favoriteGenres.length} favoritos</span>
          </div>
          <div className="genre-columns">
            <fieldset className="catalog-group">
              <legend>Me gustan (obligatorio)</legend>
              <div className="catalog-grid">
                {genres.map((genre) => (
                  <label className="catalog-option" key={`like-${genre.id}`}>
                    <input
                      type="checkbox"
                      checked={favoriteGenres.includes(genre.id)}
                      onChange={(event) =>
                        handleGenreChange(genre.id, 'like', event.target.checked)
                      }
                    />
                    <span>{genre.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="catalog-group">
              <legend>Prefiero evitar (opcional)</legend>
              <div className="catalog-grid">
                {genres.map((genre) => (
                  <label className="catalog-option" key={`avoid-${genre.id}`}>
                    <input
                      type="checkbox"
                      checked={avoidedGenres.includes(genre.id)}
                      onChange={(event) =>
                        handleGenreChange(genre.id, 'avoid', event.target.checked)
                      }
                    />
                    <span>{genre.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
        <button type="submit" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar perfil'}
        </button>
      </form>
    </main>
  )
}
