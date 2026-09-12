import type { CSSProperties } from 'react'
import { getAmbientState } from '../lib/miniHudState'
import type { HUDTelemetryEvent } from '../types/hud'

interface MiniHudProps {
  telemetry: HUDTelemetryEvent
  isFloating: boolean
  onClose: () => void
}

const barStyle = (height: number, delay: number) =>
  ({
    '--bar-height': `${height}%`,
    '--bar-delay': `${delay}ms`,
  }) as CSSProperties

export function MiniHud({ telemetry, isFloating, onClose }: MiniHudProps) {
  const ambient = getAmbientState(telemetry)
  const energy = Math.min(1, Math.max(0.14, telemetry.intensity / 105))
  const bars = Array.from({ length: 17 }, (_, index) => {
    const distance = Math.abs(index - 8) / 8
    const shape = 1 - distance * 0.68
    const ripple = 0.82 + Math.sin(index * 1.7) * 0.18
    return Math.round(12 + energy * shape * ripple * 74)
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
          <strong>{Math.round(telemetry.intensity)}</strong>
          <span>dB</span>
        </div>
        <span
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

      <footer className="mini-hud-footer">
        <span>
          <small>FUENTE</small>
          <strong>{telemetry.label}</strong>
        </span>
        <span>
          <small>DIRECCIÓN</small>
          <strong>{Math.round(telemetry.azimuth)}°</strong>
        </span>
        <span className={`mini-live ${isFloating ? 'is-floating' : ''}`}>
          <i /> {isFloating ? 'FLOTANTE' : 'EN PÁGINA'}
        </span>
      </footer>

      <p className="sr-only" aria-live="assertive">
        {ambient.hasAlert
          ? `${ambient.title}. ${telemetry.label}, ${Math.round(telemetry.intensity)} decibelios, dirección ${Math.round(telemetry.azimuth)} grados.`
          : `${ambient.title}. ${Math.round(telemetry.intensity)} decibelios.`}
      </p>
    </section>
  )
}
