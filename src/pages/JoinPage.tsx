import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { toSpanishError } from '../lib/errors'
import { statusLabel, type Membership, type Room } from '../lib/room'
import { supabase } from '../lib/supabase'

export default function JoinPage() {
  const { slug } = useParams()
  const { loading: authLoading, user } = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<Room | null>(null)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (authLoading) {
      return
    }
    if (!user) {
      navigate(`/auth?redirect=${encodeURIComponent(`/join/${slug ?? ''}`)}`, {
        replace: true,
      })
    }
  }, [authLoading, navigate, slug, user])

  useEffect(() => {
    if (!user || !slug) {
      return
    }
    let active = true
    const loadJoinState = async () => {
      setLoading(true)
      setError('')
      const roomResult = await supabase
        .from('rooms')
        .select('id,slug,name,description,is_public,max_members,auto_approve,is_open,owner_id')
        .eq('slug', slug)
        .maybeSingle()
      if (roomResult.error || !roomResult.data) {
        if (active) {
          setError(toSpanishError(roomResult.error ?? new Error('Room no encontrado.')))
          setLoading(false)
        }
        return
      }

      const nextRoom = roomResult.data as Room
      const ownResult = await supabase
        .from('room_members')
        .select('id,room_id,user_id,status,created_at')
        .eq('room_id', nextRoom.id)
        .eq('user_id', user.id)
        .maybeSingle()

      let count: number | null = null
      if (nextRoom.is_public && nextRoom.is_open) {
        const publicResult = await supabase
          .from('public_rooms')
          .select('member_count')
          .eq('slug', nextRoom.slug)
          .maybeSingle()
        if (!publicResult.error && publicResult.data) {
          count = Number(publicResult.data.member_count)
        }
      }

      if (active) {
        setRoom(nextRoom)
        setMembership((ownResult.data as Membership | null) ?? null)
        setMemberCount(count)
        setLoading(false)
      }
    }

    void loadJoinState()
    return () => {
      active = false
    }
  }, [slug, user])

  useEffect(() => {
    if (!user || !room || membership?.status !== 'pending') {
      return
    }
    const interval = window.setInterval(() => {
      void supabase
        .from('room_members')
        .select('id,room_id,user_id,status,created_at')
        .eq('room_id', room.id)
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data) {
            setMembership(data as Membership)
          }
        })
    }, 5000)
    return () => window.clearInterval(interval)
  }, [membership?.status, room, user])

  const submitJoin = async () => {
    if (!room || !user) {
      return
    }
    setError('')
    if (!room.is_open) {
      setError('El room está cerrado a nuevas solicitudes.')
      return
    }
    if (memberCount !== null && memberCount >= room.max_members) {
      setError('El room está lleno y no puede aceptar más miembros.')
      return
    }

    setJoining(true)
    const status =
      room.is_public && room.auto_approve && memberCount !== null
        ? 'approved'
        : 'pending'
    const result = await supabase.from('room_members').insert({
      room_id: room.id,
      user_id: user.id,
      status,
    })
    if (result.error) {
      setError(toSpanishError(result.error))
    } else {
      setMembership({
        id: '',
        room_id: room.id,
        user_id: user.id,
        status,
        created_at: new Date().toISOString(),
      })
    }
    setJoining(false)
  }

  if (authLoading || loading || !user) {
    return <p className="page-message">Cargando…</p>
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

  const isFull = memberCount !== null && memberCount >= room.max_members

  return (
    <main className="narrow-shell">
      <Link className="text-link" to="/">
        ← Volver al inicio
      </Link>
      <section className="card join-card">
        <span className="eyebrow">{room.is_public ? 'Room público' : 'Invitación'}</span>
        <h1>{room.name}</h1>
        <p className="muted">{room.description || 'Sin descripción.'}</p>
        <p className="muted">
          {memberCount === null
            ? `Máximo ${room.max_members} miembros`
            : `${memberCount}/${room.max_members} miembros`}
        </p>
        {membership ? (
          <div className="join-status">
            <span className={`status status-${membership.status}`}>
              {statusLabel(membership.status)}
            </span>
            <h2>
              {membership.status === 'approved'
                ? 'Ya eres miembro de este room'
                : membership.status === 'pending'
                  ? 'Solicitud enviada'
                  : 'Solicitud rechazada'}
            </h2>
            <p>
              {membership.status === 'approved'
                ? 'Puedes entrar al room y ver a sus miembros.'
                : membership.status === 'pending'
                  ? 'Estamos esperando la aprobación del owner. Esta página se actualizará automáticamente.'
                  : 'El owner rechazó tu solicitud. No puedes volver a solicitar unirte.'}
            </p>
            {membership.status === 'approved' && (
              <Link className="primary-link" to={`/room/${room.slug}`}>
                Entrar al room
              </Link>
            )}
          </div>
        ) : (
          <>
            <p>
              Solicita unirte para compartir tus preferencias y jugar con el
              grupo.
            </p>
            {!room.is_open && (
              <p className="form-error">El room está cerrado a nuevas solicitudes.</p>
            )}
            {isFull && (
              <p className="form-error">El room está lleno y no acepta más miembros.</p>
            )}
            {error && <p className="form-error">{error}</p>}
            <button
              type="button"
              onClick={() => void submitJoin()}
              disabled={joining || !room.is_open || isFull}
            >
              {joining
                ? 'Enviando…'
                : room.is_public && room.auto_approve
                  ? 'Unirme al room'
                  : 'Solicitar unirme'}
            </button>
          </>
        )}
        {error && membership && <p className="form-error">{error}</p>}
      </section>
    </main>
  )
}
