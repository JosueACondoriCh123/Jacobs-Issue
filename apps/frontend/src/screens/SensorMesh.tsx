import { useEffect, useMemo, useState } from 'react'
import { useEchoStore } from '../shell/store'
import { RISK_COLOR } from '../shell/viz'

/**
 * Pantalla 3 — Malla de sensores y zonificación espacial.
 *
 * El plano es editable por el usuario: las zonas de una casa no se pueden
 * adivinar, y un plano fijo de ejemplo sería decorado, no una herramienta.
 *
 * Los nodos que se ven son reales: este equipo siempre, y cualquier otro que
 * esté publicando en el canal `hud-telemetry`. No se inventan dispositivos para
 * que la pantalla parezca más poblada de lo que está.
 */

const ZONES_KEY = 'echovision.meshZones.v1'
/** Un nodo se considera caído si no emite en 30 s (el heartbeat acordado). */
const HEARTBEAT_TIMEOUT_MS = 30_000

interface Zone {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  deviceId: string | null
}

const DEFAULT_ZONES: Zone[] = [
  { id: 'z1', name: 'Entrada', x: 4, y: 4, w: 30, h: 26, deviceId: null },
  { id: 'z2', name: 'Cocina', x: 38, y: 4, w: 34, h: 26, deviceId: null },
  { id: 'z3', name: 'Salón', x: 4, y: 34, w: 44, h: 32, deviceId: null },
  { id: 'z4', name: 'Dormitorio', x: 52, y: 34, w: 44, h: 32, deviceId: null },
]

function loadZones(): Zone[] {
  try {
    const raw = localStorage.getItem(ZONES_KEY)
    return raw ? (JSON.parse(raw) as Zone[]) : DEFAULT_ZONES
  } catch {
    return DEFAULT_ZONES
  }
}

