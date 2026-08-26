export function toSpanishError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()

  if (normalized.includes('invalid login credentials')) {
    return 'El correo o la contraseña no son correctos.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Confirma tu correo electrónico antes de iniciar sesión.'
  }
  if (normalized.includes('user already registered')) {
    return 'Ya existe una cuenta con ese correo.'
  }
  if (normalized.includes('password')) {
    return 'La contraseña debe tener al menos 8 caracteres.'
  }
  if (normalized.includes('room está cerrado') || normalized.includes('room esta cerrado')) {
    return 'El room está cerrado a nuevas solicitudes.'
  }
  if (normalized.includes('máximo') || normalized.includes('maximo')) {
    return 'El room alcanzó su máximo de miembros.'
  }
  if (normalized.includes('duplicate') || normalized.includes('unique')) {
    return 'Este registro ya existe.'
  }

  return message || 'Ha ocurrido un error. Inténtalo de nuevo.'
}
