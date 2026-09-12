import type { HUDTelemetryEvent } from '../types/hud'

interface TelemetryPanelProps {
  telemetry: HUDTelemetryEvent
  averageIntensity: number
  renderLatencyMs: number | null
}

export function TelemetryPanel({
  telemetry,
  averageIntensity,
  renderLatencyMs,
}: TelemetryPanelProps) {
  const deliveryLatency = telemetry.latencyMs
  const latencyClass =
    deliveryLatency == null
      ? ''
      : deliveryLatency <= 50
        ? 'latency-good'
        : 'latency-warning'

  return (
    <aside className="telemetry-panel glass-panel" aria-label="Telemetría actual">
      <div className="panel-kicker">
        <span>LECTURA ACTUAL</span>
        <span>01</span>
      </div>
      <div className="metric-primary">
        <strong>{telemetry.intensity.toFixed(1)}</strong>
        <span>dB</span>
      </div>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, telemetry.intensity)}%` }} />
      </div>
      <dl className="metric-grid">
        <div>
          <dt>AZIMUTH</dt>
          <dd>{Math.round(telemetry.azimuth).toString().padStart(3, '0')}°</dd>
        </div>
        <div>
          <dt>CONFIANZA</dt>
          <dd>{Math.round(telemetry.confidence * 100)}%</dd>
        </div>
        <div>
          <dt>PROMEDIO</dt>
          <dd>{averageIntensity.toFixed(1)} dB</dd>
        </div>
        <div>
          <dt>FUENTE</dt>
          <dd>{telemetry.source.toUpperCase()}</dd>
        </div>
        <div>
          <dt>EXTREMO A EXTREMO</dt>
          <dd className={latencyClass}>
            {deliveryLatency == null ? '--' : `${deliveryLatency} ms`}
          </dd>
        </div>
        <div>
          <dt>REALTIME → CANVAS</dt>
          <dd className={renderLatencyMs != null && renderLatencyMs <= 17 ? 'latency-good' : ''}>
            {renderLatencyMs == null ? '--' : `${renderLatencyMs} ms`}
          </dd>
        </div>
      </dl>
    </aside>
  )
}
