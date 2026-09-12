import { useMemo } from 'react'
import { useEchoStore, type DoseSample } from '../shell/store'
import { RISK_COLOR } from '../shell/viz'

/**
 * Pantalla 6 — Dosimetría y salud auditiva.
 *
 * La dosis se calcula con el criterio NIOSH/OMS: 85 dB(A) durante 8 h equivalen
 * al 100 % de la dosis diaria, con tasa de intercambio de 3 dB (cada 3 dB de
 * más, el tiempo permitido se reduce a la mitad). Se usa NIOSH y no OSHA (5 dB)
 * porque es el criterio que recomienda la OMS para protección auditiva, y es el
 * más conservador de los dos — en un producto para personas con hipoacusia
 * parcial, proteger la audición residual pesa más que ser permisivo.
 *
 * Todos los números salen de mediciones reales de esta sesión. La lectura de dB
 * es *estimada* (ver el módulo de audio: sin micrófono calibrado no hay SPL
 * absoluto), y la pantalla lo dice, porque presentar una dosis de exposición con
 * falsa precisión sería un problema de salud, no solo de rigor.
 */

const CRITERION_DB = 85
const CRITERION_HOURS = 8
const EXCHANGE_RATE_DB = 3

/** Horas permitidas a un nivel dado antes de alcanzar el 100 % de dosis. */
export function allowedHours(db: number): number {
  return CRITERION_HOURS / 2 ** ((db - CRITERION_DB) / EXCHANGE_RATE_DB)
}

/**
 * Dosis acumulada en porcentaje. Cada muestra representa 1 s de exposición.
 * Por debajo de 75 dB(A) no se acumula: NIOSH no considera lesivos esos niveles
 * y contarlos inflaría la cifra sin fundamento.
 */
export function computeDose(samples: DoseSample[]): number {
  let dose = 0
  for (const s of samples) {
    if (s.db < 75) continue
    const hours = allowedHours(s.db)
    if (hours <= 0) continue
    dose += (1 / 3600 / hours) * 100
  }
  return dose
}

