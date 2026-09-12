import type { HUDTelemetryEvent } from '../types/hud'

interface EventLogProps {
  history: HUDTelemetryEvent[]
}

const formatTime = (value: string) =>
  new Intl.DateTimeFormat('es-BO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))

export function EventLog({ history }: EventLogProps) {
  return (
    <aside className="event-panel glass-panel" aria-label="Registro de eventos acústicos">
      <div className="panel-kicker">
        <span>EVENTOS DETECTADOS</span>
        <span>{history.length.toString().padStart(2, '0')}</span>
      </div>
      <ol className="event-list">
        {history.map((event, index) => (
          <li key={event.id} className={index === 0 ? 'active' : ''}>
            <span className={`risk-dot risk-${event.risk.toLowerCase()}`} />
            <span className="event-copy">
              <strong>{event.label}</strong>
              <small>{event.risk} / {Math.round(event.azimuth)}°</small>
            </span>
            <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
          </li>
        ))}
      </ol>
    </aside>
  )
}
