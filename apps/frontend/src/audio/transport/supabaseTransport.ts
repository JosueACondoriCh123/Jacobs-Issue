import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type { TelemetryPayload } from '../types'
import { TELEMETRY_CHANNEL, TELEMETRY_EVENT } from '../types'
import type { TelemetryTransport } from './types'

/**
 * Publicación en el canal broadcast de Supabase Realtime.
 *
 * POR QUÉ UN CLIENTE PROPIO Y NO EL DE `lib/supabase.ts`
 *
 * `supabase-js` cachea los canales por topic: dos llamadas a
 * `client.channel('hud-telemetry')` sobre el mismo cliente devuelven el MISMO
 * objeto. En esta aplicación hay dos consumidores de ese topic — este publicador
 * y el hook `useHudTelemetry` del HUD — y el que llega segundo falla con
 * «cannot add postgres_changes callbacks after subscribe()», dejando la pantalla
 * en blanco. El orden de montaje decidía quién rompía a quién.
 *
 * Con un cliente dedicado, emisor y receptor quedan aislados y el orden deja de
 * importar. Cuesta un websocket más, que es barato comparado con un fallo que
 * depende del orden de renderizado.
 *
 * La sesión no se persiste aquí a propósito: el almacenamiento de auth lo lleva
 * el cliente principal, y duplicarlo provoca el aviso de «multiple GoTrueClient
 * instances» y comportamiento indefinido entre ambos.
 */
export class SupabaseTransport implements TelemetryTransport {
  readonly name = 'supabase'
  private client: SupabaseClient | null = null
  private channel: RealtimeChannel | null = null

  async connect(): Promise<void> {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim()
    const key = (
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
    )?.trim()

    if (!url || !key) {
      throw new Error(
        'Supabase no esta configurado: faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY.',
      )
    }

    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // 20 mensajes/s es exactamente el ritmo al que publica el telemetryPublisher.
      realtime: { params: { eventsPerSecond: 20 } },
    })

    const channel = this.client.channel(TELEMETRY_CHANNEL)
    this.channel = channel

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Tiempo agotado al suscribirse a ' + TELEMETRY_CHANNEL)),
        10_000,
      )
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout)
          resolve()
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout)
          reject(new Error('No se pudo suscribir al canal ' + TELEMETRY_CHANNEL + ': ' + status))
        }
      })
    })
  }

  publish(payload: TelemetryPayload): void {
    void this.channel?.send({
      type: 'broadcast',
      event: TELEMETRY_EVENT,
      payload,
    })
  }

  async disconnect(): Promise<void> {
    if (this.channel && this.client) {
      await this.client.removeChannel(this.channel)
    }
    this.channel = null
    this.client = null
  }
}
