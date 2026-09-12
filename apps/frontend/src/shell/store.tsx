import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AudioCaptureEngine } from '../audio/captureEngine'
import { TelemetryPublisher } from '../audio/telemetryPublisher'
import type { CaptureStatus, DspSnapshot, DspTelemetry } from '../audio/types'
import { UNCLASSIFIED } from '../audio/types'
import type { RiskLevel } from '../types/hud'

/**
 * Estado compartido por las seis pantallas.
 *
 * Una sola instancia del motor de audio para toda la aplicación: seis pantallas
 * pidiendo el micrófono por su cuenta abrirían seis AudioContext y seis flujos
 * de captura. El micrófono se arranca una vez y los datos se reparten.
 *
 * Todo lo que se ve en Forensics, Mesh y Dosimetría sale de eventos reales de
 * esta sesión. Si no hay backend, las pantallas siguen teniendo contenido; si lo
 * hay, se sincroniza. Ninguna pantalla inventa datos para parecer llena.
 */

export type ZoneMode = 'HOME' | 'STREET' | 'OFFICE'

export interface ZoneProfile {
  id: ZoneMode
  label: string
  description: string
  /** dB sobre el suelo de ruido para considerar un evento. */
  triggerDb: number
  /** Offset aplicado a los umbrales de riesgo. */
  riskOffsetDb: number
}

/**
 * Los perfiles no son decorativos: cambian el umbral real del detector de onsets.
 * En la calle el suelo de ruido es alto y un umbral bajo dispararía sin parar; en
 * casa interesa enterarse de un timbre que apenas supera el silencio.
 */
export const ZONE_PROFILES: Record<ZoneMode, ZoneProfile> = {
  HOME: {
    id: 'HOME',
    label: 'MODO HOGAR',
    description: 'Ambiente silencioso. Sensibilidad alta: timbres, electrodomésticos, llanto.',
    triggerDb: 9,
    riskOffsetDb: 0,
  },
  STREET: {
    id: 'STREET',
    label: 'MODO CALLE',
    description: 'Ambiente ruidoso. Sensibilidad baja: sirenas, cláxones, vehículos.',
    triggerDb: 15,
    riskOffsetDb: 5,
  },
  OFFICE: {
    id: 'OFFICE',
    label: 'MODO OFICINA',
    description: 'Ambiente medio. Prioriza voz, alarmas y avisos sobre el rumor de fondo.',
    triggerDb: 12,
    riskOffsetDb: 2,
  },
}

export interface AcousticEvent {
  id: string
  at: number
  label: string
  risk: RiskLevel
  decibels: number
  azimuth: number
  spatialConfidence: number
  noiseFloorDb: number
  zone: ZoneMode
  /** Audio del instante del evento (0,96 s a 16 kHz). Ausente si no hubo captura. */
  pcm: Float32Array | null
  /** Desglose probabilístico del clasificador, cuando Dev 4 lo aporta. */
  breakdown: Array<{ label: string; confidence: number }>
  reviewed: boolean
  falsePositive: boolean
}

export interface MeshNode {
  deviceId: string
  room: string
  lastSeen: number
  decibels: number
  risk: RiskLevel
  isSelf: boolean
}

/** Muestra de exposición para el cálculo de dosis. */
export interface DoseSample {
  at: number
  db: number
}

interface StoreValue {
  engine: AudioCaptureEngine
  status: CaptureStatus
  telemetry: DspTelemetry | null
  isRunning: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => void

  zone: ZoneMode
  setZone: (z: ZoneMode) => void

  events: AcousticEvent[]
  unreviewed: number
  markReviewed: (id: string) => void
  reportFalsePositive: (id: string) => void
  clearEvents: () => void

  nodes: MeshNode[]
  doseSamples: DoseSample[]

  publisher: TelemetryPublisher | null
  transportName: string
}

const StoreContext = createContext<StoreValue | null>(null)

const EVENTS_KEY = 'echovision.events.v1'
const ZONE_KEY = 'echovision.zone'
const DOSE_KEY = 'echovision.dose.v1'
const MAX_EVENTS = 200
/** Una muestra por segundo durante 12 h caben de sobra en localStorage. */
const MAX_DOSE_SAMPLES = 43200

function loadZone(): ZoneMode {
  try {
    const z = localStorage.getItem(ZONE_KEY)
    if (z === 'HOME' || z === 'STREET' || z === 'OFFICE') return z
  } catch {
    /* sin almacenamiento: se usa el valor por defecto */
  }
  return 'HOME'
}

/** Los eventos se persisten sin el PCM: 15360 flotantes por evento no caben. */
function loadEvents(): AcousticEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AcousticEvent[]
    return parsed.map((e) => ({ ...e, pcm: null }))
  } catch {
    return []
  }
}

function loadDose(): DoseSample[] {
  try {
    const raw = localStorage.getItem(DOSE_KEY)
    return raw ? (JSON.parse(raw) as DoseSample[]) : []
  } catch {
    return []
  }
}

