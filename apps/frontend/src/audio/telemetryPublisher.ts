import { isSupabaseConfigured } from '../lib/supabase'
import type { DspTelemetry, TelemetryPayload } from './types'
import { UNCLASSIFIED } from './types'
import { MockTransport } from './transport/mockTransport'
import { SupabaseTransport } from './transport/supabaseTransport'
import type { TelemetryTransport } from './transport/types'

export type TransportKind = 'mock' | 'supabase'

export interface PublisherOptions {
  transport?: TransportKind
  /** Ritmo maximo de publicacion continua. Por encima de ~20 Hz el ojo no gana nada. */
  throttleHz?: number
  deviceId?: string
}

/**
 * Convierte la telemetria del DSP en el payload que espera el HUD y la publica
 * con control de ritmo.
 *
 * Dos decisiones que importan:
 *
 * 1. El azimut se envia en 0..360, que es la convencion del HUD (0 = al frente,
 *    90 = derecha, 270 = izquierda). GCC-PHAT produce -90..+90 y aqui se mapea.
 *    La mitad trasera queda vacia por una limitacion fisica real: con dos
 *    microfonos no se distingue delante de detras.
 *
 * 2. `intensity` va en DECIBELIOS, no normalizada a 0..1. Es lo que consume el
 *    HUD de Dev 1 (ver la nota en types.ts). Se envia ademas `decibels` con el
 *    mismo valor para que la semantica quede explicita en el cable.
 */
export class TelemetryPublisher {
  private transport: TelemetryTransport
  private minIntervalMs: number
  private deviceId: string
  private lastSentMs = 0
  private connected = false
  private _published = 0
  private _dropped = 0

  constructor(options: PublisherOptions = {}) {
    const kind = options.transport ?? resolveDefaultTransport()
    this.transport = kind === 'supabase' ? new SupabaseTransport() : new MockTransport()
    this.minIntervalMs = 1000 / (options.throttleHz ?? 20)
    this.deviceId = options.deviceId ?? 'hud-primary'
  }

  get transportName(): string {
    return this.transport.name
  }

  get publishedCount(): number {
    return this._published
  }

  /** Mensajes descartados por control de ritmo. Ninguno de ellos es un onset. */
  get droppedCount(): number {
    return this._dropped
  }

  async connect(): Promise<void> {
    await this.transport.connect()
    this.connected = true
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect()
    this.connected = false
  }

  /**
   * @param dsp telemetria cruda del worklet
   * @param label etiqueta de Dev 4 si ya existe
   * @returns el payload enviado, o null si se descarto por ritmo
   */
  publish(dsp: DspTelemetry, label = UNCLASSIFIED): TelemetryPayload | null {
    if (!this.connected) return null

    const now = Date.now()
    // Un onset nunca se descarta: es justo el mensaje que el usuario necesita ver.
    if (!dsp.isOnset && now - this.lastSentMs < this.minIntervalMs) {
      this._dropped++
      return null
    }
    this.lastSentMs = now

    const payload = toPayload(dsp, label, this.deviceId, now)
    this.transport.publish(payload)
    this._published++
    return payload
  }
}

/** Mapea -90..+90 (GCC-PHAT) a 0..360 (convencion del HUD). */
export function toHudAzimuth(azimuth: number): number {
  return ((azimuth % 360) + 360) % 360
}

export function toPayload(
  dsp: DspTelemetry,
  label: string,
  deviceId: string,
  nowMs: number,
): TelemetryPayload {
  return {
    azimuth: toHudAzimuth(dsp.azimuth),
    // DECIBELIOS, no 0..1. Ver el comentario de TelemetryPayload en types.ts.
    intensity: round1(dsp.db),
    label,
    risk: dsp.risk,
    // Con microfono mono no hay direccion real; la confianza espacial lo refleja
    // y el HUD puede atenuar el vector en vez de mostrar un angulo inventado.
    confidence: round2(dsp.spatialConfidence),
    timestamp: new Date(nowMs).toISOString(),
    decibels: round1(dsp.db),
    spatialConfidence: round2(dsp.spatialConfidence),
    noiseFloorDb: round1(dsp.noiseFloorDb),
    isOnset: dsp.isOnset,
    deviceId,
  }
}

/**
 * Transporte que se usara si nadie especifica uno. Se exporta para que la UI
 * pueda mostrar de entrada lo que el entorno va a hacer realmente, en vez de
 * ensenar 'mock' mientras por debajo se publica en Supabase.
 */
export function getDefaultTransport(): TransportKind {
  return resolveDefaultTransport()
}

function resolveDefaultTransport(): TransportKind {
  const configured = import.meta.env.VITE_TELEMETRY_TRANSPORT as TransportKind | undefined
  if (configured === 'supabase' || configured === 'mock') return configured
  // Sin configuracion explicita, se usa Supabase solo si hay credenciales.
  // Asi nada queda bloqueado mientras Dev 3 termina el backend.
  return isSupabaseConfigured ? 'supabase' : 'mock'
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
