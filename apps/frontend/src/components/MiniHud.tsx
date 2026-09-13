import type { CSSProperties } from 'react'
import { getAmbientState } from '../lib/miniHudState'
import type { HUDTelemetryEvent } from '../types/hud'
import type { SignalState } from '../lib/signalState'
import type { ModelState, PersistenceState } from '../ai/neuralPipeline'

interface MiniHudProps {
  pipeline?: { model: ModelState; persistence: PersistenceState; connectionError: string | null }
  signal?: SignalState
  telemetry: HUDTelemetryEvent
  isFloating: boolean
  onClose: () => void
}

const barStyle = (height: number, delay: number) =>
  ({
    '--bar-height': `${height}%`,
    '--bar-delay': `${delay}ms`,
  }) as CSSProperties

export function MiniHud({ telemetry, isFloating, onClose, pipeline, signal = telemetry.source === 'idle' ? 'WAITING' : 'LIVE' }: MiniHudProps) {
  const ambient = getAmbientState(telemetry,signal)
  const energy = signal === 'LIVE' ? Math.min(1, Math.max(0, telemetry.intensity / 105)) : 0
  const bars = Array.from({ length: 17 }, (_, index) => {
    const distance = Math.abs(index - 8) / 8
    const shape = 1 - distance * 0.68
    const ripple = 0.82 + Math.sin(index * 1.7) * 0.18
    return Math.round(energy * shape * ripple * 86)
  })

  return (
    <section
      className={`mini-hud mini-state-${ambient.id.toLowerCase()}`}
      aria-label="Monitor ambiental flotante"
    >
      <header className="mini-hud-header">
        <span className="mini-logo" aria-hidden="true"><i /><i /><i /></span>
        <span className="mini-brand">
          <strong>ECHO</strong>VISION
          <small>MINI HUD</small>
        </span>
        <button type="button" onClick={onClose} aria-label="Cerrar Mini HUD">×</button>
      </header>

      <div className="mini-sound-core" aria-hidden="true">
        <div className="mini-wave">
          {bars.map((height, index) => (
            <i key={index} style={barStyle(height, index * -38)} />
          ))}
        </div>
        <div className="mini-reading">
          <strong>{signal === 'LIVE' ? Math.round(telemetry.intensity) : '--'}</strong>
          <span>dB estimados</span>
        </div>
        <span
          hidden={telemetry.directionValid !== true || signal !== 'LIVE'}
          className="mini-direction"
          style={{ transform: `rotate(${telemetry.azimuth}deg)` }}
        >
          ↑
        </span>
      </div>

      <div className="mini-status-copy">
        <span className="mini-alert-label"><i />{ambient.eyebrow}</span>
        <h2>{ambient.title}</h2>
        <p>{ambient.message}</p>
      </div>

      {pipeline ? <div className="mini-runtime-status" role="status">
        <span>YAMNet: {pipeline.model === 'ERROR' ? 'No disponible' : pipeline.model}</span>
        <span>Evento: {pipeline.persistence === 'ERROR' ? 'No guardado' : pipeline.persistence === 'SAVED' ? 'Guardado' : pipeline.persistence === 'SAVING' ? 'Guardando…' : 'Solo local'}</span>
        {pipeline.connectionError ? <span title={pipeline.connectionError}>Error de conexión · nivel local</span> : null}
      </div> : null}
      <footer className="mini-hud-footer">
        <span>
          <small>FUENTE</small>
          <strong>{telemetry.label}</strong>
        </span>
        <span>
          <small>DIRECCIÓN</small>
          <strong>{telemetry.directionValid === true && signal === 'LIVE' ? `${Math.round(telemetry.azimuth)}°` : 'No disponible'}</strong>
        </span>
        <span className={`mini-live ${isFloating ? 'is-floating' : ''}`}>
          <i /> {isFloating ? 'FLOTANTE' : 'EN PÁGINA'}
        </span>
      </footer>

      <p className="sr-only" aria-live="assertive">
        {ambient.hasAlert
          ? `${ambient.title}. ${telemetry.label}, ${Math.round(telemetry.intensity)} decibelios estimados.`
          : `${ambient.title}. ${signal === 'LIVE' ? `${Math.round(telemetry.intensity)} decibelios estimados.` : 'Sin datos actuales.'}`}
      </p>
    </section>
  )
}
