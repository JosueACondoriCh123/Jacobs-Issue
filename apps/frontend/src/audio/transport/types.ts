import type { TelemetryPayload } from '../types'

/**
 * Abstraccion del canal de salida.
 *
 * Existe para que el trabajo de Dev 2 no dependa de que Dev 3 haya terminado
 * Supabase: se desarrolla y se demuestra contra el transporte mock, y el cambio
 * al real es una variable de entorno, no una reescritura.
 */
export interface TelemetryTransport {
  readonly name: string
  connect(): Promise<void>
  publish(payload: TelemetryPayload): void
  disconnect(): Promise<void>
}
