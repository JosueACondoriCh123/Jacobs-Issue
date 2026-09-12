import type {
  AcousticEventRow,
  HUDTelemetry,
  HUDTelemetryEvent,
  RiskLevel,
} from '../types/hud'

const risks = new Set<RiskLevel>(['NORMAL', 'ADVISORY', 'CRITICAL'])

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const toNumber = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const firstDefined = (...values: unknown[]) => values.find((value) => value != null)

const calculateLatency = (origin: unknown, receivedAt: number) => {
  if (typeof origin !== 'string') return null
  const originMs = Date.parse(origin)
  if (!Number.isFinite(originMs)) return null
  return Math.max(0, Math.round(receivedAt - originMs))
}

const normalizeRisk = (value: unknown): RiskLevel => {
  const candidate = String(value ?? '').toUpperCase() as RiskLevel
  return risks.has(candidate) ? candidate : 'NORMAL'
}

export const normalizeAzimuth = (value: number) => ((value % 360) + 360) % 360

export function normalizeTelemetry(
  input: Record<string, unknown>,
  source: HUDTelemetryEvent['source'] = 'broadcast',
): HUDTelemetryEvent {
  const receivedAtMs = Date.now()
  const metadata = isRecord(input.metadata) ? input.metadata : {}
  const confidence = clamp(toNumber(input.confidence, 0), 0, 1)
  const spatialConfidence = clamp(toNumber(firstDefined(input.spatialConfidence, metadata.spatialConfidence), 0), 0, 1)
  const directionValid = firstDefined(input.directionValid, metadata.directionValid) === true && spatialConfidence > 0.2
  const timestamp = String(
    firstDefined(input.capturedAt, input.captured_at, input.timestamp) ??
      new Date(receivedAtMs).toISOString(),
  )
  const latencyOrigin = firstDefined(
    input.emittedAt,
    input.emitted_at,
    input.commit_timestamp,
    input.timestamp,
  )

  return {
    id: String(input.id ?? crypto.randomUUID()),

    intensity: clamp(
      toNumber(firstDefined(input.intensity, input.decibels), 0),
      0,
      120,
    ),
    label: String(firstDefined(input.label, input.sound_label) ?? 'Sonido no identificado'),
    risk: normalizeRisk(firstDefined(input.risk, input.risk_level)),
    confidence,
    timestamp,
    receivedAt: new Date(receivedAtMs).toISOString(),
    latencyMs: calculateLatency(latencyOrigin, receivedAtMs),
    source,
    kind: input.kind === 'level' ? 'level' : 'event',
    spatialConfidence,
    directionValid,
    azimuth: directionValid ? normalizeAzimuth(toNumber(firstDefined(input.azimuth, input.azimuth_angle), 0)) : 0,
    model: String(firstDefined(input.model, metadata.model_version) ?? 'unknown'),
    capturedAt: String(firstDefined(input.capturedAt, input.captured_at, metadata.captured_at, timestamp)),
    emittedAt: String(firstDefined(input.emittedAt, input.emitted_at, metadata.emitted_at, timestamp)),
    persistence: input.persistence === 'ERROR' ? 'ERROR' : source === 'postgres' ? 'SAVED' : input.persistence === 'SAVED' ? 'SAVED' : 'LOCAL',
  }
}

export function mapRealtimeBroadcast(payload: unknown): HUDTelemetryEvent {
  const envelope = isRecord(payload) ? payload : {}
  const record = isRecord(envelope.new)
    ? envelope.new
    : isRecord(envelope.record)
      ? envelope.record
      : isRecord(envelope.payload)
        ? envelope.payload
        : envelope

  return normalizeTelemetry(
    {
      ...record,
      commit_timestamp: firstDefined(
        envelope.emitted_at,
        envelope.commit_timestamp,
        record.emitted_at,
        record.timestamp,
      ),
    },
    'broadcast',
  )
}

export function mapAcousticEvent(row: AcousticEventRow): HUDTelemetryEvent {
  return normalizeTelemetry(
    {
      id: row.id,
      azimuth: row.azimuth_angle,
      intensity: row.decibels,
      label: row.sound_label,
      risk: row.risk_level,
      confidence: row.confidence,
      timestamp: row.timestamp,
      captured_at: row.captured_at,
      emitted_at: row.emitted_at,
      metadata: row.metadata,
      kind: 'event',
    },
    'postgres',
  )
}
