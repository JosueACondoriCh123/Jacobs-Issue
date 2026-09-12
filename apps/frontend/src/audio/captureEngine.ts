import workletUrl from './worklet/dspProcessor.js?worker&url'
import type { CaptureStatus, DspAudioFrame, DspSnapshot, DspTelemetry } from './types'

export interface CaptureOptions {
  /** Offset de calibracion dB SPL. Ver spl.js: esto NO es una medida absoluta. */
  splOffsetDb?: number
  /** Separacion entre microfonos, en metros. Determina la escala del azimut. */
  micDistanceM?: number
  /** Activa el diezmado a 16 kHz para el clasificador de Dev 4. */
  emitFrames?: boolean
}

type TelemetryListener = (t: DspTelemetry) => void
type FrameListener = (f: DspAudioFrame) => void
type SnapshotListener = (s: DspSnapshot) => void

const MONO_WARNING_PREFIX = 'Sin estereo utilizable'

const IDLE_STATUS: CaptureStatus = {
  active: false,
  channelCount: 0,
  sampleRate: 0,
  deviceLabel: '',
  stereo: false,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  warnings: [],
}

/**
 * Captura de microfono y puesta en marcha del DSP.
 *
 * El punto delicado esta en las restricciones de getUserMedia. Por defecto el
 * navegador aplica cancelacion de eco, supresion de ruido y control automatico
 * de ganancia, pensados para videollamadas. Para este proyecto los tres son
 * destructivos:
 *   - El AGC reescala la senal continuamente, asi que el nivel medido deja de
 *     tener relacion con el nivel real: un sonometro sobre AGC no mide nada.
 *   - La cancelacion de eco y la supresion de ruido alteran la fase entre
 *     canales, que es exactamente la informacion de la que GCC-PHAT extrae la
 *     direccion.
 * Por eso se piden desactivados. Y como Chrome puede ignorar en silencio parte
 * de lo pedido, despues se LEE el estado real del track y se avisa si no se
 * cumplio, en vez de dar por hecho que si.
 */
export class AudioCaptureEngine {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private sink: GainNode | null = null

  private telemetryListeners = new Set<TelemetryListener>()
  private frameListeners = new Set<FrameListener>()
  private statusListeners = new Set<(status: CaptureStatus) => void>()
  private snapshotListeners = new Set<SnapshotListener>()

  private _status: CaptureStatus = { ...IDLE_STATUS }

  get status(): CaptureStatus {
    return this._status
  }

  get isActive(): boolean {
    return this._status.active
  }

