import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { toSpanishError } from '../lib/errors'

export default function AuthPage() {
  const { loading: authLoading, user, signIn, signUp } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const requestedRedirect = params.get('redirect') ?? '/'
  const redirectTo = requestedRedirect.startsWith('/') ? requestedRedirect : '/'
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!authLoading && user) {
      navigate(redirectTo, { replace: true })
    }
  }, [authLoading, navigate, redirectTo, user])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')

    if (!email.includes('@')) {
      setError('Introduce un correo electrónico válido.')
      return
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (mode === 'signup' && password !== confirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setSaving(true)
    try {
      const nextSession =
        mode === 'signin'
          ? await signIn(email, password)
          : await signUp(email, password)

      if (nextSession) {
        navigate(redirectTo, { replace: true })
      } else {
        setMessage(
          'Cuenta creada. Revisa tu correo para confirmar la cuenta y después inicia sesión.',
        )
      }
    } catch (submitError) {
      setError(toSpanishError(submitError))
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || user) {
    return <p className="page-message">Cargando…</p>
  }

  return (
    <main className="auth-layout">
      <section className="auth-card card">
        <Link className="brand-link" to="/">
          Game Room Match
        </Link>
        <h1>{mode === 'signin' ? 'Iniciar sesión' : 'Crear una cuenta'}</h1>
        <p className="muted">
          {mode === 'signin'
            ? 'Entra para gestionar tus rooms.'
            : 'Regístrate para crear o unirte a un room.'}
        </p>
        <form onSubmit={handleSubmit} className="stack">
          <label>
            Correo electrónico
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          {mode === 'signup' && (
            <label>
              Repite la contraseña
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={8}
                required
              />
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-success">{message}</p>}
          <button type="submit" disabled={saving}>
            {saving
              ? 'Procesando…'
              : mode === 'signin'
                ? 'Iniciar sesión'
                : 'Registrarme'}
          </button>
        </form>
        <button
          type="button"
          className="button-link"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError('')
            setMessage('')
          }}
        >
          {mode === 'signin'
            ? '¿No tienes cuenta? Regístrate'
            : '¿Ya tienes cuenta? Inicia sesión'}
        </button>
      </section>
    </main>
  )
}
