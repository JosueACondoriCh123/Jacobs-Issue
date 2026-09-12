/**
 * Logica de /test-audio.html: el banco de pruebas de Dev 2.
 *
 * Vive aparte de React a proposito. Si el HUD de Dev 1 se rompe a mitad de la
 * integracion, esta pagina sigue demostrando que la cadena de audio funciona.
 */
import { AudioCaptureEngine } from './captureEngine'
import { TelemetryPublisher, getDefaultTransport } from './telemetryPublisher'
import type { TransportKind } from './telemetryPublisher'
import { riskFromDb } from './dsp/spl.js'
import type { DspTelemetry } from './types'
import { UNCLASSIFIED } from './types'

const SPL_OFFSET_KEY = 'jacobs-issue.splOffsetDb'
const MIC_DISTANCE_KEY = 'jacobs-issue.micDistanceM'

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error('Falta el elemento #' + id)
  return node as T
}

const engine = new AudioCaptureEngine()
let publisher: TelemetryPublisher | null = null
let simulating = 0
let frameCount = 0
let unsubscribeFrames: (() => void) | null = null

// --- Controles persistentes -------------------------------------------------

const storedOffset = Number(localStorage.getItem(SPL_OFFSET_KEY))
const splOffset = Number.isFinite(storedOffset) && storedOffset > 0 ? storedOffset : 100

const storedDistance = Number(localStorage.getItem(MIC_DISTANCE_KEY))
const micDistance = Number.isFinite(storedDistance) && storedDistance > 0 ? storedDistance : 0.15

// El selector arranca mostrando lo que el entorno resolvera de verdad.
const transportSelect = el<HTMLSelectElement>('transport')
transportSelect.value = getDefaultTransport()

const offsetInput = el<HTMLInputElement>('splOffset')
const distanceInput = el<HTMLInputElement>('micDistance')
offsetInput.value = String(splOffset)
distanceInput.value = String(micDistance)

offsetInput.addEventListener('change', () => {
  const v = Number(offsetInput.value)
  if (!Number.isFinite(v)) return
  localStorage.setItem(SPL_OFFSET_KEY, String(v))
  engine.setSplOffset(v)
  log('Offset de calibracion fijado en ' + v + ' dB (persistido).')
})

distanceInput.addEventListener('change', () => {
  const v = Number(distanceInput.value)
  if (!Number.isFinite(v) || v <= 0) return
  localStorage.setItem(MIC_DISTANCE_KEY, String(v))
  engine.setMicDistance(v)
  log('Separacion entre microfonos fijada en ' + v + ' m.')
})

// --- Pintado ----------------------------------------------------------------

const meterFill = el<HTMLDivElement>('meterFill')
const floorMark = el<HTMLDivElement>('floorMark')
const thresholdMark = el<HTMLDivElement>('thresholdMark')
const needle = el<HTMLDivElement>('needle')
const eventList = el<HTMLUListElement>('eventList')

function dbToPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db - 20) / 100) * 100))
}

function render(t: DspTelemetry): void {
  el('dbValue').textContent = t.db.toFixed(1)
  el('peakValue').textContent = t.sessionPeakDb.toFixed(1)
  el('floorValue').textContent = t.noiseFloorDb.toFixed(1)
  el('thresholdValue').textContent = t.thresholdDb.toFixed(1)
  el('azimuthValue').textContent = t.azimuth.toFixed(1)
  el('confValue').textContent = t.spatialConfidence.toFixed(2)
  el('riskValue').textContent = t.risk
  el('riskValue').className = 'pill risk-' + t.risk

  meterFill.style.width = dbToPercent(t.db) + '%'
  floorMark.style.left = dbToPercent(t.noiseFloorDb) + '%'
  thresholdMark.style.left = dbToPercent(t.thresholdDb) + '%'

  // La aguja se atenua cuando la direccion no es fiable, en vez de mentir.
  needle.style.transform = 'rotate(' + t.azimuth.toFixed(2) + 'deg)'
  needle.style.opacity = String(0.25 + 0.75 * Math.min(1, t.spatialConfidence))

  if (publisher) {
    el('publishedCount').textContent = String(publisher.publishedCount)
    el('droppedCount').textContent = String(publisher.droppedCount)
  }
}

function log(message: string): void {
  const li = document.createElement('li')
  li.textContent = new Date().toLocaleTimeString() + '  ' + message
  eventList.prepend(li)
  while (eventList.children.length > 40) eventList.lastChild?.remove()
}

function logOnset(t: DspTelemetry): void {
  const li = document.createElement('li')
  li.className = 'onset risk-' + t.risk
  const dir = t.spatialConfidence > 0.2 ? t.azimuth.toFixed(0) + ' grados' : 'direccion desconocida'
  li.textContent =
    new Date().toLocaleTimeString() +
    '  EVENTO  ' +
    t.db.toFixed(1) +
    ' dB(A)  ' +
    dir +
    '  ' +
    t.risk
  eventList.prepend(li)
  while (eventList.children.length > 40) eventList.lastChild?.remove()
}

