import type { HUDTelemetryEvent, RiskLevel } from '../types/hud'

export type AmbientStateId = 'QUIET' | 'NORMAL' | 'ADVISORY' | 'CRITICAL'

export interface AmbientState {
  id: AmbientStateId
  risk: RiskLevel
  eyebrow: string
  title: string
  message: string
  hasAlert: boolean
}

export function getAmbientState(
  telemetry: Pick<HUDTelemetryEvent, 'intensity' | 'risk'>,
): AmbientState {
  if (telemetry.risk === 'CRITICAL' || telemetry.intensity >= 85) {
    return {
      id: 'CRITICAL',
      risk: 'CRITICAL',
      eyebrow: 'ALERTA ACTIVA',
      title: 'Peligro cercano',
      message: 'Ubica la fuente y aléjate si es necesario.',
      hasAlert: true,
    }
  }

  if (telemetry.risk === 'ADVISORY' || telemetry.intensity >= 70) {
    return {
      id: 'ADVISORY',
      risk: 'ADVISORY',
      eyebrow: 'PRECAUCIÓN',
      title: 'Ruido elevado',
      message: 'Mantente atento a los cambios del entorno.',
      hasAlert: true,
    }
  }

  if (telemetry.intensity < 45) {
    return {
      id: 'QUIET',
      risk: 'NORMAL',
      eyebrow: 'SIN ALERTAS',
      title: 'Ambiente tranquilo',
      message: 'No se detectan fuentes de riesgo.',
      hasAlert: false,
    }
  }

  return {
    id: 'NORMAL',
    risk: 'NORMAL',
    eyebrow: 'ENTORNO ESTABLE',
    title: 'Situación normal',
    message: 'El nivel de ruido está dentro del rango seguro.',
    hasAlert: false,
  }
}
