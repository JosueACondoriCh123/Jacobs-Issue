import { useEffect, useState, type FormEvent } from 'react'
import { navigate } from '../shell/router'
import { PixelCorner } from './PixelCorner'
import { useAuthForm } from './useAuthForm'
import './landing.css'

/**
 * Pantalla de acceso y registro.
 *
 * Dos decisiones que valen la pena explicar:
 *
 * 1. Email y contraseña van primero, no Google. En este proyecto de Supabase el
 *    único proveedor habilitado es `email`; Google devuelve «provider is not
 *    enabled». Ofrecer un botón de Google destacado que falla al pulsarlo sería
 *    la peor primera impresión posible. El botón existe pero aparece desactivado
 *    y explicado, y se habilita solo si alguien configura el proveedor.
 *
 * 2. El registro avisa de que hace falta confirmar el correo ANTES de pedir los
 *    datos, no después. En este proyecto `mailer_autoconfirm` está en false, así
 *    que quien se registre no podrá entrar hasta pulsar el enlace del email.
 *    Descubrirlo tras rellenar el formulario es una frustración evitable.
 */

type Mode = 'login' | 'signup'

export function AuthScreen({ mode }: { mode: Mode }) {
  const auth = useAuthForm()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')

  // Al alternar entre entrar y registrarse, un mensaje viejo confunde.
  useEffect(() => {
    auth.setMessage(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const isSignup = mode === 'signup'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const ok = isSignup
      ? await auth.signUp(email, password, fullName || email.split('@')[0])
      : await auth.signIn(email, password)
    if (ok) navigate('/hud')
  }

  const go = (route: Parameters<typeof navigate>[0]) => (e: React.MouseEvent) => {
    e.preventDefault()
    navigate(route)
  }

  const passwordTooShort = isSignup && password.length > 0 && password.length < 6
  const canSubmit =
    email.includes('@') && password.length >= 6 && !auth.busy && auth.providers.email

  return (
    <div className="hf">
      <div className="hf-auth">
        {/* ------------------------------------------------------- aside */}
        <aside className="hf-auth-aside">
          <PixelCorner side="left" />

          <a className="hf-logo" href="#/" onClick={go('/')} style={{ marginBottom: '2.5rem' }}>
            <span className="hf-logo-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            JACOBS ISSUE<sup>26</sup>
          </a>

          <p className="hf-aside-quote">
            Tu casa y tu calle
            <br />
            no suenan igual.
            <br />
            <span className="hf-accent">El sistema debería saberlo.</span>
          </p>

          <p style={{ fontSize: '0.95rem', opacity: 0.9 }}>
            Con una cuenta, lo que enseñas a Jacobs Issue deja de vivir en un solo navegador.
          </p>

          <ul className="hf-aside-list">
            <li>
              <span aria-hidden="true">→</span>
              <span>Tus sonidos enrolados te siguen entre dispositivos.</span>
            </li>
            <li>
              <span aria-hidden="true">→</span>
              <span>Tus contactos de emergencia quedan disponibles para el escalado real.</span>
            </li>
            <li>
              <span aria-hidden="true">→</span>
              <span>Tu historial acústico se conserva para revisarlo o exportarlo.</span>
            </li>
          </ul>
        </aside>

        {/* -------------------------------------------------------- main */}
        <main className="hf-auth-main">
          <div className="hf-auth-card">
            <h1 className="hf-display hf-h2" style={{ marginBottom: '0.75rem' }}>
              {isSignup ? 'Crear cuenta' : 'Entrar'}
            </h1>
            <p style={{ marginTop: 0, marginBottom: '1.75rem', fontSize: '0.93rem' }}>
              {isSignup
                ? 'Para sincronizar tus sonidos y contactos entre dispositivos.'
                : 'Accede a tu configuración guardada.'}
            </p>

            <div className="hf-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={!isSignup}
                className={`hf-tab ${!isSignup ? 'is-active' : ''}`}
                onClick={() => navigate('/login')}
              >
                Iniciar sesión
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isSignup}
                className={`hf-tab ${isSignup ? 'is-active' : ''}`}
                onClick={() => navigate('/signup')}
              >
                Registrarse
              </button>
            </div>

            {!auth.isConfigured ? (
              <p className="hf-note hf-note-warn">
                No hay credenciales de Supabase en este entorno, así que no se puede crear ni validar
                ninguna cuenta. Puedes seguir usando Jacobs Issue como invitado.
              </p>
            ) : null}

            {isSignup && auth.providers.loaded && auth.providers.requiresEmailConfirmation ? (
              <p className="hf-note">
                Tras registrarte recibirás un correo de confirmación.{' '}
                <strong>No podrás iniciar sesión hasta pulsar ese enlace.</strong>
              </p>
            ) : null}

            {isSignup && auth.providers.signupDisabled ? (
              <p className="hf-note hf-note-warn">
                El registro está deshabilitado en este proyecto de Supabase. Pide a quien lo
                administre que lo active.
              </p>
            ) : null}

            <form onSubmit={submit} noValidate>
              {isSignup ? (
                <div className="hf-field">
                  <label htmlFor="hf-name">Nombre</label>
                  <input
                    id="hf-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="name"
                    placeholder="Cómo quieres que te llamemos"
                  />
                </div>
              ) : null}

              <div className="hf-field">
                <label htmlFor="hf-email">Correo electrónico</label>
                <input
                  id="hf-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  placeholder="tu@correo.com"
                />
              </div>

              <div className="hf-field">
                <label htmlFor="hf-pass">Contraseña</label>
                <input
                  id="hf-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  placeholder="Mínimo 6 caracteres"
                  aria-describedby={passwordTooShort ? 'hf-pass-hint' : undefined}
                />
                {passwordTooShort ? (
                  <p className="hf-hint" id="hf-pass-hint">
                    Faltan {6 - password.length} caracteres.
                  </p>
                ) : null}
              </div>

              {auth.message ? (
                <p
                  className={`hf-note ${
                    auth.message.kind === 'error' ? 'hf-note-warn' : 'hf-note-ok'
                  }`}
                  role="status"
                >
                  {auth.message.text}
                </p>
              ) : null}

              <button type="submit" className="hf-btn hf-btn-block" disabled={!canSubmit}>
                {auth.busy ? 'Un momento…' : isSignup ? 'Crear cuenta' : 'Entrar'}
              </button>
            </form>

            {!isSignup ? (
              <p className="hf-switch-line">
                <button
                  type="button"
                  className="hf-link"
                  onClick={() => void auth.resetPassword(email)}
                  disabled={!email.includes('@')}
                >
                  He olvidado mi contraseña
                </button>
              </p>
            ) : null}

            <div className="hf-divider">o</div>

            <button
              type="button"
              className="hf-btn hf-btn-block hf-btn-ink"
              onClick={() => void auth.signInWithGoogle()}
              disabled={!auth.providers.google || auth.busy}
              title={
                auth.providers.google
                  ? 'Continuar con Google'
                  : 'Google no está habilitado en este proyecto de Supabase'
              }
            >
              Continuar con Google
            </button>
            {auth.providers.loaded && !auth.providers.google ? (
              <p className="hf-hint" style={{ textAlign: 'center' }}>
                Google no está habilitado en el proyecto todavía. Se activará solo en cuanto se
                configure el proveedor.
              </p>
            ) : null}

            <p className="hf-switch-line">
              ¿Solo quieres probarlo?{' '}
              <a href="#/hud" onClick={go('/hud')} className="hf-link">
                Entrar como invitado
              </a>
            </p>
            <p className="hf-switch-line" style={{ marginTop: '0.5rem' }}>
              <a href="#/" onClick={go('/')} className="hf-link">
                ← Volver al inicio
              </a>
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
