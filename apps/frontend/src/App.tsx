import { createPortal } from 'react-dom'
import { AuthControl } from './components/AuthControl'
import { EventLog } from './components/EventLog'
import { HudCanvas } from './components/HudCanvas'
import { MiniHud } from './components/MiniHud'
import { TelemetryPanel } from './components/TelemetryPanel'
import { ThreeBackdrop } from './components/ThreeBackdrop'
import { useAuth } from './hooks/useAuth'
import { useHudTelemetry } from './hooks/useHudTelemetry'
import { useMiniHudWindow } from './hooks/useMiniHudWindow'

const statusLabel = {
  CONNECTING: 'SINCRONIZANDO',
  LIVE: 'ENLACE REALTIME',
  ERROR: 'ENLACE DEGRADADO',
} as const

function App() {
  const auth = useAuth()
  const hud = useHudTelemetry()
  const miniHud = useMiniHudWindow()
  const isCritical = hud.telemetry.risk === 'CRITICAL'
  const isMiniPreview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('mini-preview')

  if (isMiniPreview) {
    return (
      <div className="mini-preview-stage">
        <MiniHud telemetry={hud.telemetry} isFloating={false} onClose={() => window.close()} />
      </div>
    )
  }

  return (
    <main className={`app-shell ${isCritical ? 'critical-mode' : ''}`}>
      <ThreeBackdrop />
      <div className="noise-layer" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#main-hud" aria-label="EchoVision inicio">
          <span className="brand-glyph" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>ECHO</strong>VISION
            <small>PHONOSPATIAL SYSTEMS</small>
          </span>
        </a>

        <div className="system-status" role="status">
          <span className={`status-light state-${hud.connection.toLowerCase()}`} />
          <span>{statusLabel[hud.connection]}</span>
          <small>CH / HUD-TELEMETRY</small>
        </div>

        <div className="topbar-actions">
          <button
            className={`mini-hud-launcher ${miniHud.isOpen ? 'is-active' : ''}`}
            type="button"
            onClick={() => void miniHud.open()}
            aria-label="Abrir Mini HUD flotante"
            title={miniHud.isSupported ? 'Abrir ventana siempre visible' : 'Abrir vista compacta'}
          >
            <span className="mini-launcher-wave" aria-hidden="true"><i /><i /><i /><i /></span>
            <span>MINI HUD</span>
          </button>
          <AuthControl
            user={auth.user}
            loading={auth.isLoading}
            configured={auth.isConfigured}
            onSignIn={() => void auth.signInWithGoogle()}
            onSignOut={() => void auth.signOut()}
          />
        </div>
      </header>

      <section className="workspace" id="main-hud">
        <TelemetryPanel
          telemetry={hud.telemetry}
          averageIntensity={hud.averageIntensity}
          renderLatencyMs={hud.renderLatencyMs}
        />

        <section className="hud-stage" aria-labelledby="event-heading">
          <div className="stage-index" aria-hidden="true">EV // 360</div>
          <div className={`risk-pill risk-pill-${hud.telemetry.risk.toLowerCase()}`}>
            {hud.telemetry.risk}
          </div>
          <HudCanvas telemetry={hud.telemetry} />

          <div className="event-hero">
            <span>FUENTE IDENTIFICADA</span>
            <h1 id="event-heading">{hud.telemetry.label}</h1>
            <p>
              Vector <strong>{Math.round(hud.telemetry.azimuth)}°</strong>
              <i aria-hidden="true" />
              Intensidad <strong>{hud.telemetry.intensity.toFixed(1)} dB</strong>
            </p>
          </div>

          <div className="orientation-label orientation-north">NORTE</div>
          <div className="orientation-label orientation-south">SUR</div>
        </section>

        <EventLog history={hud.history} />
      </section>

      <footer className="control-deck">
        <div className="legend" aria-label="Leyenda de riesgo">
          <span><i className="risk-normal" /> Normal</span>
          <span><i className="risk-advisory" /> Atención</span>
          <span><i className="risk-critical" /> Crítico</span>
        </div>

        <div className="mission-copy">
          <strong>VER EL SONIDO.</strong>
          <span>RECUPERAR EL ESPACIO.</span>
        </div>

        <div className="live-contract">
          <span>
            <strong>LIVE ONLY</strong>
            <small>{hud.isPrivateChannel ? 'Canal privado autorizado' : 'Canal público de hackathon'}</small>
          </span>
          <i className={`status-light state-${hud.connection.toLowerCase()}`} aria-hidden="true" />
        </div>
      </footer>

      {auth.error ? <div className="auth-toast" role="alert">{auth.error}</div> : null}
      {hud.error ? <div className="realtime-toast" role="alert">{hud.error}</div> : null}
      {miniHud.error ? <div className="mini-hud-note" role="status">Vista compacta activada: {miniHud.error}</div> : null}
      {miniHud.fallbackOpen ? (
        <div className="mini-hud-fallback">
          <MiniHud telemetry={hud.telemetry} isFloating={false} onClose={miniHud.close} />
        </div>
      ) : null}
      {miniHud.host
        ? createPortal(
            <MiniHud telemetry={hud.telemetry} isFloating onClose={miniHud.close} />,
            miniHud.host,
          )
        : null}
      <p className="sr-only" aria-live="assertive">
        {isCritical
          ? `Alerta crítica: ${hud.telemetry.label}, dirección ${Math.round(hud.telemetry.azimuth)} grados.`
          : ''}
      </p>
    </main>
  )
}

export default App
