export type RiskLevel = 'NORMAL' | 'ADVISORY' | 'CRITICAL'

// Local mirror of the immutable contract defined for packages/contracts.
// Replace this import when the shared package is published by the integration owner.
export interface HUDTelemetry {
  azimuth: number
  intensity: number
  label: string
  risk: RiskLevel
}

export interface HUDTelemetryEvent extends HUDTelemetry {
  id: string
  confidence: number
  timestamp: string
  receivedAt: string
  latencyMs: number | null
  source: 'idle' | 'mock' | 'broadcast' | 'postgres'
    | 'local'
  kind?: 'level' | 'event'
  spatialConfidence?: number
  directionValid?: boolean
  model?: string
  capturedAt?: string
  emittedAt?: string
  persistence?: 'LOCAL' | 'SAVING' | 'SAVED' | 'ERROR'
}

export interface AcousticEventRow {
  id?: string
  timestamp?: string
  sound_label?: string
  confidence?: number
  decibels?: number
  risk_level?: string
  azimuth_angle?: number
  captured_at?: string
  emitted_at?: string
  metadata?: Record<string, unknown>
}
