import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type { TelemetryPayload } from '../types'
import { TELEMETRY_CHANNEL, TELEMETRY_EVENT } from '../types'
import type { TelemetryTransport } from './types'
import { supabase, isRealtimePrivate } from '../../lib/supabase'

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
  private unsubscribeAuth:(()=>void) | null=null
  private closing=false
  constructor(private onError:(message:string)=>void=()=>{}) {}

  async connect(): Promise<void> {
    this.closing=false
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

    const session=await supabase?.auth.getSession()
    if (session?.data.session) await this.client.realtime.setAuth(session.data.session.access_token)
    const authSubscription=supabase?.auth.onAuthStateChange((_event,nextSession)=> {
      const client=this.client
      if(client) queueMicrotask(()=> {void client.realtime.setAuth(nextSession?.access_token ?? key).catch(error=>this.onError(String(error)))})
    })
    this.unsubscribeAuth=()=>authSubscription?.data.subscription.unsubscribe()
    const channel = this.client.channel(TELEMETRY_CHANNEL,{config:{private:isRealtimePrivate}})
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
          const message='No se pudo suscribir al canal '+TELEMETRY_CHANNEL+': '+status
          this.onError(message);reject(new Error(message))
        }
        if(status==='CLOSED' && !this.closing) this.onError('Realtime: canal de publicación cerrado')
      })
    })
  }

  publish(payload: TelemetryPayload): void {
    if(!this.channel) {this.onError('Realtime: no hay canal de publicación');return}
    void this.channel.send({
      type: 'broadcast',
      event: TELEMETRY_EVENT,
      payload,
    }).then(status=>{if(status!=='ok') this.onError(`Realtime: publicación no confirmada (${status})`)}).catch(error=>this.onError(String(error)))
  }

  async disconnect(): Promise<void> {
    this.closing=true;this.unsubscribeAuth?.();this.unsubscribeAuth=null
    if (this.channel && this.client) {
      await this.client.removeChannel(this.channel)
    }
    this.channel = null
    this.client = null
  }
}
