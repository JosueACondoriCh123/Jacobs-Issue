import { normalizeTelemetry } from '../lib/telemetry'
import type { HUDTelemetryEvent, RiskLevel } from '../types/hud'

const scenarios: Array<{
  label: string
  minDb: number
  maxDb: number
  risk: RiskLevel
}> = [
  { label: 'Conversación cercana', minDb: 52, maxDb: 66, risk: 'NORMAL' },
  { label: 'Bicicleta aproximándose', minDb: 64, maxDb: 78, risk: 'ADVISORY' },
  { label: 'Timbre de puerta', minDb: 69, maxDb: 82, risk: 'ADVISORY' },
  { label: 'Sirena de emergencia', minDb: 88, maxDb: 108, risk: 'CRITICAL' },
  { label: 'Vehículo en movimiento', minDb: 76, maxDb: 94, risk: 'CRITICAL' },
  { label: 'Pasos', minDb: 38, maxDb: 55, risk: 'NORMAL' },
]

export function generateMockTelemetry(random = Math.random): HUDTelemetryEvent {
  const scenario = scenarios[Math.floor(random() * scenarios.length)] ?? scenarios[0]
  const intensity = scenario.minDb + random() * (scenario.maxDb - scenario.minDb)

  return normalizeTelemetry(
    {
      azimuth: Math.round(random() * 359),
      intensity: Math.round(intensity * 10) / 10,
      label: scenario.label,
      risk: scenario.risk,
      confidence: Math.round((0.82 + random() * 0.17) * 100) / 100,
    },
    'mock',
  )
}

export function startMockTelemetryEmitter(
  onTelemetry: (telemetry: HUDTelemetryEvent) => void,
  intervalMs = 2400,
) {
  onTelemetry(generateMockTelemetry())
  const interval = window.setInterval(() => onTelemetry(generateMockTelemetry()), intervalMs)
  return () => window.clearInterval(interval)
}
