import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

/**
 * Acciones de autenticación para la pantalla de acceso.
 *
 * No toca `hooks/useAuth.ts` (Dev 1), que solo cubre sesión y Google. Aquí se
 * añade email y contraseña, que es lo único que el proyecto tiene habilitado hoy.
 *
 * Los proveedores se consultan en vivo a `/auth/v1/settings` en vez de asumirse:
 * así el botón de Google se enciende solo en cuanto alguien lo configure en el
 * panel de Supabase, sin tocar este código. Mostrar un botón que responde
 * «provider is not enabled» sería una trampa para quien lo pulse.
 */

export interface AuthProviders {
  email: boolean
  google: boolean
  /** true cuando el registro exige confirmar el correo antes de poder entrar. */
  requiresEmailConfirmation: boolean
  signupDisabled: boolean
  loaded: boolean
}

const INITIAL_PROVIDERS: AuthProviders = {
  email: false,
  google: false,
  requiresEmailConfirmation: true,
  signupDisabled: false,
  loaded: false,
}

export type AuthMessage = { kind: 'error' | 'ok' | 'info'; text: string } | null

export function useAuthForm() {
  const [providers, setProviders] = useState<AuthProviders>(INITIAL_PROVIDERS)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<AuthMessage>(null)

  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim()
    const key = (
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
    )?.trim()
    if (!url || !key) {
      setProviders((p) => ({ ...p, loaded: true }))
      return
    }

    let active = true
    void fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => r.json())
      .then((d: {
        external?: Record<string, boolean>
        disable_signup?: boolean
        mailer_autoconfirm?: boolean
      }) => {
        if (!active) return
        setProviders({
          email: Boolean(d.external?.email),
          google: Boolean(d.external?.google),
          requiresEmailConfirmation: !d.mailer_autoconfirm,
          signupDisabled: Boolean(d.disable_signup),
          loaded: true,
        })
      })
      .catch(() => active && setProviders((p) => ({ ...p, loaded: true })))

    return () => {
      active = false
    }
  }, [])

  const signUp = useCallback(
    async (email: string, password: string, fullName: string) => {
      if (!supabase) {
        setMessage({ kind: 'error', text: 'Supabase no está configurado en este entorno.' })
        return false
      }
      setBusy(true)
      setMessage(null)

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: window.location.origin,
        },
      })
      setBusy(false)

      if (error) {
        setMessage({ kind: 'error', text: translate(error.message) })
        return false
      }

      // Sin sesión de vuelta significa que Supabase espera la confirmación.
      if (!data.session) {
        setMessage({
          kind: 'info',
          text: `Cuenta creada. Revisa ${email} y confirma el correo: hasta entonces no podrás iniciar sesión.`,
        })
        return false
      }

      setMessage({ kind: 'ok', text: 'Cuenta creada y sesión iniciada.' })
      return true
    },
    [],
  )

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      setMessage({ kind: 'error', text: 'Supabase no está configurado en este entorno.' })
      return false
    }
    setBusy(true)
    setMessage(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)

    if (error) {
      setMessage({ kind: 'error', text: translate(error.message) })
      return false
    }
    return true
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setMessage({ kind: 'error', text: translate(error.message) })
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    if (!supabase || !email) return
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setBusy(false)
    setMessage(
      error
        ? { kind: 'error', text: translate(error.message) }
        : { kind: 'info', text: `Si existe una cuenta con ${email}, recibirás un enlace de acceso.` },
    )
  }, [])

  return {
    providers,
    busy,
    message,
    setMessage,
    signUp,
    signIn,
    signInWithGoogle,
    resetPassword,
    isConfigured: isSupabaseConfigured,
  }
}

/** Los mensajes de GoTrue llegan en inglés y son crípticos para quien no lo es. */
function translate(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos. Si acabas de registrarte, confirma antes el correo.'
  }
  if (m.includes('email not confirmed')) {
    return 'Falta confirmar el correo. Busca el mensaje de Supabase en tu bandeja de entrada.'
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Ese correo ya tiene cuenta. Prueba a iniciar sesión.'
  }
  if (m.includes('password should be at least')) {
    return 'La contraseña es demasiado corta: usa al menos 6 caracteres.'
  }
  if (m.includes('provider is not enabled')) {
    return 'Ese proveedor no está habilitado en el proyecto de Supabase.'
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Demasiados intentos seguidos. Espera un minuto antes de volver a probar.'
  }
  if (m.includes('unable to validate email')) {
    return 'Ese correo no parece válido.'
  }
  return msg
}
