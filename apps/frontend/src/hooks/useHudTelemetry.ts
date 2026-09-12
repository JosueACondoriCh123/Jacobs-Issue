import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { mapAcousticEvent, mapRealtimeBroadcast, normalizeTelemetry } from '../lib/telemetry'
import {
  isRealtimePrivate,
  isSupabaseConfigured,
  supabase,
} from '../lib/supabase'
import type { AcousticEventRow, HUDTelemetryEvent } from '../types/hud'

export type ConnectionState = 'CONNECTING' | 'LIVE' | 'ERROR'

const initialTelemetry = normalizeTelemetry(
  {
    id: 'hud-awaiting-live-signal',
    azimuth: 0,
    intensity: 0,
    label: 'Esperando señal en vivo',
    risk: 'NORMAL',
    confidence: 0,
  },
  'idle',
)

const MAX_SEEN_EVENTS = 200

export function useHudTelemetry(userId?: string | null) {
  const [telemetry, setTelemetry] = useState(initialTelemetry)
  const [history, setHistory] = useState<HUDTelemetryEvent[]>([])
  const [connection, setConnection] = useState<ConnectionState>(
    isSupabaseConfigured ? 'CONNECTING' : 'ERROR',
  )
  const [error, setError] = useState<string | null>(
    isSupabaseConfigured
      ? null
      : 'Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
  const [renderLatencyMs, setRenderLatencyMs] = useState<number | null>(null)
  const seenIdsRef = useRef(new Set<string>())
  const seenOrderRef = useRef<string[]>([])
  const frameRef = useRef<number | null>(null)
  const pendingEventRef = useRef<HUDTelemetryEvent | null>(null)

  useEffect(() => {
    if (!supabase) return

    const client = supabase
    let channel: RealtimeChannel | null = null
    let cancelled = false

    const accept = (event: HUDTelemetryEvent) => {
      if (seenIdsRef.current.has(event.id)) return

      seenIdsRef.current.add(event.id)
      seenOrderRef.current.push(event.id)
      if (seenOrderRef.current.length > MAX_SEEN_EVENTS) {
        const expiredId = seenOrderRef.current.shift()
        if (expiredId) seenIdsRef.current.delete(expiredId)
      }

      if (event.kind !== 'level') setHistory(current => [event,...current.filter(e => e.id !== event.id)].slice(0,60))
      pendingEventRef.current = event
      if (frameRef.current !== null) return

      const queuedAt = performance.now()
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        const latestEvent = pendingEventRef.current
        pendingEventRef.current = null
        if (!latestEvent) return

        setTelemetry(latestEvent)
        setRenderLatencyMs(Math.max(0, Math.round(performance.now() - queuedAt)))
      })
    }

    const connect = async () => {
      setConnection('CONNECTING')
      setError(null)

      if (isRealtimePrivate) await client.realtime.setAuth()
      if (cancelled) return

      channel = client.channel('hud-telemetry', {
        config: { private: isRealtimePrivate },
      })

      channel
        .on('broadcast', { event: 'telemetry' }, ({ payload }) => {
          accept(mapRealtimeBroadcast(payload))
        })
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'acoustic_event_logs' },
          (payload) => accept(mapAcousticEvent(payload.new as AcousticEventRow)),
        )
        .subscribe((status, subscribeError) => {
          if (status === 'SUBSCRIBED') {
            setConnection('LIVE')
            setError(null)
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setConnection('ERROR')
            setError(subscribeError?.message ?? `Realtime: ${status}`)
          }
          if (status === 'CLOSED' && !cancelled) {
            setConnection('ERROR')
            setError('El canal hud-telemetry se cerró inesperadamente.')
          }
        })
    }

    void connect().catch((connectError: unknown) => {
      if (cancelled) return
      setConnection('ERROR')
      setError(
        connectError instanceof Error
          ? connectError.message
          : 'No fue posible conectar con Supabase Realtime.',
      )
    })

    return () => {
      cancelled = true
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      pendingEventRef.current = null
      if (channel) void client.removeChannel(channel)
    }
  }, [])

  const averageIntensity = useMemo(() => {
    if (!history.length) return 0
    return history.reduce((total, event) => total + event.intensity, 0) / history.length
  }, [history])
  useEffect(() => {
    if (!supabase || !userId) {setHistory([]);return}
    let cancelled=false
    void supabase.from('acoustic_event_logs').select('*').eq('user_id',userId).order('timestamp',{ascending:false}).limit(60).then(({data,error}) => {
      if (cancelled) return
      if (error) {setError(`Historial: ${error.message}`);return}
      setHistory(current => [...current,...(data ?? []).map(row => mapAcousticEvent(row as AcousticEventRow)).filter(e => !current.some(p => p.id===e.id))].slice(0,60))
    })
    return () => {cancelled=true}
  },[userId])

  return {
    telemetry,
    history,
    connection,
    error,
    averageIntensity,
    renderLatencyMs,
    isPrivateChannel: isRealtimePrivate,
  }
}
