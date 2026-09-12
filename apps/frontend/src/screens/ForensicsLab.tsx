import { useEffect, useMemo, useRef, useState } from 'react'
import { useEchoStore, type AcousticEvent } from '../shell/store'
import { computeSpectrogram, waveformPeaks, RISK_COLOR } from '../shell/viz'

/**
 * Pantalla 2 — Caja negra acústica.
 *
 * Todo lo que se ve aquí procede de eventos reales capturados en esta sesión: la
 * forma de onda y el espectrograma se calculan sobre el audio que el worklet
 * guardó en el instante del onset. Si no hubo captura, la pantalla lo dice en
 * lugar de dibujar una curva inventada.
 */
export function ForensicsLab() {
  const { events, markReviewed, reportFalsePositive, clearEvents, isRunning } = useEchoStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = useMemo(
    () => events.find((e) => e.id === selectedId) ?? events[0] ?? null,
    [events, selectedId],
  )

  useEffect(() => {
    if (selected && !selected.reviewed) markReviewed(selected.id)
  }, [selected, markReviewed])

  return (
    <div className="evx-forensics">
      <section className="evx-panel evx-timeline-panel">
        <header className="evx-panel-head">
          <h2>LÍNEA DE TIEMPO</h2>
          <div className="evx-panel-actions">
            <span className="evx-count">{events.length} eventos</span>
            {events.length > 0 ? (
              <button type="button" className="evx-ghost-btn" onClick={clearEvents}>
                Vaciar
              </button>
            ) : null}
          </div>
        </header>

        {events.length === 0 ? (
          <EmptyState running={isRunning} />
        ) : (
          <>
            <Timeline events={events} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
            <ul className="evx-event-list">
              {events.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={`evx-event-row ${selected?.id === e.id ? 'is-active' : ''} ${
                      e.falsePositive ? 'is-false' : ''
                    }`}
                    onClick={() => setSelectedId(e.id)}
                  >
                    <span className={`evx-dot risk-${e.risk.toLowerCase()}`} aria-hidden="true" />
                    <span className="evx-ev-time">{new Date(e.at).toLocaleTimeString()}</span>
                    <span className="evx-ev-label">{e.label}</span>
                    <span className="evx-ev-db">{e.decibels.toFixed(1)} dB</span>
                    <span className="evx-ev-az">
                      {e.spatialConfidence > 0.2 ? `${Math.round(e.azimuth)}°` : '—'}
                    </span>
                    {!e.reviewed ? <span className="evx-new-dot" aria-label="sin revisar" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="evx-panel evx-detail-panel">
        {selected ? (
          <EventDetail event={selected} onFalsePositive={() => reportFalsePositive(selected.id)} />
        ) : (
          <p className="evx-muted">Selecciona un evento para analizarlo.</p>
        )}
      </section>
    </div>
  )
}

function EmptyState({ running }: { running: boolean }) {
  return (
    <div className="evx-empty">
      <p className="evx-empty-title">Sin eventos registrados</p>
      <p className="evx-muted">
        {running
          ? 'La captura está activa. Da una palmada o deja sonar algo por encima del umbral y aparecerá aquí.'
          : 'Inicia la captura desde la barra superior para que la caja negra empiece a registrar.'}
      </p>
    </div>
  )
}

/** Barra temporal con un marcador por evento, coloreado por severidad. */
function Timeline({
  events,
  selectedId,
  onSelect,
}: {
  events: AcousticEvent[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { from, span } = useMemo(() => {
    const times = events.map((e) => e.at)
    const max = Math.max(...times)
    const min = Math.min(...times)
    // Un único evento daría span 0 y una división por cero al posicionar.
    return { from: min, span: Math.max(1, max - min) }
  }, [events])

  return (
    <div className="evx-timeline" role="group" aria-label="Marcadores de eventos">
      <div className="evx-timeline-axis" />
      {events.map((e) => {
        const pct = ((e.at - from) / span) * 100
        return (
          <button
            key={e.id}
            type="button"
            className={`evx-marker ${selectedId === e.id ? 'is-active' : ''}`}
            style={{
              left: `${pct}%`,
              background: RISK_COLOR[e.risk],
              height: `${30 + Math.min(60, Math.max(0, e.decibels - 30))}%`,
            }}
            onClick={() => onSelect(e.id)}
            title={`${new Date(e.at).toLocaleTimeString()} · ${e.decibels.toFixed(1)} dB · ${e.risk}`}
            aria-label={`Evento a las ${new Date(e.at).toLocaleTimeString()}`}
          />
        )
      })}
      <div className="evx-timeline-labels">
        <span>{new Date(from).toLocaleTimeString()}</span>
        <span>{new Date(from + span).toLocaleTimeString()}</span>
      </div>
    </div>
  )
}

function EventDetail({
  event,
  onFalsePositive,
}: {
  event: AcousticEvent
  onFalsePositive: () => void
}) {
  return (
    <>
      <header className="evx-panel-head">
        <h2>
          {event.label}
          <span className={`evx-pill risk-${event.risk.toLowerCase()}`}>{event.risk}</span>
        </h2>
        <span className="evx-muted">{new Date(event.at).toLocaleString()}</span>
      </header>

      <dl className="evx-metrics">
        <div>
          <dt>Nivel</dt>
          <dd>{event.decibels.toFixed(1)} dB(A)</dd>
        </div>
        <div>
          <dt>Suelo de ruido</dt>
          <dd>{event.noiseFloorDb.toFixed(1)} dB(A)</dd>
        </div>
        <div>
          <dt>Dirección</dt>
          <dd>
            {event.spatialConfidence > 0.2 ? (
              `${Math.round(event.azimuth)}°`
            ) : (
              <span className="evx-unknown" title="Sin estéreo utilizable en la captura">
                desconocida
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Confianza espacial</dt>
          <dd>{event.spatialConfidence.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Zona</dt>
          <dd>{event.zone}</dd>
        </div>
      </dl>

      {event.pcm ? (
        <>
          <h3 className="evx-sub">FORMA DE ONDA</h3>
          <WaveformCanvas pcm={event.pcm} color={RISK_COLOR[event.risk]} />
          <h3 className="evx-sub">ESPECTROGRAMA</h3>
          <SpectrogramCanvas pcm={event.pcm} sampleRate={16000} />
        </>
      ) : (
        <p className="evx-muted evx-nosignal">
          Sin audio asociado. La instantánea solo se guarda cuando la captura está activa en el
          momento del evento; los eventos restaurados de sesiones anteriores conservan las métricas
          pero no la señal.
        </p>
      )}

      <h3 className="evx-sub">DESGLOSE DEL CLASIFICADOR</h3>
      {event.breakdown.length > 0 ? (
        <ul className="evx-breakdown">
          {event.breakdown.map((b) => (
            <li key={b.label}>
              <span>{b.label}</span>
              <span className="evx-bar">
                <i style={{ width: `${Math.round(b.confidence * 100)}%` }} />
              </span>
              <strong>{Math.round(b.confidence * 100)}%</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="evx-muted">
          El clasificador aún no ha etiquetado este evento. Mientras tanto se conservan nivel y
          dirección, que sí son medidas.
        </p>
      )}

      <div className="evx-detail-actions">
        <button
          type="button"
          className={`evx-danger-btn ${event.falsePositive ? 'is-marked' : ''}`}
          onClick={onFalsePositive}
          disabled={event.falsePositive}
        >
          {event.falsePositive ? 'MARCADO COMO FALSO POSITIVO' : 'REPORTAR FALSO POSITIVO'}
        </button>
        <small className="evx-muted">
          Alimenta el aprendizaje activo del clasificador (endpoint
          <code> /api/v1/feedback/report-misclassification</code>).
        </small>
      </div>
    </>
  )
}

function WaveformCanvas({ pcm, color }: { pcm: Float32Array; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#05070a'
    ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = 'rgba(107, 124, 143, 0.35)'
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()

    const peaks = waveformPeaks(pcm, w)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    peaks.forEach(([min, max], i) => {
      const x = i + 0.5
      ctx.moveTo(x, h / 2 - max * (h / 2) * 0.95)
      ctx.lineTo(x, h / 2 - min * (h / 2) * 0.95)
    })
    ctx.stroke()
  }, [pcm, color])

  return <canvas ref={ref} className="evx-canvas evx-waveform" />
}

function SpectrogramCanvas({ pcm, sampleRate }: { pcm: Float32Array; sampleRate: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const spec = computeSpectrogram(pcm, sampleRate, 512, 128)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const cols = spec.columns.length
    if (cols === 0) return
    const colW = w / cols
    // Solo se pintan los primeros 2/3 del eje: por encima de ~5 kHz la energía
    // de estos eventos es marginal y ocuparía la mitad del gráfico en negro.
    const usableBins = Math.floor(spec.bins * 0.66)

    for (let t = 0; t < cols; t++) {
      const col = spec.columns[t]
      for (let f = 0; f < usableBins; f++) {
        const v = col[f]
        if (v <= 0.02) continue
        const y = h - (f / usableBins) * h
        ctx.fillStyle = heatColor(v)
        ctx.fillRect(t * colW, y - h / usableBins, Math.ceil(colW), Math.ceil(h / usableBins) + 1)
      }
    }
  }, [pcm, sampleRate])

  return (
    <div className="evx-spec-wrap">
      <canvas ref={ref} className="evx-canvas evx-spectrogram" />
      <div className="evx-spec-axis">
        <span>5 kHz</span>
        <span>2.5 kHz</span>
        <span>0</span>
      </div>
    </div>
  )
}

/** Rampa oscuro → cian → verde → ámbar → rojo, legible sobre fondo negro. */
function heatColor(v: number): string {
  if (v < 0.35) return `rgba(0, 90, 120, ${v * 2})`
  if (v < 0.55) return `rgba(0, 240, 255, ${v})`
  if (v < 0.72) return `rgba(0, 255, 136, ${v})`
  if (v < 0.85) return `rgba(255, 176, 32, ${v})`
  return `rgba(255, 30, 86, ${v})`
}
