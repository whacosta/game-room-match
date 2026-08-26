import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { toSpanishError } from '../lib/errors'
import { slugify } from '../lib/room'
import { supabase } from '../lib/supabase'

export default function CreateRoomPage() {
  const { loading: authLoading, user } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [maxMembers, setMaxMembers] = useState(10)
  const [autoApprove, setAutoApprove] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth?redirect=%2Fcreate', { replace: true })
    }
  }, [authLoading, navigate, user])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const cleanName = name.trim()
    const cleanDescription = description.trim()

    if (cleanName.length < 3 || cleanName.length > 50) {
      setError('El nombre debe tener entre 3 y 50 caracteres.')
      return
    }
    if (cleanDescription.length > 200) {
      setError('La descripción no puede superar los 200 caracteres.')
      return
    }
    if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 10) {
      setError('El máximo de miembros debe estar entre 2 y 10.')
      return
    }
    if (!user) {
      return
    }

    setSaving(true)
    try {
      const roomResult = await supabase
        .from('rooms')
        .insert({
          slug: slugify(cleanName),
          name: cleanName,
          description: cleanDescription,
          is_public: isPublic,
          max_members: maxMembers,
          auto_approve: isPublic && autoApprove,
          owner_id: user.id,
        })
        .select('id,slug')
        .single()

      if (roomResult.error || !roomResult.data) {
        throw roomResult.error ?? new Error('No se pudo crear el room.')
      }

      const memberResult = await supabase.from('room_members').insert({
        room_id: roomResult.data.id,
        user_id: user.id,
        status: 'approved',
      })
      if (memberResult.error) {
        throw memberResult.error
      }

      navigate(`/room/${roomResult.data.slug}`)
    } catch (submitError) {
      setError(toSpanishError(submitError))
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || !user) {
    return <p className="page-message">Cargando…</p>
  }

  return (
    <main className="narrow-shell">
      <Link className="text-link" to="/">
        ← Volver al inicio
      </Link>
      <section className="card form-card">
        <span className="eyebrow">Nuevo room</span>
        <h1>Crea un espacio para tu grupo</h1>
        <p className="muted">
          Configura cómo podrán encontrarlo y unirse tus amigos.
        </p>
        <form onSubmit={handleSubmit} className="stack">
          <label>
            Nombre
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={3}
              maxLength={50}
              required
            />
            <small>{name.length}/50</small>
          </label>
          <label>
            Descripción
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={200}
              rows={4}
            />
            <small>{description.length}/200</small>
          </label>
          <fieldset>
            <legend>Visibilidad</legend>
            <label className="choice">
              <input
                type="radio"
                name="visibility"
                checked={isPublic}
                onChange={() => setIsPublic(true)}
              />
              <span>
                <strong>Público</strong>
                <small>Aparecerá en el listado público.</small>
              </span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="visibility"
                checked={!isPublic}
                onChange={() => {
                  setIsPublic(false)
                  setAutoApprove(false)
                }}
              />
              <span>
                <strong>Privado</strong>
                <small>Solo se podrá acceder con el enlace de invitación.</small>
              </span>
            </label>
          </fieldset>
          <label>
            Máximo de miembros
            <input
              type="number"
              min={2}
              max={10}
              value={maxMembers}
              onChange={(event) => setMaxMembers(Number(event.target.value))}
              required
            />
          </label>
          {isPublic && (
            <label className="choice checkbox-choice">
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(event) => setAutoApprove(event.target.checked)}
              />
              <span>
                <strong>Aprobación automática</strong>
                <small>Las solicitudes entrarán directamente si hay espacio.</small>
              </span>
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={saving}>
            {saving ? 'Creando…' : 'Crear room'}
          </button>
        </form>
      </section>
    </main>
  )
}
