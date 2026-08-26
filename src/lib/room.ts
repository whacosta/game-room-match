export type PublicRoom = {
  slug: string
  name: string
  description: string
  member_count: number
  max_members: number
}

export type Room = {
  id: string
  slug: string
  name: string
  description: string
  is_public: boolean
  max_members: number
  auto_approve: boolean
  is_open: boolean
  owner_id: string
}

export type Membership = {
  id: string
  room_id: string
  user_id: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export function shortUserId(userId: string) {
  return `${userId.slice(0, 6)}…${userId.slice(-4)}`
}

export function statusLabel(status: Membership['status']) {
  if (status === 'approved') {
    return 'Aprobado'
  }
  if (status === 'rejected') {
    return 'Rechazado'
  }
  return 'Pendiente'
}

export function slugify(value: string) {
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const suffix = crypto.randomUUID().slice(0, 6).toLowerCase()
  return `${base || 'room'}-${suffix}`
}
