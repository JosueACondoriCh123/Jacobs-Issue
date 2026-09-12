import type { HUDTelemetryEvent, RiskLevel } from '../types/hud'
import { signalLabels, type SignalState } from './signalState'

export type AmbientStateId = 'QUIET' | 'NORMAL' | 'ADVISORY' | 'CRITICAL' | 'NO_SIGNAL'

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
  signal: SignalState = 'LIVE',
): AmbientState {
  if (signal !== 'LIVE') return {id:'NO_SIGNAL',risk:'NORMAL',eyebrow:'SIN LECTURA ACTUAL',title:signalLabels[signal],message:'No hay datos recientes para evaluar el entorno.',hasAlert:false}
  if (telemetry.risk === 'CRITICAL' || telemetry.intensity >= 85) {
    return {
      id: 'CRITICAL',
      risk: 'CRITICAL',
      eyebrow: 'ALERTA ACTIVA',
      title: 'Alerta acústica',
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
      message: 'No se detectaron alertas en la lectura reciente.',
      hasAlert: false,
    }
  }

  return {
    id: 'NORMAL',
    risk: 'NORMAL',
    eyebrow: 'ENTORNO ESTABLE',
    title: 'Situación normal',
    message: 'La lectura reciente no activó una alerta.',
    hasAlert: false,
  }
}
