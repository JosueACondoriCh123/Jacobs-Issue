import App from '../App'
import { useEchoStore, ZONE_PROFILES, type ZoneMode } from '../shell/store'

/**
 * Pantalla 1 — HUD táctico.
 *
 * Monta el HUD existente sin modificarlo: `App.tsx` es de Dev 1 y sigue siendo
 * suyo. Esta pantalla solo le añade encima el selector de zona, que es lo nuevo
 * que pedía la especificación.
 */
export function TacticalHud() {
  const { zone, setZone, telemetry, status, isRunning } = useEchoStore()
  const profile = ZONE_PROFILES[zone]

  return (
    <div className="evx-hud-screen">
      <section className="evx-zone-bar">
        <div className="evx-zone-switch" role="group" aria-label="Perfil de zona activa">
          {(Object.keys(ZONE_PROFILES) as ZoneMode[]).map((z) => (
            <button
              key={z}
              type="button"
              className={`evx-zone-btn ${z === zone ? 'is-active' : ''}`}
              onClick={() => setZone(z)}
              aria-pressed={z === zone}
            >
              {ZONE_PROFILES[z].label}
            </button>
          ))}
        </div>

        <p className="evx-zone-desc">{profile.description}</p>

        <div className="evx-zone-metrics">
          <span>
            Umbral <strong>+{profile.triggerDb} dB</strong> sobre el suelo
          </span>
          {telemetry ? (
            <span>
              Dispara a partir de{' '}
              <strong>{(telemetry.noiseFloorDb + profile.triggerDb).toFixed(1)} dB(A)</strong>
            </span>
          ) : (
            <span className="evx-muted">Sin captura activa</span>
          )}
        </div>
      </section>

      {isRunning && status.active && !status.stereo ? (
        <p className="evx-warn-box">
          {status.warnings[0] ??
            'Sin estéreo utilizable: el vector direccional del HUD es orientativo, no una medida.'}
        </p>
      ) : null}

      <div className="evx-hud-host">
        <App />
      </div>
    </div>
  )
}
