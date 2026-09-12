import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false)
      return
    }

    let active = true
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      setUser(data.session?.user ?? null)
      setError(sessionError?.message ?? null)
      setIsLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setIsLoading(false)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      setError('Configura las variables públicas de Supabase para habilitar Google OAuth.')
      return
    }

    setError(null)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })
    setError(oauthError?.message ?? null)
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    setError(signOutError?.message ?? null)
  }, [])

  return {
    user,
    isLoading,
    error,
    isConfigured: isSupabaseConfigured,
    signInWithGoogle,
    signOut,
  }
}
