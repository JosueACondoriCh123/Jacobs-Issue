import type { User } from '@supabase/supabase-js'

interface AuthControlProps {
  user: User | null
  loading: boolean
  configured: boolean
  onSignIn: () => void
  onSignOut: () => void
}

export function AuthControl({
  user,
  loading,
  configured,
  onSignIn,
  onSignOut,
}: AuthControlProps) {
  if (user) {
    const name = user.user_metadata?.full_name ?? user.email ?? 'Operador'
    return (
      <button className="operator-chip" type="button" onClick={onSignOut} title="Cerrar sesión">
        <span className="operator-avatar">{String(name).slice(0, 1).toUpperCase()}</span>
        <span className="operator-copy">
          <small>OPERADOR VINCULADO</small>
          <strong>{name}</strong>
        </span>
        <span className="sign-out-mark" aria-hidden="true">↗</span>
      </button>
    )
  }

  return (
    <button
      className="google-button"
      type="button"
      onClick={onSignIn}
      aria-label={configured ? 'Continuar con Google' : 'Configurar Google OAuth'}
    >
      <span className="google-mark" aria-hidden="true">G</span>
      <span>{loading ? 'CONECTANDO...' : configured ? 'CONTINUAR CON GOOGLE' : 'MODO DEMO'}</span>
    </button>
  )
}