export function EchoStoreProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<AudioCaptureEngine | null>(null)
  if (!engineRef.current) engineRef.current = new AudioCaptureEngine()
  const engine = engineRef.current

  const publisherRef = useRef<TelemetryPublisher | null>(null)

  const [status, setStatus] = useState<CaptureStatus>(engine.status)
  const [telemetry, setTelemetry] = useState<DspTelemetry | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zone, setZoneState] = useState<ZoneMode>(loadZone)
  const [events, setEvents] = useState<AcousticEvent[]>(loadEvents)
  const [nodes, setNodes] = useState<MeshNode[]>([])
  const [doseSamples, setDoseSamples] = useState<DoseSample[]>(loadDose)

  // El último snapshot llega en un mensaje distinto al del onset, así que se
  // guarda aquí para casarlo con el evento recién creado.
  const pendingSnapshot = useRef<DspSnapshot | null>(null)
  const zoneRef = useRef(zone)
  zoneRef.current = zone
  const lastDoseWrite = useRef(0)

  const setZone = useCallback(
    (z: ZoneMode) => {
      setZoneState(z)
      try {
        localStorage.setItem(ZONE_KEY, z)
      } catch {
        /* sin almacenamiento */
      }
      // Aquí está el efecto real: el perfil reconfigura el detector en el worklet.
      engine.setOnsetThreshold(ZONE_PROFILES[z].triggerDb)
    },
    [engine],
  )

  const start = useCallback(async () => {
    setError(null)
    try {
      if (!publisherRef.current) {
        publisherRef.current = new TelemetryPublisher()
        await publisherRef.current.connect()
      }
      const st = await engine.start({ splOffsetDb: readSplOffset() })
      engine.setOnsetThreshold(ZONE_PROFILES[zoneRef.current].triggerDb)
      setStatus(st)
      setIsRunning(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setIsRunning(false)
    }
  }, [engine])

  const stop = useCallback(() => {
    engine.stop()
    setStatus(engine.status)
    setIsRunning(false)
    setTelemetry(null)
  }, [engine])

  useEffect(() => {
    const offStatus = engine.onStatusChange(setStatus)

    const offSnap = engine.onSnapshot((s) => {
      pendingSnapshot.current = s
    })

    const offTelemetry = engine.onTelemetry((t) => {
      setTelemetry(t)
      publisherRef.current?.publish(t)

      // Dosimetría: una muestra por segundo basta para integrar la exposición y
      // evita llenar la memoria con 20 valores por segundo que no aportan nada.
      const now = Date.now()
      if (now - lastDoseWrite.current >= 1000) {
        lastDoseWrite.current = now
        setDoseSamples((prev) => {
          const next = [...prev, { at: now, db: Math.round(t.db * 10) / 10 }]
          return next.length > MAX_DOSE_SAMPLES ? next.slice(-MAX_DOSE_SAMPLES) : next
        })
      }

      if (!t.isOnset) return

      const snap = pendingSnapshot.current
      pendingSnapshot.current = null
      const event: AcousticEvent = {
        id: `ev_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        at: now,
        label: UNCLASSIFIED,
        risk: t.risk,
        decibels: Math.round(t.db * 10) / 10,
        azimuth: Math.round(t.azimuth * 10) / 10,
        spatialConfidence: t.spatialConfidence,
        noiseFloorDb: Math.round(t.noiseFloorDb * 10) / 10,
        zone: zoneRef.current,
        pcm: snap ? snap.pcm : null,
        breakdown: [],
        reviewed: false,
        falsePositive: false,
      }
      setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS))
    })

    return () => {
      offStatus()
      offSnap()
      offTelemetry()
    }
  }, [engine])

  // Persistencia de eventos, sin el PCM (que vive solo en memoria de la sesión).
  useEffect(() => {
    try {
      const slim = events.slice(0, 60).map(({ pcm, ...rest }) => ({ ...rest, pcm: null }))
      localStorage.setItem(EVENTS_KEY, JSON.stringify(slim))
    } catch {
      /* cuota llena o modo privado: no es crítico */
    }
  }, [events])

  useEffect(() => {
    try {
      localStorage.setItem(DOSE_KEY, JSON.stringify(doseSamples.slice(-7200)))
    } catch {
      /* idem */
    }
  }, [doseSamples])

  // Nodos de la malla: el propio equipo más cualquier otro que publique en el canal.
  useEffect(() => {
    const selfId = readDeviceId()
    const t = telemetry
    if (!t) return
    setNodes((prev) => {
      const others = prev.filter((n) => n.deviceId !== selfId)
      return [
        {
          deviceId: selfId,
          room: 'Este equipo',
          lastSeen: Date.now(),
          decibels: Math.round(t.db * 10) / 10,
          risk: t.risk,
          isSelf: true,
        },
        ...others,
      ]
    })
  }, [telemetry])

  const markReviewed = useCallback((id: string) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, reviewed: true } : e)))
  }, [])

  const reportFalsePositive = useCallback((id: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, falsePositive: true, reviewed: true } : e)),
    )
  }, [])

  const clearEvents = useCallback(() => setEvents([]), [])

  const unreviewed = useMemo(() => events.filter((e) => !e.reviewed).length, [events])

  const value: StoreValue = {
    engine,
    status,
    telemetry,
    isRunning,
    error,
    start,
    stop,
    zone,
    setZone,
    events,
    unreviewed,
    markReviewed,
    reportFalsePositive,
    clearEvents,
    nodes,
    doseSamples,
    publisher: publisherRef.current,
    transportName: publisherRef.current?.transportName ?? '—',
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useEchoStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useEchoStore debe usarse dentro de <EchoStoreProvider>')
  return ctx
}

function readSplOffset(): number {
  try {
    const v = Number(localStorage.getItem('echovision.splOffsetDb'))
    return Number.isFinite(v) && v > 0 ? v : 100
  } catch {
    return 100
  }
}

function readDeviceId(): string {
  try {
    return localStorage.getItem('echovision.device_id') || 'hud-primary'
  } catch {
    return 'hud-primary'
  }
}