  async start(options: CaptureOptions = {}): Promise<CaptureStatus> {
    if (this._status.active) return this._status

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no expone getUserMedia (se requiere HTTPS o localhost).')
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        sampleRate: 48000,
      },
      video: false,
    })

    this.stream = stream
    try {
    const track = stream.getAudioTracks()[0]
    if (!track) throw new Error('Micrófono desconectado: no hay pista de audio.')
    track.addEventListener('ended', () => {
      if (this.stream !== stream) return
      this.stop()
    }, { once: true })
    const settings = track.getSettings()

    const warnings: string[] = []
    if (settings.autoGainControl) {
      warnings.push('El control automatico de ganancia sigue activo: los decibelios no son fiables.')
    }
    if (settings.echoCancellation) {
      warnings.push('La cancelacion de eco sigue activa: degrada la estimacion de direccion.')
    }
    if (settings.noiseSuppression) {
      warnings.push('La supresion de ruido sigue activa: degrada la estimacion de direccion.')
    }

    const ctx = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: 48000,
    })
    this.ctx = ctx
    if (ctx.sampleRate !== 48000) throw new Error('El DSP requiere 48 kHz; el navegador no admite esta frecuencia.')
    // Si el usuario no ha interactuado aun, el contexto nace suspendido.
    if (ctx.state === 'suspended') await ctx.resume()

    await ctx.audioWorklet.addModule(workletUrl)

    const source = ctx.createMediaStreamSource(stream)

    // El numero de canales que declara el track manda sobre lo que pedimos:
    // Chrome acepta channelCount: 2 y entrega uno solo en muchos portatiles.
    const channelCount = Math.min(settings.channelCount ?? source.channelCount ?? 1, 2)
    if (channelCount < 2) {
      warnings.push(
        MONO_WARNING_PREFIX + ': el dispositivo entrega un solo canal.',
      )
    }

    const node = new AudioWorkletNode(ctx, 'jacobs-issue-dsp', {
      numberOfInputs: 1,
      // Aunque este nodo solo analiza y no produce sonido, declara una salida a
      // proposito: ver el comentario de `sink` mas abajo.
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: {
        channelCount,
        splOffsetDb: options.splOffsetDb,
        micDistanceM: options.micDistanceM,
        // Si alguien se suscribio a frames o instantaneas ANTES de arrancar (el
        // caso normal: los componentes se montan antes de que el usuario pulse
        // "iniciar"), el nodo debe nacer ya emitiendo. Enviar el mensaje al
        // suscribirse no serviria: en ese momento `this.node` todavia es null.
        emitFrames:
          options.emitFrames ??
          (this.frameListeners.size > 0 || this.snapshotListeners.size > 0),
      },
    })

    node.port.onmessage = (event: MessageEvent) => {
      const msg = event.data as DspTelemetry | DspAudioFrame | DspSnapshot
      if (msg.type === 'telemetry') {
        this.reconcileStereo(msg.effectiveStereo)
        for (const l of this.telemetryListeners) l(msg)
      } else if (msg.type === 'frame') {
        for (const l of this.frameListeners) l({...msg,capturedAt:new Date().toISOString()})
      } else if (msg.type === 'snapshot') {
        for (const l of this.snapshotListeners) l(msg)
      }
    }

    source.connect(node)

    // Sumidero de ganancia cero, por precaucion.
    //
    // Un AudioWorkletNode que solo analiza y no conecta con el destino queda como
    // una rama del grafo sin salida, y hay navegadores y versiones que en esa
    // situacion no lo renderizan a ritmo completo. Conectarlo a un GainNode con
    // ganancia 0 le da un sumidero y garantiza que se le llame siempre, sin que
    // se oiga absolutamente nada.
    //
    // Honestidad sobre la evidencia: al intentar medir el efecto en este equipo
    // los resultados fueron demasiado ruidosos para concluir nada (el navegador
    // limitaba el renderizado de forma variable entre ejecuciones). Se mantiene
    // porque no cuesta nada y cubre un riesgo conocido, no porque se haya medido
    // una mejora aqui.
    const sink = ctx.createGain()
    sink.gain.value = 0
    node.connect(sink)
    sink.connect(ctx.destination)

    this.ctx = ctx
    this.stream = stream
    this.node = node
    this.source = source
    this.sink = sink

    this._status = {
      active: true,
      channelCount,
      sampleRate: ctx.sampleRate,
      deviceLabel: track.label || 'Microfono sin nombre',
      stereo: channelCount >= 2,
      echoCancellation: Boolean(settings.echoCancellation),
      noiseSuppression: Boolean(settings.noiseSuppression),
      autoGainControl: Boolean(settings.autoGainControl),
      warnings,
    }

    for (const l of this.statusListeners) l(this._status)
    return this._status
    } catch (error) {
      this.stop()
      throw error
    }
  }

  /**
   * Corrige el estado con lo que el DSP observa realmente en las muestras.
   *
   * `track.getSettings().channelCount` puede faltar, y `AudioNode.channelCount`
   * es configuracion, no medicion: vale 2 por defecto aunque la fuente sea mono.
   * Fiarse de ellos hace que un microfono mono se anuncie como estereo y que el
   * HUD dibuje una direccion inventada. La unica fuente de verdad es el audio.
   */
  private reconcileStereo(effectiveStereo: boolean): void {
    if (!this._status.active) return
    if (this._status.stereo === effectiveStereo) return

    const warnings = this._status.warnings.filter((w) => !w.startsWith(MONO_WARNING_PREFIX))
    if (!effectiveStereo) {
      warnings.push(
        MONO_WARNING_PREFIX +
          ': los dos canales no contienen informacion espacial distinta. No hay dirección medible; el HUD ocultará el vector.',
      )
    }
    this._status = { ...this._status, stereo: effectiveStereo, warnings }
    for (const l of this.statusListeners) l(this._status)
  }

  /** Avisa cuando el estado cambia tras arrancar (p. ej. al detectarse mono real). */
  onStatusChange(listener: (status: CaptureStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  stop(): void {
    this.node?.port.postMessage({ type: 'stop' })
    this.source?.disconnect()
    this.node?.disconnect()
    this.sink?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()

    this.ctx = null
    this.stream = null
    this.node = null
    this.source = null
    this.sink = null
    this._status = { ...IDLE_STATUS }
    for (const l of this.statusListeners) l(this._status)
  }

  onTelemetry(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener)
    return () => this.telemetryListeners.delete(listener)
  }

  /**
   * Suscripcion del clasificador de Dev 4. La primera suscripcion activa el
   * diezmado a 16 kHz; mientras nadie escuche, ese trabajo no se hace.
   */
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener)
    if (this.frameListeners.size === 1) {
      this.node?.port.postMessage({ type: 'setEmitFrames', value: true })
    }
    return () => {
      this.frameListeners.delete(listener)
      if (this.frameListeners.size === 0 && this.snapshotListeners.size === 0) {
        this.node?.port.postMessage({ type: 'setEmitFrames', value: false })
      }
    }
  }

  /**
   * Audio del instante de cada evento, para la caja negra de Forensics.
   *
   * Depende del mismo anillo que alimenta al clasificador, asi que suscribirse
   * aqui tambien activa el diezmado a 16 kHz.
   */
  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener)
    if (this.snapshotListeners.size === 1 && this.frameListeners.size === 0) {
      this.node?.port.postMessage({ type: 'setEmitFrames', value: true })
    }
    return () => {
      this.snapshotListeners.delete(listener)
      if (this.snapshotListeners.size === 0 && this.frameListeners.size === 0) {
        this.node?.port.postMessage({ type: 'setEmitFrames', value: false })
      }
    }
  }

  setSplOffset(db: number): void {
    this.node?.port.postMessage({ type: 'setSplOffset', value: db })
  }

  setMicDistance(meters: number): void {
    this.node?.port.postMessage({ type: 'setMicDistance', value: meters })
  }

  /**
   * Umbral de deteccion en dB sobre el suelo de ruido.
   * Lo usa el selector de zona del OS (hogar / calle / oficina).
   */
  setOnsetThreshold(db: number): void {
    this.node?.port.postMessage({ type: 'setOnsetThreshold', value: db })
  }

  /** Reinicia el suelo de ruido: util al cambiar de sala. */
  resetBaseline(): void {
    this.node?.port.postMessage({ type: 'resetBaseline' })
  }
}