export function SensorMesh() {
  const { nodes, telemetry, isRunning, status } = useEchoStore()
  const [zones, setZones] = useState<Zone[]>(loadZones)
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  // Reloj propio: sin él, un nodo que deja de emitir se quedaría dibujado como
  // "vivo" para siempre, porque nada volvería a renderizar la pantalla.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 2000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(ZONES_KEY, JSON.stringify(zones))
    } catch {
      /* sin almacenamiento */
    }
  }, [zones])

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.deviceId, n])), [nodes])

  const renameZone = (id: string) => {
    const zone = zones.find((z) => z.id === id)
    if (!zone) return
    const name = window.prompt('Nombre de la zona', zone.name)
    if (name && name.trim()) {
      setZones((prev) => prev.map((z) => (z.id === id ? { ...z, name: name.trim() } : z)))
    }
  }

  const assign = (zoneId: string, deviceId: string | null) => {
    setZones((prev) =>
      prev.map((z) =>
        z.id === zoneId ? { ...z, deviceId } : z.deviceId === deviceId ? { ...z, deviceId: null } : z,
      ),
    )
  }

  return (
    <div className="evx-mesh">
      <section className="evx-panel evx-floorplan-panel">
        <header className="evx-panel-head">
          <h2>PLANO DE ZONAS</h2>
          <div className="evx-panel-actions">
            <button
              type="button"
              className="evx-ghost-btn"
              onClick={() =>
                setZones((prev) => [
                  ...prev,
                  {
                    id: `z${Date.now().toString(36)}`,
                    name: 'Nueva zona',
                    x: 4,
                    y: 70,
                    w: 28,
                    h: 24,
                    deviceId: null,
                  },
                ])
              }
            >
              + Zona
            </button>
            <button type="button" className="evx-ghost-btn" onClick={() => setZones(DEFAULT_ZONES)}>
              Restablecer
            </button>
          </div>
        </header>

        <div className="evx-floorplan">
          {zones.map((z) => {
            const node = z.deviceId ? nodesById.get(z.deviceId) : null
            const alive = node ? now - node.lastSeen < HEARTBEAT_TIMEOUT_MS : false
            const risk = node && alive ? node.risk : 'NORMAL'
            return (
              <button
                key={z.id}
                type="button"
                className={`evx-zone-box ${selected === z.id ? 'is-selected' : ''} ${
                  node && alive ? 'has-node' : ''
                }`}
                style={{
                  left: `${z.x}%`,
                  top: `${z.y}%`,
                  width: `${z.w}%`,
                  height: `${z.h}%`,
                  borderColor: node && alive ? RISK_COLOR[risk] : undefined,
                }}
                onClick={() => setSelected(z.id)}
                onDoubleClick={() => renameZone(z.id)}
                title="Doble clic para renombrar"
              >
                <span className="evx-zone-name">{z.name}</span>
                {node && alive ? (
                  <>
                    <span className="evx-zone-db" style={{ color: RISK_COLOR[risk] }}>
                      {node.decibels.toFixed(0)} dB
                    </span>
                    <span
                      className="evx-node-pulse"
                      style={{ background: RISK_COLOR[risk] }}
                      aria-hidden="true"
                    />
                  </>
                ) : (
                  <span className="evx-zone-empty">sin sensor</span>
                )}
              </button>
            )
          })}
        </div>

        <p className="evx-muted evx-note">
          Clic para seleccionar, doble clic para renombrar. El plano se guarda en este navegador.
        </p>
      </section>

      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>NODOS SENSORES</h2>
          <span className="evx-count">{nodes.length}</span>
        </header>

        {nodes.length === 0 ? (
          <p className="evx-muted">
            Ningún nodo emitiendo. Inicia la captura para que este equipo aparezca como sensor.
          </p>
        ) : (
          <ul className="evx-node-list">
            {nodes.map((n) => {
              const alive = now - n.lastSeen < HEARTBEAT_TIMEOUT_MS
              const zone = zones.find((z) => z.deviceId === n.deviceId)
              return (
                <li key={n.deviceId} className={alive ? '' : 'is-stale'}>
                  <div className="evx-node-head">
                    <span
                      className={`evx-node-dot ${alive ? 'is-alive' : ''}`}
                      style={{ background: alive ? RISK_COLOR[n.risk] : undefined }}
                      aria-hidden="true"
                    />
                    <strong>{n.isSelf ? 'Este equipo' : n.deviceId}</strong>
                    <span className="evx-muted">{alive ? 'en línea' : 'sin señal'}</span>
                  </div>
                  <dl className="evx-node-metrics">
                    <div>
                      <dt>Ruido de fondo</dt>
                      <dd>{n.decibels.toFixed(1)} dB(A)</dd>
                    </div>
                    <div>
                      <dt>Último pulso</dt>
                      <dd>{alive ? `hace ${Math.round((now - n.lastSeen) / 1000)} s` : '—'}</dd>
                    </div>
                    <div>
                      <dt>Canales</dt>
                      <dd>
                        {n.isSelf
                          ? status.stereo
                            ? '2 (estéreo)'
                            : '1 (sin dirección)'
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                  <label className="evx-assign">
                    <span>Zona</span>
                    <select
                      value={zone?.id ?? ''}
                      onChange={(e) => assign(e.target.value, e.target.value ? n.deviceId : null)}
                    >
                      <option value="">Sin asignar</option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        <p className="evx-muted evx-note">
          Para que aparezcan móviles u otros equipos como nodos independientes hace falta que
          publiquen en el canal <code>hud-telemetry</code> y se registren en{' '}
          <code>sensor_devices</code>, la tabla que ya existe en el backend. Abrir esta misma
          aplicación en otro dispositivo de la red basta para verlo aquí.
        </p>
        {isRunning && telemetry ? null : (
          <p className="evx-muted">La captura está detenida: no hay pulso que mostrar.</p>
        )}
      </section>
    </div>
  )
}
