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

type Tab = 'members' | 'settings'
type ProfileStatus = 'complete' | 'incomplete' | 'unknown'

export default function RoomPage() {
  const { slug } = useParams()
  const { loading: authLoading, user } = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<Room | null>(null)
  const [members, setMembers] = useState<Membership[]>([])
  const [profileStatuses, setProfileStatuses] = useState<Record<string, ProfileStatus>>({})
  const [profileError, setProfileError] = useState('')
  const [tab, setTab] = useState<Tab>('members')
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

  const loadRoom = useCallback(async () => {
    if (!user || !slug) {
      return
    }
    setLoading(true)
    setError('')
    setProfileError('')
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
  }, [slug, user])

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

      {tab === 'members' ? (
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
