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
import { YamnetClassifier } from '../ai/yamnetClassifier'
import { NeuralPipeline, type ModelState, type PersistenceState } from '../ai/neuralPipeline'
import { normalizeTelemetry, mapAcousticEvent } from '../lib/telemetry'
import { persistLiveEvent } from '../lib/liveBackend'
import { useHudTelemetry } from '../hooks/useHudTelemetry'
import { useMiniHudWindow } from '../hooks/useMiniHudWindow'
import { useAuth } from '../hooks/useAuth'
import { getSignalState, type SignalState } from '../lib/signalState'
import type { HUDTelemetryEvent, AcousticEventRow } from '../types/hud'
import { supabase } from '../lib/supabase'

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
  confidence?: number
  directionValid?: boolean
  persistence?: PersistenceState
  model?: string
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
  auth: ReturnType<typeof useAuth>
  hud: ReturnType<typeof useHudTelemetry>
  miniHud: ReturnType<typeof useMiniHudWindow>
  signal: SignalState
  modelState: ModelState
  modelError: string | null
  persistenceState: PersistenceState
  persistenceError: string | null
  splOffsetDb: number
  setSplOffsetDb: (value:number) => void
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

const EVENTS_KEY = 'jacobs-issue.events.v1'
const ZONE_KEY = 'jacobs-issue.zone'
const DOSE_KEY = 'jacobs-issue.dose.v1'
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
  const auth=useAuth()
  const realtimeHud=useHudTelemetry(auth.user?.id)
  const miniHud=useMiniHudWindow()
  const engineRef = useRef<AudioCaptureEngine | null>(null)
  if (!engineRef.current) engineRef.current = new AudioCaptureEngine()
  const engine = engineRef.current

  const publisherRef = useRef<TelemetryPublisher | null>(null)
  const modelRef=useRef(new YamnetClassifier())
  const pipelineRef=useRef<NeuralPipeline | null>(null)
  const latestDsp=useRef<DspTelemetry | null>(null)
  const lastPrediction=useRef({label:UNCLASSIFIED,confidence:0,risk:'NORMAL' as RiskLevel,at:0})
  const lastSampleAt=useRef<number | null>(null)
  const stopped=useRef(false)
  const runGeneration=useRef(0)
  const starting=useRef(false)
  const modelLoading=useRef<Promise<void> | null>(null)
  const [clock,setClock]=useState(Date.now())
  const [captureFailure,setCaptureFailure]=useState<SignalState | null>(null)
  const [modelState,setModelState]=useState<ModelState>('IDLE')
  const [modelError,setModelError]=useState<string | null>(null)
  const [persistenceState,setPersistenceState]=useState<PersistenceState>('LOCAL')
  const [publisherError,setPublisherError]=useState<string | null>(null)
  const [persistenceError,setPersistenceError]=useState<string | null>(null)
  const [splOffsetDb,setOffset]=useState(readSplOffset)
  const setSplOffsetDb=useCallback((value:number) => {
    if (!Number.isFinite(value) || value < -140 || value > 140) return
    setOffset(value); engine.setSplOffset(value)
    try { localStorage.setItem('jacobs-issue.splOffsetDb',String(value)) } catch { /* local storage unavailable */ }
  },[engine])

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
    if (starting.current || engine.isActive) return
    starting.current=true
    setError(null)
    setCaptureFailure('STARTING'); stopped.current=false; lastSampleAt.current=null
    const generation=++runGeneration.current
    try {
      const st = await engine.start({ splOffsetDb: readSplOffset() })
      if (generation !== runGeneration.current) {engine.stop();return}
      setCaptureFailure(null)
      engine.setOnsetThreshold(ZONE_PROFILES[zoneRef.current].triggerDb)
      setStatus(st)
      setIsRunning(true)
      const publisher=new TelemetryPublisher({deviceId:readDeviceId(),onError:setPublisherError})
      publisherRef.current=publisher
      setPublisherError(null)
      void publisher.connect().catch(e => setPublisherError(`Realtime: ${e.message}`))
      if (!modelRef.current.isLoaded) {
        setModelState('LOADING'); setModelError(null)
        modelLoading.current ??= modelRef.current.load().finally(() => { modelLoading.current=null })
        void modelLoading.current.then(() => { setModelState('READY') })
          .catch(e => { modelRef.current.dispose();setModelState('ERROR');setModelError(e.message) })
      } else setModelState('READY')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setIsRunning(false)
      engine.stop()
      setCaptureFailure(e instanceof DOMException && e.name === 'NotAllowedError' ? 'DENIED' : e instanceof DOMException && e.name === 'NotFoundError' ? 'DISCONNECTED' : 'ERROR')
    } finally { starting.current=false }
  }, [engine])

  const stop = useCallback(() => {
    runGeneration.current++; stopped.current=true;setCaptureFailure(null); lastSampleAt.current=null
    pipelineRef.current?.reset(); lastPrediction.current={label:UNCLASSIFIED,confidence:0,risk:'NORMAL',at:0}
    void publisherRef.current?.disconnect(); publisherRef.current=null
    engine.stop()
    setStatus(engine.status)
    setIsRunning(false)
    setTelemetry(null)
  }, [engine])

  useEffect(() => {
    const timer=window.setInterval(() => setClock(Date.now()),250)
    return () => window.clearInterval(timer)
  },[])

  useEffect(() => {
    const pipeline=new NeuralPipeline({
      classifier:modelRef.current,persist:persistLiveEvent,
      onPrediction:(label,confidence,risk) => { lastPrediction.current={label,confidence,risk,at:Date.now()} },
      onEvent:(event) => {
        setPersistenceState(event.persistence ?? 'LOCAL')
        if (event.persistence === 'SAVED') setPersistenceError(null)
        setEvents(prev => {
          const old=prev.find(e => e.id === event.id)
          const next:AcousticEvent={id:event.id,at:Date.parse(event.timestamp),label:event.label,risk:event.risk,
            decibels:event.intensity,azimuth:event.azimuth,spatialConfidence:event.spatialConfidence ?? 0,
            directionValid:event.directionValid,confidence:event.confidence,persistence:event.persistence,model:event.model,
            noiseFloorDb:latestDsp.current?.noiseFloorDb ?? 0,zone:zoneRef.current,pcm:null,
            breakdown:[{label:event.label,confidence:event.confidence}],reviewed:old?.reviewed ?? false,falsePositive:old?.falsePositive ?? false}
          return [next,...prev.filter(e => e.id !== event.id)].slice(0,MAX_EVENTS)
        })
      },
      onConfirmed:event => { try { publisherRef.current?.publishEvent(event) } catch(e) { setPersistenceError(String(e)) } },
      onError:message => { setPersistenceError(message); setPersistenceState('ERROR'); if (message.startsWith('Inferencia')) {modelRef.current.dispose();pipelineRef.current?.reset();setModelState('ERROR');setModelError(message)} },
    })
    pipelineRef.current=pipeline
    const off=engine.onFrame(frame => {
      if (!modelRef.current.isLoaded || !engine.isActive) return
      const t=latestDsp.current
      pipeline.push({...frame,spatialConfidence:t?.spatialConfidence ?? 0,directionValid:t?.effectiveStereo === true && (t?.spatialConfidence ?? 0)>0.2})
    })
    return () => {off();pipeline.reset();engine.stop();void publisherRef.current?.disconnect()}
  },[engine])

  useEffect(() => {
    if (!supabase || !auth.user) return
    let cancelled=false
    void supabase.from('acoustic_event_logs').select('*').eq('user_id',auth.user.id).order('timestamp',{ascending:false}).limit(60).then(({data,error}) => {
      if (cancelled) return
      if (error) { setPersistenceError(`Historial: ${error.message}`); return }
      const remote=(data ?? []).map(row => {
        const e=mapAcousticEvent(row as AcousticEventRow)
        return {id:e.id,at:Date.parse(e.timestamp),label:e.label,risk:e.risk,decibels:e.intensity,azimuth:e.azimuth,
          confidence:e.confidence,spatialConfidence:e.spatialConfidence ?? 0,directionValid:e.directionValid,persistence:'SAVED' as const,
          model:e.model,noiseFloorDb:0,zone:zoneRef.current,pcm:null,breakdown:[{label:e.label,confidence:e.confidence}],reviewed:false,falsePositive:false}
      })
      setEvents(prev => [...prev,...remote.filter(e => !prev.some(p => p.id===e.id))].sort((a,b) => b.at-a.at).slice(0,MAX_EVENTS))
    })
    return () => {cancelled=true}
  },[auth.user?.id])

  useEffect(() => {
    const offStatus = engine.onStatusChange(st => {
      setStatus(st)
      if (!st.active && !stopped.current && lastSampleAt.current !== null) {
        setCaptureFailure('DISCONNECTED');setIsRunning(false);setTelemetry(null)
        pipelineRef.current?.reset();void publisherRef.current?.disconnect();publisherRef.current=null
      }
    })

    const offSnap = engine.onSnapshot((s) => {
      pendingSnapshot.current = s
    })

    const offTelemetry = engine.onTelemetry((t) => {
      lastSampleAt.current=Date.now(); latestDsp.current=t
      setTelemetry(t)
      const p=Date.now()-lastPrediction.current.at <= 2000 ? lastPrediction.current : {label:UNCLASSIFIED,confidence:0,risk:'NORMAL' as RiskLevel}
      publisherRef.current?.publish(t,p.label,{confidence:p.confidence,model:modelRef.current.modelName,risk:p.risk})

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

  const signal=captureFailure ?? getSignalState(isRunning,lastSampleAt.current,clock,stopped.current)
  const p=clock-lastPrediction.current.at <= 2000 ? lastPrediction.current : {label:UNCLASSIFIED,confidence:0,risk:'NORMAL' as RiskLevel}
  const localReading=telemetry ? normalizeTelemetry({id:`level-${telemetry.audioTimeMs}`,kind:'level',intensity:telemetry.db,
    label:p.label,confidence:p.confidence,risk:p.risk==='CRITICAL' ? 'CRITICAL' : telemetry.risk,
    azimuth:telemetry.azimuth,spatialConfidence:telemetry.spatialConfidence,directionValid:telemetry.effectiveStereo,
    timestamp:new Date(lastSampleAt.current ?? clock).toISOString(),model:modelRef.current.modelName},'local') : null
  const received=realtimeHud.telemetry
  const freshReceived=received.source !== 'idle' && clock-Date.parse(received.capturedAt ?? received.timestamp) <= 2000
  const visibleReading=signal === 'LIVE' ? (freshReceived ? received : localReading ?? received) : normalizeTelemetry({id:'no-signal',kind:'level',label:'Sin señal',intensity:0,risk:'NORMAL',confidence:0},'idle')
  const value: StoreValue = {
    auth,hud:{...realtimeHud,error:realtimeHud.error ?? publisherError,connection:publisherError ? 'ERROR' : realtimeHud.connection,telemetry:visibleReading},miniHud,signal,modelState,modelError,persistenceState,persistenceError,splOffsetDb,setSplOffsetDb,
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
    const raw = localStorage.getItem('jacobs-issue.splOffsetDb')
    const v = raw === null ? NaN : Number(raw)
    return Number.isFinite(v) && v >= -140 && v <= 140 ? v : 100
  } catch {
    return 100
  }
}

function readDeviceId(): string {
  try {
    return localStorage.getItem('jacobs-issue.device_id') || 'hud-primary'
  } catch {
    return 'hud-primary'
  }
}