export function Dosimetry() {
  const { doseSamples, isRunning } = useEchoStore()

  const today = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return doseSamples.filter((s) => s.at >= start.getTime())
  }, [doseSamples])

  const dose = useMemo(() => computeDose(today), [today])
  const peak = useMemo(() => (today.length ? Math.max(...today.map((s) => s.db)) : 0), [today])
  const avg = useMemo(
    () => (today.length ? today.reduce((s, x) => s + x.db, 0) / today.length : 0),
    [today],
  )
  const exposedSeconds = useMemo(() => today.filter((s) => s.db >= 85).length, [today])

  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, () => ({ peak: 0, sum: 0, n: 0 }))
    for (const s of today) {
      const h = new Date(s.at).getHours()
      const b = buckets[h]
      b.n++
      b.sum += s.db
      if (s.db > b.peak) b.peak = s.db
    }
    return buckets
  }, [today])

  const status =
    dose >= 100 ? 'SOBREEXPOSICIÓN' : dose >= 50 ? 'VIGILANCIA' : 'DENTRO DE LÍMITES'
  const statusRisk = dose >= 100 ? 'CRITICAL' : dose >= 50 ? 'ADVISORY' : 'NORMAL'

  return (
    <div className="evx-dosimetry">
      <section className="evx-panel evx-dose-hero">
        <header className="evx-panel-head">
          <h2>DOSIS ACÚSTICA DIARIA</h2>
          <span className={`evx-pill risk-${statusRisk.toLowerCase()}`}>{status}</span>
        </header>

        <div className="evx-dose-gauge">
          <div className="evx-dose-value" style={{ color: RISK_COLOR[statusRisk] }}>
            {dose < 1 ? dose.toFixed(2) : dose.toFixed(1)}
            <small>%</small>
          </div>
          <div className="evx-dose-bar">
            <i
              style={{
                width: `${Math.min(100, dose)}%`,
                background: RISK_COLOR[statusRisk],
              }}
            />
            <span className="evx-dose-limit" style={{ left: '100%' }} />
          </div>
          <div className="evx-dose-scale">
            <span>0 %</span>
            <span>50 %</span>
            <span>100 % · límite diario</span>
          </div>
        </div>

        <dl className="evx-metrics">
          <div>
            <dt>Pico del día</dt>
            <dd>{peak ? `${peak.toFixed(1)} dB(A)` : '—'}</dd>
          </div>
          <div>
            <dt>Nivel medio</dt>
            <dd>{avg ? `${avg.toFixed(1)} dB(A)` : '—'}</dd>
          </div>
          <div>
            <dt>Tiempo ≥ 85 dB</dt>
            <dd>{formatDuration(exposedSeconds)}</dd>
          </div>
          <div>
            <dt>Tiempo medido</dt>
            <dd>{formatDuration(today.length)}</dd>
          </div>
        </dl>

        {!isRunning && today.length === 0 ? (
          <p className="evx-muted">
            Sin mediciones hoy. Inicia la captura para empezar a integrar la exposición.
          </p>
        ) : null}
      </section>

      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>DISTRIBUCIÓN HORARIA</h2>
          <span className="evx-muted">pico por hora</span>
        </header>
        <div className="evx-hourly">
          {hourly.map((b, h) => {
            const height = b.peak ? Math.max(3, ((b.peak - 30) / 80) * 100) : 0
            const risk = b.peak >= 85 ? 'CRITICAL' : b.peak >= 70 ? 'ADVISORY' : 'NORMAL'
            return (
              <div key={h} className="evx-hour-col" title={
                b.n ? `${h}:00 — pico ${b.peak.toFixed(1)} dB, media ${(b.sum / b.n).toFixed(1)} dB` : `${h}:00 — sin datos`
              }>
                <i style={{ height: `${height}%`, background: b.peak ? RISK_COLOR[risk] : 'transparent' }} />
                <span>{h % 6 === 0 ? h : ''}</span>
              </div>
            )
          })}
        </div>
        <div className="evx-legend-line">
          <span><i style={{ background: RISK_COLOR.NORMAL }} /> &lt; 70 dB</span>
          <span><i style={{ background: RISK_COLOR.ADVISORY }} /> 70–85 dB</span>
          <span><i style={{ background: RISK_COLOR.CRITICAL }} /> ≥ 85 dB lesivo</span>
        </div>
      </section>

      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>TIEMPO SEGURO POR NIVEL</h2>
          <span className="evx-muted">criterio NIOSH · 85 dB / 8 h · 3 dB</span>
        </header>
        <ul className="evx-safe-table">
          {[80, 85, 88, 91, 94, 97, 100, 103].map((db) => {
            const h = allowedHours(db)
            const reached = peak >= db
            return (
              <li key={db} className={reached ? 'is-reached' : ''}>
                <span>{db} dB(A)</span>
                <span className="evx-bar">
                  <i style={{ width: `${Math.min(100, (h / 8) * 100)}%` }} />
                </span>
                <strong>{formatHours(h)}</strong>
              </li>
            )
          })}
        </ul>
        <p className="evx-muted evx-note">
          Las filas marcadas son niveles que ya se han alcanzado hoy. Nota importante: la lectura de
          decibelios es <strong>estimada</strong> y depende de la calibración del micrófono. Sirve
          para detectar tendencias y entornos peligrosos, no como dosímetro certificado ni como
          base para decisiones médicas.
        </p>
      </section>
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  if (seconds < 60) return `${seconds} s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

function formatHours(h: number): string {
  if (h >= 1) return `${h.toFixed(1)} h`
  const m = h * 60
  if (m >= 1) return `${m.toFixed(0)} min`
  return `${(m * 60).toFixed(0)} s`
}
