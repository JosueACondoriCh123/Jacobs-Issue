import { ErrorBoundary } from './ErrorBoundary'
import { Sidebar, NAV_ITEMS } from './Sidebar'
import { useRoute } from './router'
import { useEchoStore } from './store'
import { TacticalHud } from '../screens/TacticalHud'
import { ForensicsLab } from '../screens/ForensicsLab'
import { SensorMesh } from '../screens/SensorMesh'
import { SoundStudio } from '../screens/SoundStudio'
import { SafetyTree } from '../screens/SafetyTree'
import { Dosimetry } from '../screens/Dosimetry'
import './shell.css'
import './responsive.css'


function Screens() {
  const route = useRoute()
  const store = useEchoStore()
  const item = NAV_ITEMS.find((n) => n.route === route) ?? NAV_ITEMS[0]

  return (
    <div className="evx-os">
      <Sidebar
        active={route}
        risk={store.telemetry?.risk ?? 'NORMAL'}
        connection={store.isRunning ? 'CAPTURANDO' : 'EN ESPERA'}
        unreviewed={store.unreviewed}
      />

      <div className="evx-main">
        <header className="evx-topbar">
          <div className="evx-crumb">
            <span className="evx-crumb-glyph" aria-hidden="true">
              {item.glyph}
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </span>
          </div>

          <CaptureControl />
        </header>

        <div className="evx-screen" hidden={route !== '/safety'}><ErrorBoundary screen="/safety"><SafetyTree /></ErrorBoundary></div>
        <div className="evx-screen" key={route} hidden={route === '/safety'}>
          <ErrorBoundary screen={route}>
            {route === '/hud' ? <TacticalHud /> : null}
            {route === '/forensics' ? <ForensicsLab /> : null}
            {route === '/mesh' ? <SensorMesh /> : null}
            {route === '/studio' ? <SoundStudio /> : null}

            {route === '/dosimetry' ? <Dosimetry /> : null}
          </ErrorBoundary>
        </div>
      </div>

    </div>
  )
}

/**
 * Control único de micrófono, en la barra superior.
 *
 * Está aquí y no dentro de cada pantalla porque la captura es global: si el
 * usuario arranca el micrófono en el HUD y se va a Dosimetría, la medición debe
 * continuar. Cortarla al cambiar de vista dejaría huecos en el historial.
 */
function CaptureControl() {
  const { isRunning, start, stop, status, error, telemetry, transportName,miniHud,signal,modelState,splOffsetDb,setSplOffsetDb } = useEchoStore()

  return (
    <div className="evx-capture">
      {telemetry ? (
        <div className="evx-live-readout">
          <span className="evx-live-db">{telemetry.db.toFixed(1)}</span>
          <small>dB estimados</small>
          <span className={`evx-live-risk risk-${telemetry.risk.toLowerCase()}`}>
            {telemetry.risk}
          </span>
        </div>
      ) : null}

      {status.active && !status.stereo ? (
        <span className="evx-warn-chip" title={status.warnings.join(' · ')}>
          SIN DIRECCIÓN REAL
        </span>
      ) : null}

      <button type="button" className="evx-ghost-btn" onClick={() => void miniHud.open()}>MINI HUD</button>
      <span className="evx-transport">YAMNet: {modelState} · {signal}</span>
      <details className="evx-calibration"><summary>Calibración de nivel</summary><label>Offset dB <input type="number" min={-140} max={140} value={splOffsetDb} onChange={e => setSplOffsetDb(Number(e.target.value))}/></label><p>Ajusta contra un sonómetro de referencia. El nivel sigue siendo estimado; el suelo de ruido no calibra el micrófono.</p></details>
      <span className="evx-transport" title="Transporte de telemetría">
        {transportName}
      </span>

      <button
        type="button"
        className={`evx-capture-btn ${isRunning ? 'is-live' : ''}`}
        disabled={signal === 'STARTING'}
        onClick={() => (isRunning ? stop() : void start())}
      >
        <span className="evx-capture-dot" aria-hidden="true" />
        {isRunning ? 'DETENER CAPTURA' : 'INICIAR CAPTURA'}
      </button>

      {error ? (
        <span className="evx-error-chip" title={error}>
          {error.slice(0, 48)}
        </span>
      ) : null}
    </div>
  )
}

export default function AppShell() {
  return <Screens />
}