function renderStatus(): void {
  const s = engine.status
  el('statusActive').textContent = s.active ? 'CAPTURANDO' : 'DETENIDO'
  el('statusDevice').textContent = s.deviceLabel || '-'
  el('statusRate').textContent = s.sampleRate ? s.sampleRate + ' Hz' : '-'

  const ch = el('statusChannels')
  ch.textContent = s.active
    ? s.channelCount + (s.stereo ? ' (estereo util)' : ' (sin estereo util)')
    : '-'
  ch.className = s.active ? (s.stereo ? 'ok' : 'warn') : ''

  const flags = el('statusFlags')
  if (!s.active) {
    flags.textContent = '-'
    flags.className = ''
  } else {
    const bad = s.echoCancellation || s.noiseSuppression || s.autoGainControl
    flags.textContent =
      'AEC ' + (s.echoCancellation ? 'ON' : 'off') +
      ' / NS ' + (s.noiseSuppression ? 'ON' : 'off') +
      ' / AGC ' + (s.autoGainControl ? 'ON' : 'off')
    flags.className = bad ? 'warn' : 'ok'
  }

  const warnBox = el('warnings')
  warnBox.innerHTML = ''
  for (const w of s.warnings) {
    const p = document.createElement('p')
    p.textContent = w
    warnBox.appendChild(p)
  }
}

// --- Arranque y parada ------------------------------------------------------

async function ensurePublisher(): Promise<TelemetryPublisher> {
  const kind = transportSelect.value as TransportKind
  if (publisher && publisher.transportName === kind) return publisher
  if (publisher) await publisher.disconnect()
  publisher = new TelemetryPublisher({ transport: kind })
  await publisher.connect()
  el('transportName').textContent = publisher.transportName
  log('Transporte conectado: ' + publisher.transportName)
  return publisher
}

el('startBtn').addEventListener('click', async () => {
  try {
    const pub = await ensurePublisher()
    const status = await engine.start({
      splOffsetDb: Number(offsetInput.value),
      micDistanceM: Number(distanceInput.value),
    })
    renderStatus()
    log('Captura iniciada: ' + status.channelCount + ' canal(es) a ' + status.sampleRate + ' Hz.')
    for (const w of status.warnings) log('AVISO: ' + w)

    // El motor puede rectificar el estado al ver las muestras (p. ej. descubrir
    // que los dos canales son en realidad el mismo). La UI debe seguir esa verdad.
    engine.onStatusChange((s) => {
      renderStatus()
      for (const w of s.warnings) log('AVISO: ' + w)
    })

    engine.onTelemetry((t) => {
      render(t)
      if (t.isOnset) logOnset(t)
      pub.publish(t, UNCLASSIFIED)
    })
  } catch (error) {
    log('ERROR: ' + (error instanceof Error ? error.message : String(error)))
    renderStatus()
  }
})

el('stopBtn').addEventListener('click', () => {
  engine.stop()
  unsubscribeFrames?.()
  unsubscribeFrames = null
  renderStatus()
  log('Captura detenida.')
})

el('resetBtn').addEventListener('click', () => {
  engine.resetBaseline()
  log('Suelo de ruido reiniciado.')
})

// --- Frames para Dev 4 ------------------------------------------------------

el('frameBtn').addEventListener('click', () => {
  if (unsubscribeFrames) {
    unsubscribeFrames()
    unsubscribeFrames = null
    el('frameBtn').textContent = 'Activar frames YAMNet'
    log('Emision de frames desactivada.')
    return
  }
  unsubscribeFrames = engine.onFrame((f) => {
    frameCount++
    let peak = 0
    for (let i = 0; i < f.pcm.length; i++) {
      const a = Math.abs(f.pcm[i])
      if (a > peak) peak = a
    }
    el('frameCount').textContent = String(frameCount)
    el('frameInfo').textContent =
      f.pcm.length + ' muestras @ ' + f.sampleRate + ' Hz  pico=' + peak.toFixed(3)
  })
  el('frameBtn').textContent = 'Desactivar frames YAMNet'
  log('Emision de frames activada (0.96 s a 16 kHz, solape del 50%).')
})

// --- Modo simulacion --------------------------------------------------------

/**
 * Genera telemetria sintetica sin microfono.
 *
 * No es un adorno: si en la sede falla el permiso del microfono o el ruido de
 * fondo hace inutil la demo en vivo, esto mantiene el HUD alimentado.
 */
el('simulateBtn').addEventListener('click', async () => {
  if (simulating) {
    window.clearInterval(simulating)
    simulating = 0
    el('simulateBtn').textContent = 'Simular sin microfono'
    log('Simulacion detenida.')
    return
  }

  const pub = await ensurePublisher()
  let phase = 0
  let nextOnsetAt = 12

  simulating = window.setInterval(() => {
    phase++
    const isOnset = phase >= nextOnsetAt
    if (isOnset) nextOnsetAt = phase + 20 + Math.floor(Math.random() * 40)

    const floor = 38
    const db = isOnset ? 68 + Math.random() * 30 : floor + Math.random() * 6
    const azimuth = Math.sin(phase / 18) * 75

    const t: DspTelemetry = {
      type: 'telemetry',
      db,
      peakDb: db,
      azimuth,
      spatialConfidence: 0.85,
      noiseFloorDb: floor,
      thresholdDb: floor + 12,
      ambientAverageDb: floor + 2,
      sessionPeakDb: db,
      risk: riskFromDb(db),
      isOnset,
      channelCount: 2,
      effectiveStereo: true,
      audioTimeMs: phase * 50,
    }

    render(t)
    if (isOnset) logOnset(t)
    pub.publish(t, isOnset ? 'Evento simulado' : UNCLASSIFIED)
  }, 50)

  el('simulateBtn').textContent = 'Detener simulacion'
  log('Simulacion iniciada (20 Hz, sin microfono).')
})

renderStatus()
log('Listo. Pulsa "Iniciar captura" y concede permiso al microfono.')
