import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { toSpanishError } from '../lib/errors'
import { type PublicRoom, statusLabel } from '../lib/room'
import { supabase } from '../lib/supabase'

type MyRoom = PublicRoom & {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  is_public: boolean
  is_open: boolean
}

function RoomCard({
  room,
  action,
}: {
  room: PublicRoom
  action: ReactNode
}) {
  return (
    <article className="room-card">
      <div>
        <h3>{room.name}</h3>
        <p>{room.description || 'Sin descripción.'}</p>
        <span className="muted">
          {room.member_count}/{room.max_members} miembros
        </span>
      </div>
      {action}
    </article>
  )
}

export default function HomePage() {
  const { loading: authLoading, user, signOut } = useAuth()
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([])
  const [myRooms, setMyRooms] = useState<MyRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (authLoading) {
      return
    }

    let active = true
    const loadRooms = async () => {
      setLoading(true)
      setError('')
      const publicResult = await supabase
        .from('public_rooms')
        .select('slug,name,description,member_count,max_members')
        .order('name')

      if (publicResult.error) {
        if (active) {
          setError(toSpanishError(publicResult.error))
          setLoading(false)
        }
        return
      }

      if (!user) {
        if (active) {
          setPublicRooms((publicResult.data ?? []) as PublicRoom[])
          setMyRooms([])
          setLoading(false)
        }
        return
      }

      const membershipsResult = await supabase
        .from('room_members')
        .select('id,room_id,status')
        .eq('user_id', user.id)

      if (membershipsResult.error) {
        if (active) {
          setError(toSpanishError(membershipsResult.error))
          setLoading(false)
        }
        return
      }

      const memberships = membershipsResult.data ?? []
      const roomIds = memberships.map((membership) => membership.room_id)
      const roomsResult =
        roomIds.length > 0
          ? await supabase
              .from('rooms')
              .select('id,slug,name,description,max_members,is_public,is_open')
              .in('id', roomIds)
          : { data: [], error: null }

      if (roomsResult.error) {
        if (active) {
          setError(toSpanishError(roomsResult.error))
          setLoading(false)
        }
        return
      }

      const approvedMembersResult =
        roomIds.length > 0
          ? await supabase
              .from('room_members')
              .select('room_id')
              .in('room_id', roomIds)
              .eq('status', 'approved')
          : { data: [], error: null }
      const approvedCounts = new Map<string, number>()
      if (!approvedMembersResult.error) {
        for (const member of approvedMembersResult.data ?? []) {
          approvedCounts.set(
            member.room_id,
            (approvedCounts.get(member.room_id) ?? 0) + 1,
          )
        }
      }

      const roomsById = new Map(
        (roomsResult.data ?? []).map((room) => [room.id, room]),
      )
      const mine = memberships.flatMap((membership) => {
        const room = roomsById.get(membership.room_id)
        if (!room) {
          return []
        }
        return [
          {
            ...room,
            member_count: approvedCounts.get(room.id) ?? 0,
            status: membership.status as MyRoom['status'],
          },
        ]
      })

      if (active) {
        setPublicRooms((publicResult.data ?? []) as PublicRoom[])
        setMyRooms(mine as MyRoom[])
        setLoading(false)
      }
    }

    void loadRooms()
    return () => {
      active = false
    }
  }, [authLoading, user])

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (signOutError) {
      setError(toSpanishError(signOutError))
    }
  }

  if (authLoading || loading) {
    return <p className="page-message">Cargando rooms…</p>
  }

  const mySlugs = new Set(myRooms.map((room) => room.slug))
  const otherPublicRooms = publicRooms.filter((room) => !mySlugs.has(room.slug))

  return (
    <main className="page-shell">
      <header className="site-header">
        <div>
          <Link className="brand-link" to="/">
            Game Room Match
          </Link>
          <p className="muted">Juega juntos, encuentra tu próximo juego.</p>
        </div>
        <nav className="header-actions">
          {user ? (
            <>
              <span className="user-label">Sesión iniciada</span>
              <button type="button" className="secondary-button" onClick={handleSignOut}>
                Cerrar sesión
              </button>
            </>
          ) : (
            <Link className="secondary-button" to="/auth">
              Iniciar sesión
            </Link>
          )}
        </nav>
      </header>

      {error && <p className="form-error">{error}</p>}

      <section className="hero card">
        <div>
          <span className="eyebrow">Game Room Match</span>
          <h1>Elige qué jugar con tu grupo.</h1>
          <p className="muted">
            Crea un room, invita a tus amigos y descubre juegos compatibles con
            todos.
          </p>
        </div>
        <Link className="primary-link" to={user ? '/create' : '/auth?redirect=%2Fcreate'}>
          Crear room
        </Link>
      </section>

      {user && (
        <section>
          <div className="section-heading">
            <div>
              <h2>Mis rooms</h2>
              <p className="muted">Tus rooms y el estado de tus solicitudes.</p>
            </div>
            <Link className="text-link" to="/create">
              + Crear otro
            </Link>
          </div>
          {myRooms.length === 0 ? (
            <div className="empty-state card">Todavía no perteneces a ningún room.</div>
          ) : (
            <div className="room-list">
              {myRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  action={
                    <div className="room-card-actions">
                      <span className={`status status-${room.status}`}>
                        {statusLabel(room.status)}
                      </span>
                      {room.status === 'approved' ? (
                        <Link className="secondary-button" to={`/room/${room.slug}`}>
                          Abrir
                        </Link>
                      ) : (
                        <Link className="secondary-button" to={`/join/${room.slug}`}>
                          Ver estado
                        </Link>
                      )}
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <div className="section-heading">
          <div>
            <h2>Rooms públicos</h2>
            <p className="muted">Encuentra un grupo abierto para jugar.</p>
          </div>
        </div>
        {otherPublicRooms.length === 0 ? (
          <div className="empty-state card">No hay rooms públicos abiertos todavía.</div>
        ) : (
          <div className="room-list">
            {otherPublicRooms.map((room) => (
              <RoomCard
                key={room.slug}
                room={room}
                action={
                  <Link
                    className="secondary-button"
                    to={
                      user
                        ? `/join/${room.slug}`
                        : `/auth?redirect=${encodeURIComponent(`/join/${room.slug}`)}`
                    }
                  >
                    Solicitar unirse
                  </Link>
                }
              />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
