import type { RiskLevel } from '../types/hud'

export type { RiskLevel }

/** Canal broadcast compartido con el HUD de Dev 1. */
export const TELEMETRY_CHANNEL = 'hud-telemetry'
export const TELEMETRY_EVENT = 'telemetry'

/** Etiqueta que emite Dev 2 mientras Dev 4 (YAMNet) no ha clasificado el sonido. */
export const UNCLASSIFIED = 'Sonido sin clasificar'

/** Lo que el AudioWorklet envia al hilo principal, ~20 Hz. */
export interface DspTelemetry {
  type: 'telemetry'
  /** dB(A) SPL estimado. */
  db: number
  /** Pico dB(A) desde la emision anterior. */
  peakDb: number
  /** Grados, -90 (izquierda) .. +90 (derecha). */
  azimuth: number
  /** 0..1. Cero significa que no hay informacion direccional real (mono). */
  spatialConfidence: number
  noiseFloorDb: number
  thresholdDb: number
  ambientAverageDb: number
  sessionPeakDb: number
  risk: RiskLevel
  isOnset: boolean
  channelCount: number
  /**
   * Estereo util OBSERVADO en las muestras, no el declarado por el navegador.
   * Es false si los dos canales son identicos (microfono mono duplicado) o si
   * el derecho esta mudo: en esos casos no hay fase entre canales de la que
   * extraer direccion, por mucho que el dispositivo diga tener dos.
   */
  effectiveStereo: boolean
  audioTimeMs: number
}

/** Ventana de audio lista para el clasificador de Dev 4. */
export interface DspAudioFrame {
  capturedAt?: string
  type: 'frame'
  /** 15360 muestras = 0.96 s a 16 kHz, mono, [-1, 1]. */
  pcm: Float32Array
  sampleRate: 16000
  azimuth: number
  peakDb: number
  audioTimeMs: number
}

/**
 * Audio del instante de un evento, para el analisis forense.
 * Misma ventana que usa el clasificador: 0.96 s a 16 kHz.
 */
export interface DspSnapshot {
  type: 'snapshot'
  pcm: Float32Array
  sampleRate: 16000
  azimuth: number
  peakDb: number
  noiseFloorDb: number
  audioTimeMs: number
}

/** Estado real del dispositivo de captura, leido del track y no asumido. */
export interface CaptureStatus {
  active: boolean
  channelCount: number
  sampleRate: number
  deviceLabel: string
  /** true solo si el navegador entrego realmente dos canales. */
  stereo: boolean
  /** Deben ser false las tres: si alguna quedo activa, la medicion no es fiable. */
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  /** Avisos legibles para mostrar en la UI de pruebas. */
  warnings: string[]
}

/**
 * Payload que viaja por el canal broadcast.
 *
 * OJO con `intensity`: el HUD de Dev 1 la trata como DECIBELIOS, no como un
 * valor normalizado 0..1. Se comprueba en tres sitios de su codigo:
 * `mapAcousticEvent` mapea decibels -> intensity, `normalizeTelemetry` la
 * recorta a 0..120, y su emisor mock genera intensity a partir de minDb/maxDb.
 * Enviar aqui un 0..1 haria que el HUD dibujara siempre nivel cero.
 */
export interface TelemetryPayload {
  id?: string
  kind?: 'level' | 'event'
  capturedAt?: string
  emittedAt?: string
  directionValid?: boolean
  model?: string
  persistence?: 'LOCAL' | 'SAVING' | 'SAVED' | 'ERROR'
  azimuth: number
  intensity: number
  label: string
  risk: RiskLevel
  confidence: number
  timestamp: string
  decibels: number
  spatialConfidence: number
  noiseFloorDb: number
  isOnset: boolean
  deviceId: string
}
