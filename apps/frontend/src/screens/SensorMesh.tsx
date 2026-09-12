import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEchoStore } from '../shell/store'
import { RISK_COLOR } from '../shell/viz'
import { SyncBadge } from '../shell/SyncBadge'
import {
  listDevices,
  registerDevice,
  sendHeartbeat,
  type RemoteDevice,
  type SyncState,
} from '../shell/backend'

/**
 * Pantalla 3 — Malla de sensores y zonificación espacial.
 *
 * Esta es la única de las tres pantallas de gestión que sincroniza de verdad sin
 * iniciar sesión: el RLS de `sensor_devices` acepta filas con `user_id` nulo. Los
 * nodos que se ven aquí están realmente en la base de datos, y cualquier otro
 * dispositivo que abra la aplicación aparecerá en esta lista.
 *
 * El plano de zonas sigue siendo local: `spatial_zones` sí exige sesión, y se
 * indica sin rodeos en vez de aparentar que se guardó en el servidor.
 */

const ZONES_KEY = 'jacobs-issue.meshZones.v1'
const DEVICE_ID_KEY = 'jacobs-issue.device_id'
/** Contrato del equipo: un nodo sin pulso en 30 s se considera caído. */
const HEARTBEAT_TIMEOUT_MS = 30_000
const HEARTBEAT_INTERVAL_MS = 30_000
const REFRESH_MS = 10_000

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

function ownDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY)
    if (stored) return stored
    const fresh = `hud-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(DEVICE_ID_KEY, fresh)
    return fresh
  } catch {
    return 'hud-primary'
  }
}

export function SensorMesh() {
  const { telemetry, isRunning, status } = useEchoStore()
  const [zones, setZones] = useState<Zone[]>(loadZones)
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [remote, setRemote] = useState<RemoteDevice[]>([])
  const [sync, setSync] = useState<{ state: SyncState; reason?: string }>({ state: 'local' })

  const selfId = useMemo(ownDeviceId, [])

  const refresh = useCallback(async () => {
    const res = await listDevices()
    setSync({ state: res.state, reason: res.reason })
    if (res.state === 'synced') setRemote(res.data)
  }, [])

  // Alta del nodo: se registra al entrar, no al empezar a capturar, para que el
  // equipo aparezca en la malla aunque todavía no haya micrófono activo.
  useEffect(() => {
    void (async () => {
      await registerDevice(selfId, `Jacobs Issue HUD (${selfId})`, 'Sin asignar')
      await refresh()
    })()
  }, [selfId, refresh])

  // Pulso de vida cada 30 s, el intervalo acordado por el equipo.
  useEffect(() => {
    const beat = window.setInterval(() => void sendHeartbeat(selfId), HEARTBEAT_INTERVAL_MS)
    const poll = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => {
      window.clearInterval(beat)
      window.clearInterval(poll)
    }
  }, [selfId, refresh])

  // Reloj propio: sin él, un nodo que deja de emitir seguiría dibujado como vivo.
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

  /**
   * El nivel en dB de ESTE equipo viene de la telemetría en vivo, no de la base
   * de datos: `sensor_devices` guarda identidad y pulso, no nivel instantáneo.
   * Los demás nodos solo muestran su último pulso, que es lo que hay de ellos.
   */
  const nodes = useMemo(() => {
    return remote.map((d) => {
      const isSelf = d.id === selfId
      const lastSeen = new Date(d.last_heartbeat).getTime()
      return {
        id: d.id,
        name: isSelf ? 'Este equipo' : d.device_name,
        room: d.device_room,
        isSelf,
        lastSeen: isSelf ? Date.now() : lastSeen,
        decibels: isSelf && telemetry ? telemetry.db : null,
        risk: isSelf && telemetry ? telemetry.risk : 'NORMAL',
        claimed: d.user_id !== null,
      }
    })
  }, [remote, selfId, telemetry])

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const renameZone = (id: string) => {
    const zone = zones.find((z) => z.id === id)
    if (!zone) return
    const name = window.prompt('Nombre de la zona', zone.name)
    if (name && name.trim()) {
      setZones((prev) => prev.map((z) => (z.id === id ? { ...z, name: name.trim() } : z)))
    }
  }

  const assign = async (zoneId: string, deviceId: string | null) => {
    setZones((prev) =>
      prev.map((z) =>
        z.id === zoneId ? { ...z, deviceId } : z.deviceId === deviceId ? { ...z, deviceId: null } : z,
      ),
    )
    // La sala del nodo sí se propaga al backend: es un campo de `sensor_devices`.
    const zone = zones.find((z) => z.id === zoneId)
    if (deviceId && zone) {
      const node = nodesById.get(deviceId)
      await registerDevice(deviceId, node?.name ?? deviceId, zone.name)
      await refresh()
    }
  }

  return (
    <div className="evx-mesh">
      <section className="evx-panel evx-floorplan-panel">
        <header className="evx-panel-head">
          <h2>PLANO DE ZONAS</h2>
          <div className="evx-panel-actions">
            <SyncBadge
              state="local"
              reason="spatial_zones exige sesión iniciada; el plano se guarda en este navegador."
            />
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
                      {node.decibels != null ? `${node.decibels.toFixed(0)} dB` : 'en línea'}
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
          Clic para seleccionar, doble clic para renombrar. Asignar un nodo a una zona sí viaja al
          backend: la sala es un campo de <code>sensor_devices</code>. La geometría del plano no.
        </p>
      </section>

      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>NODOS SENSORES</h2>
          <div className="evx-panel-actions">
            <SyncBadge state={sync.state} reason={sync.reason} />
            <span className="evx-count">{nodes.length}</span>
            <button type="button" className="evx-ghost-btn" onClick={() => void refresh()}>
              Refrescar
            </button>
          </div>
        </header>

        {sync.state === 'error' ? (
          <p className="evx-warn-box">No se pudo leer la malla del backend: {sync.reason}</p>
        ) : null}

        {nodes.length === 0 ? (
          <p className="evx-muted">
            Sin nodos registrados en <code>sensor_devices</code>.
          </p>
        ) : (
          <ul className="evx-node-list">
            {nodes.map((n) => {
              const alive = now - n.lastSeen < HEARTBEAT_TIMEOUT_MS
              const zone = zones.find((z) => z.deviceId === n.id)
              return (
                <li key={n.id} className={alive ? '' : 'is-stale'}>
                  <div className="evx-node-head">
                    <span
                      className={`evx-node-dot ${alive ? 'is-alive' : ''}`}
                      style={{ background: alive ? RISK_COLOR[n.risk] : undefined }}
                      aria-hidden="true"
                    />
                    <strong>{n.name}</strong>
                    <span className="evx-muted">{alive ? 'en línea' : 'sin señal'}</span>
                    {n.isSelf ? <span className="evx-pill risk-normal">ESTE EQUIPO</span> : null}
                  </div>
                  <dl className="evx-node-metrics">
                    <div>
                      <dt>Sala registrada</dt>
                      <dd>{n.room}</dd>
                    </div>
                    <div>
                      <dt>Ruido de fondo</dt>
                      <dd>
                        {n.decibels != null ? (
                          `${n.decibels.toFixed(1)} dB(A)`
                        ) : (
                          <span className="evx-muted" title="Solo se conoce el nivel del equipo local">
                            —
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Último pulso</dt>
                      <dd>
                        {alive
                          ? `hace ${Math.max(0, Math.round((now - n.lastSeen) / 1000))} s`
                          : new Date(n.lastSeen).toLocaleTimeString()}
                      </dd>
                    </div>
                    <div>
                      <dt>Canales</dt>
                      <dd>
                        {n.isSelf ? (status.stereo ? '2 (estéreo)' : '1 (sin dirección)') : '—'}
                      </dd>
                    </div>
                  </dl>
                  <label className="evx-assign">
                    <span>Zona</span>
                    <select
                      value={zone?.id ?? ''}
                      onChange={(e) => void assign(e.target.value, e.target.value ? n.id : null)}
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
          Esta lista sale de <code>sensor_devices</code>, no de la sesión: abre la aplicación en el
          móvil y aparecerá aquí en menos de {REFRESH_MS / 1000} s. El nivel en dB solo se conoce del
          equipo local, porque la tabla guarda identidad y pulso, no telemetría instantánea.
          {!isRunning ? ' La captura está detenida: este nodo figura en línea pero sin nivel.' : ''}
        </p>
      </section>
    </div>
  )
}
