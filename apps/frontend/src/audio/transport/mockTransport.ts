import type { TelemetryPayload } from '../types'
import { TELEMETRY_CHANNEL } from '../types'
import type { TelemetryTransport } from './types'

/**
 * Transporte local sobre BroadcastChannel.
 *
 * Esto es lo que permite trabajar en paralelo sin backend: la pagina de pruebas
 * en una pestana alimenta el HUD abierto en otra, dentro del mismo navegador.
 * Misma forma de payload que el transporte de Supabase, asi que el codigo del
 * consumidor no cambia al conmutar.
 */
export class MockTransport implements TelemetryTransport {
  readonly name = 'mock'
  private channel: BroadcastChannel | null = null

  async connect(): Promise<void> {
    this.channel = new BroadcastChannel(TELEMETRY_CHANNEL)
  }

  publish(payload: TelemetryPayload): void {
    this.channel?.postMessage(payload)
  }

  async disconnect(): Promise<void> {
    this.channel?.close()
    this.channel = null
  }
}

/** Suscriptor al canal mock. Lo usa el HUD (o la pagina de pruebas) para recibir. */
export function subscribeMockTelemetry(
  onPayload: (payload: TelemetryPayload) => void,
): () => void {
  const channel = new BroadcastChannel(TELEMETRY_CHANNEL)
  channel.onmessage = (event: MessageEvent) => onPayload(event.data as TelemetryPayload)
  return () => channel.close()
}
