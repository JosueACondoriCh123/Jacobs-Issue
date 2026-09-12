/**
 * AudioWorkletProcessor: todo el DSP de tiempo real vive aqui, en el hilo de audio.
 *
 * Por que un AudioWorklet y no un ScriptProcessorNode: ScriptProcessorNode esta
 * deprecado y corre en el hilo principal, compitiendo con React y con el render
 * del HUD. El jitter resultante arruina tanto la medicion de nivel como los
 * 60 FPS. El worklet corre en su propio hilo de prioridad alta.
 *
 * Politica de emision: se analiza cada 1024 muestras (~21 ms a 48 kHz) pero NO se
 * envia un mensaje por analisis. Se agrega y se hace postMessage a ~20 Hz. Enviar
 * a 47 Hz saturaria el puente worklet -> main sin que el ojo note la diferencia.
 * La excepcion son los onsets: esos se envian inmediatamente, sin esperar.
 */

import { AWeightingFilter } from '../dsp/aWeighting.js';
import { GccPhatEstimator, AzimuthSmoother, heuristicAzimuthFromSpectrum } from '../dsp/gccPhat.js';
import { NoiseFloorTracker } from '../dsp/noiseFloor.js';
import { OnsetDetector } from '../dsp/onset.js';
import { rmsToDbfs, dbfsToSpl, riskFromDb, DEFAULT_SPL_OFFSET_DB } from '../dsp/spl.js';
import { Decimator48to16 } from '../dsp/resampler.js';

const FRAME_SIZE = 1024;
const EMIT_INTERVAL_MS = 50; // ~20 Hz

// Contrato con Dev 4: YAMNet ingiere ventanas de 0.96 s a 16 kHz, con 50% de solape.
const YAMNET_FRAME_SAMPLES = 15360;
const YAMNET_HOP_SAMPLES = 7680;

class JacobsIssueDspProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};

    this.channelCount = opts.channelCount || 1;
    this.splOffsetDb = opts.splOffsetDb ?? DEFAULT_SPL_OFFSET_DB;
    this.micDistanceM = opts.micDistanceM ?? 0.15;

    // sampleRate es una variable global del AudioWorkletGlobalScope.
    this.fs = sampleRate;

    this.weighting = new AWeightingFilter(this.fs);
    this.noiseFloor = new NoiseFloorTracker({
      windowSeconds: 5,
      updatesPerSecond: this.fs / FRAME_SIZE,
    });
    this.onset = new OnsetDetector();
    this.smoother = new AzimuthSmoother(0.35);
    this.doa = new GccPhatEstimator({
      frameSize: FRAME_SIZE,
      sampleRate: this.fs,
      micDistanceM: this.micDistanceM,
    });

    // Buffers de acumulacion: el worklet recibe quanta de 128 muestras.
    this.bufL = new Float32Array(FRAME_SIZE);
    this.bufR = new Float32Array(FRAME_SIZE);
    this.fill = 0;

    this.lastEmitMs = 0;
    this.latestDb = 0;
    this.latestAzimuth = 0;
    this.latestSpatialConfidence = 0;
    this.peakSinceEmit = 0;
    // Hasta que llega audio se asume lo pesimista: sin direccion fiable.
    this.effectiveStereo = false;
    // Marca temporal para la instantanea diferida del analisis forense.
    this.snapshotDueAtFrame = 0;

    this.running = true;

    // Camino hacia el clasificador de Dev 4. Solo se activa si alguien lo pide:
    // si nadie esta suscrito no se gasta CPU en diezmar.
    this.emitFrames = Boolean(opts.emitFrames);
    this.decimator = new Decimator48to16();
    this.frameRing = new Float32Array(YAMNET_FRAME_SAMPLES);
    this.frameFill = 0;
    this.writeIdx = 0;
    this.samplesSinceFrame = 0;
    this.frameReady = false;
    this.decimScratch = new Float32Array(512);
    this.monoScratch = new Float32Array(1024);

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'setSplOffset') {
        this.splOffsetDb = msg.value;
      } else if (msg.type === 'setMicDistance') {
        this.micDistanceM = msg.value;
        this.doa = new GccPhatEstimator({
          frameSize: FRAME_SIZE,
          sampleRate: this.fs,
          micDistanceM: this.micDistanceM,
        });
      } else if (msg.type === 'setOnsetThreshold') {
        // Perfil de zona: en la calle el suelo de ruido es alto y un umbral bajo
        // dispararia sin parar; en casa interesa oir un timbre que apenas supera
        // el silencio. El release se mantiene a la mitad para conservar la
        // histeresis proporcional al umbral.
        this.onset.triggerDb = msg.value;
        this.onset.releaseDb = Math.max(3, msg.value * 0.5);
      } else if (msg.type === 'resetBaseline') {
        this.noiseFloor.reset();
        this.onset.reset();
        this.weighting.reset();
        this.smoother.reset();
      } else if (msg.type === 'setEmitFrames') {
        this.emitFrames = Boolean(msg.value);
        if (!this.emitFrames) {
          this.decimator.reset();
          this.frameFill = 0;
          this.writeIdx = 0;
          this.samplesSinceFrame = 0;
          this.frameReady = false;
        }
      } else if (msg.type === 'stop') {
        this.running = false;
      }
    };
  }

  /** Analiza un bloque completo de FRAME_SIZE muestras. */
  analyzeFrame() {
    const { bufL, bufR } = this;

    // Nivel: siempre desde el canal izquierdo (o el unico canal si es mono).
    const stats = this.weighting.processBlockStats(bufL);
    const db = dbfsToSpl(rmsToDbfs(stats.rms), this.splOffsetDb);

    this.noiseFloor.push(db);
    this.latestDb = db;
    if (db > this.peakSinceEmit) this.peakSinceEmit = db;

    // Comprobacion de estereo REAL, sobre las muestras y no sobre lo que declare
    // el navegador. Hay dos formas de acabar con dos canales sin informacion
    // espacial, y ambas son peligrosas porque producirian un angulo con
    // confianza alta a partir de nada:
    //   a) un microfono mono que Web Audio duplica al pedir dos canales
    //      (los canales salen identicos -> correlacion perfecta en retardo 0
    //      -> "el sonido viene exactamente de frente", con total seguridad);
    //   b) un canal derecho mudo (mezcla discreta), que tampoco aporta fase.
    // En cualquiera de los dos casos hay que degradar a modo mono y decirlo.
    let sumDiff = 0;
    let energyL = 0;
    let energyR = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const d = bufL[i] - bufR[i];
      sumDiff += d * d;
      energyL += bufL[i] * bufL[i];
      energyR += bufR[i] * bufR[i];
    }
    const hasSignal = energyL > 1e-9;
    const channelsIdentical = hasSignal && sumDiff / energyL < 1e-6;
    const rightSilent = hasSignal && energyR / energyL < 1e-6;
    this.effectiveStereo = this.channelCount >= 2 && !channelsIdentical && !rightSilent;

    // Direccion.
    if (this.effectiveStereo) {
      const est = this.doa.estimate(bufL, bufR);
      // Solo se hace caso a estimaciones con pico claro: en silencio o con ruido
      // difuso la correlacion es plana y el angulo seria puro azar.
      if (est.confidence > 0.2) {
        this.latestAzimuth = this.smoother.update(est.azimuth, est.confidence);
        this.latestSpatialConfidence = est.confidence;
      } else {
        this.latestSpatialConfidence = est.confidence;
      }
    } else {
      // Sin estereo util: no existe informacion direccional. Se genera un angulo
      // estable para que el HUD tenga algo que dibujar, pero con confianza 0
      // explicita, para que pueda atenuarlo en vez de presentarlo como un hecho.
      this.latestAzimuth = 0; // No spatial information in mono: neutral, invalid.
      this.latestSpatialConfidence = 0;
    }

    const nowMs = (currentFrame / this.fs) * 1000;
    const isOnset = this.onset.update(db, this.noiseFloor.floorDb, nowMs);

    if (isOnset) {
      // Un onset no espera al siguiente tick: se emite ya.
      this.emit(true);
      // Caja negra: al detectar un evento se adjunta el audio que lo contiene,
      // para que Forensics pueda dibujar forma de onda y espectrograma reales
      // en vez de un grafico decorativo. Se reutiliza el mismo anillo de 16 kHz
      // que alimenta al clasificador, asi que no cuesta memoria adicional.
      // La instantanea NO se toma en el instante del onset: el anillo contiene
      // los 0.96 s ANTERIORES, asi que el evento quedaria pegado al borde derecho
      // y no se veria como se desarrolla. Esperando ~0.45 s el evento queda
      // aproximadamente centrado, que es lo util para analizar la forma de onda.
      if (this.emitFrames) this.snapshotDueAtFrame = currentFrame + this.fs * 0.45;
    }
  }

  /** @param {boolean} isOnset */
  emit(isOnset) {
    this.port.postMessage({
      type: 'telemetry',
      db: this.latestDb,
      peakDb: this.peakSinceEmit,
      azimuth: this.latestAzimuth,
      spatialConfidence: this.latestSpatialConfidence,
      noiseFloorDb: this.noiseFloor.floorDb,
      thresholdDb: this.onset.thresholdDb(this.noiseFloor.floorDb),
      ambientAverageDb: this.noiseFloor.ambientAverageDb,
      sessionPeakDb: this.noiseFloor.peakDb,
      risk: riskFromDb(this.latestDb),
      isOnset,
      channelCount: this.channelCount,
      // Lo observado en las muestras, que manda sobre lo que declare el navegador.
      effectiveStereo: this.effectiveStereo,
      audioTimeMs: (currentFrame / this.fs) * 1000,
    });
    this.peakSinceEmit = 0;
  }

  /**
   * Acumula audio mono a 16 kHz y emite ventanas solapadas para YAMNet.
   * @param {Float32Array} left @param {Float32Array} right @param {number} len
   */
  feedFrameBuffer(left, right, len) {
    if (this.monoScratch.length < len) this.monoScratch = new Float32Array(len);
    const mono = this.monoScratch;
    if (this.channelCount >= 2) {
      for (let i = 0; i < len; i++) mono[i] = (left[i] + right[i]) * 0.5;
    } else {
      for (let i = 0; i < len; i++) mono[i] = left[i];
    }

    const needed = Math.ceil(len / 3) + 4;
    if (this.decimScratch.length < needed) this.decimScratch = new Float32Array(needed);
    const written = this.decimator.process(
      mono.subarray(0, len),
      this.decimScratch,
      0,
    );

    // Buffer CIRCULAR: solo se avanza un indice. Desplazar el array entero por
    // cada muestra costaria 15360 escrituras x 16000 muestras/s en el hilo de
    // audio, lo que provocaria cortes; aqui el coste por muestra es constante.
    const ring = this.frameRing;
    for (let i = 0; i < written; i++) {
      ring[this.writeIdx] = this.decimScratch[i];
      this.writeIdx = (this.writeIdx + 1) % YAMNET_FRAME_SAMPLES;
      if (!this.frameReady) {
        this.frameFill++;
        if (this.frameFill >= YAMNET_FRAME_SAMPLES) this.frameReady = true;
      }
      this.samplesSinceFrame++;
    }

    if (this.frameReady && this.samplesSinceFrame >= YAMNET_HOP_SAMPLES) {
      this.samplesSinceFrame = 0;
      // Desenrolla el circular en orden cronologico: la muestra mas antigua esta
      // justo donde apunta writeIdx. Dos copias de bloque, no muestra a muestra.
      const pcm = new Float32Array(YAMNET_FRAME_SAMPLES);
      const tail = YAMNET_FRAME_SAMPLES - this.writeIdx;
      pcm.set(ring.subarray(this.writeIdx), 0);
      pcm.set(ring.subarray(0, this.writeIdx), tail);
      this.port.postMessage(
        {
          type: 'frame',
          pcm,
          sampleRate: 16000,
          azimuth: this.latestAzimuth,
          peakDb: this.latestDb,
          audioTimeMs: (currentFrame / this.fs) * 1000,
        },
        [pcm.buffer],
      );
    }
  }

  /** Copia el anillo de 16 kHz en orden cronologico y lo envia como instantanea. */
  emitSnapshot() {
    const ring = this.frameRing;
    const pcm = new Float32Array(YAMNET_FRAME_SAMPLES);
    const tail = YAMNET_FRAME_SAMPLES - this.writeIdx;
    pcm.set(ring.subarray(this.writeIdx), 0);
    pcm.set(ring.subarray(0, this.writeIdx), tail);
    this.port.postMessage(
      {
        type: 'snapshot',
        pcm,
        sampleRate: 16000,
        azimuth: this.latestAzimuth,
        peakDb: this.latestDb,
        noiseFloorDb: this.noiseFloor.floorDb,
        audioTimeMs: (currentFrame / this.fs) * 1000,
      },
      [pcm.buffer],
    );
  }

  process(inputs) {
    if (!this.running) return false;

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const left = input[0];
    const right = input.length > 1 ? input[1] : input[0];
    if (!left || left.length === 0) return true;

    // Acumula los quanta de 128 muestras hasta completar una ventana de analisis.
    for (let i = 0; i < left.length; i++) {
      this.bufL[this.fill] = left[i];
      this.bufR[this.fill] = right[i];
      this.fill++;
      if (this.fill === FRAME_SIZE) {
        this.fill = 0;
        this.analyzeFrame();
      }
    }

    if (this.emitFrames) this.feedFrameBuffer(left, right, left.length);

    if (this.snapshotDueAtFrame && currentFrame >= this.snapshotDueAtFrame) {
      this.snapshotDueAtFrame = 0;
      if (this.frameReady) this.emitSnapshot();
    }

    const nowMs = (currentFrame / this.fs) * 1000;
    if (nowMs - this.lastEmitMs >= EMIT_INTERVAL_MS) {
      this.lastEmitMs = nowMs;
      this.emit(false);
    }

    return true;
  }
}

registerProcessor('jacobs-issue-dsp', JacobsIssueDspProcessor);
