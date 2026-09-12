import { HeuristicClassifier } from './heuristicClassifier';
import { createMemoryPersist, createSupabasePersist } from './ingestClient';
import type { PersistFn } from './ingestClient';
import { resolvePrediction } from './riskMapper';
import { CONFIDENCE_THRESHOLD, UNCLASSIFIED } from './types';
import type {
  BridgeStats,
  ClassificationResult,
  ClassifierFrame,
  SoundClassifier,
} from './types';

export interface BridgeOptions {
  classifier?: SoundClassifier;
  persist?: PersistFn;
  userId?: string | null;
  /** Antirrebote: misma etiqueta dentro de la ventana no se reinserta. */
  dedupeMs?: number;
  onResult?: (r: ClassificationResult) => void;
}

const DEFAULT_DEDUPE_MS = 2500;

/**
 * Puente Dev 4: frame (Dev 2) -> clasificacion -> Supabase (Dev 3).
 *
 * Uso:
 *   const bridge = new ClassifierBridge()
 *   await bridge.start()
 *   engine.onFrame(({ pcm, sampleRate, azimuth, peakDb, audioTimeMs }) =>
 *     bridge.handleFrame({ pcm, sampleRate, azimuth, peakDb, audioTimeMs }))
 *   engine.onTelemetry((t) => publisher.publish(t, bridge.currentLabel))
 *
 * Solo persiste si confidence > 0.80 (contrato). Por debajo, la etiqueta queda
 * como UNCLASSIFIED y Dev 2 sigue publicando nivel/direccion sin mentir.
 */
export class ClassifierBridge {
  private classifier: SoundClassifier;
  private persist: PersistFn;
  private dedupeMs: number;
  private onResult: ((r: ClassificationResult) => void) | null;
  private stats: BridgeStats = {
    framesSeen: 0,
    confident: 0,
    inserted: 0,
    droppedLowConf: 0,
    persistErrors: 0,
    lastLabel: UNCLASSIFIED,
    lastConfidence: 0,
  };
  private lastEmitKey = '';
  private lastEmitAt = 0;

  constructor(options: BridgeOptions = {}) {
    this.classifier = options.classifier ?? new HeuristicClassifier();
    this.persist =
      options.persist ?? createSupabasePersist(options.userId ?? null);
    this.dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS;
    this.onResult = options.onResult ?? null;
  }

  get modelName(): string {
    return this.classifier.modelName;
  }

  get snapshot(): BridgeStats {
    return { ...this.stats };
  }

  /** Etiqueta vigente para `publisher.publish(t, bridge.currentLabel)`. */
  get currentLabel(): string {
    return this.stats.lastLabel;
  }

  /** Compatibilidad con DspAudioFrame de Dev 2 por forma, sin importarlo. */
  async handleFrame(frame: ClassifierFrame): Promise<ClassificationResult | null> {
    this.stats.framesSeen++;
    if (frame.pcm.length !== 15360) {
      console.warn(`[dev4] frame inesperado: ${frame.pcm.length} muestras (YAMNet quiere 15360).`);
    }

    let top;
    try {
      const ranked = this.classifier.classify(frame.pcm);
      top = ranked[0];
    } catch (err) {
      console.warn('[dev4] classify fallo:', err);
      return null;
    }
    if (!top) return null;

    // Puerta de confianza del contrato: <= 0.80 no se persiste ni se etiqueta.
    if (!(top.confidence > CONFIDENCE_THRESHOLD)) {
      this.stats.droppedLowConf++;
      this.stats.lastLabel = UNCLASSIFIED;
      this.stats.lastConfidence = top.confidence;
      return null;
    }
    this.stats.confident++;

    const decibels = Math.round(frame.peakDb * 10) / 10;
    // Convencion HUD 0..360: Dev 2 manda -90..+90 en frames crudos.
    const azimuth = ((frame.azimuth % 360) + 360) % 360;
    const { es, risk } = resolvePrediction(top.yamnetLabel, decibels);

    const result: ClassificationResult = {
      label: es,
      yamnetLabel: top.yamnetLabel,
      confidence: top.confidence,
      risk,
      decibels,
      azimuth,
      model: this.classifier.modelName,
      persisted: false,
    };

    // Antirrebote: a 2 Hz la misma sirena generaria 120 filas/min sin esto.
    const key = `${es}|${risk}`;
    const now = Date.now();
    const dup = key === this.lastEmitKey && now - this.lastEmitAt < this.dedupeMs;

    this.stats.lastLabel = es;
    this.stats.lastConfidence = top.confidence;

    if (!dup) {
      try {
        const ok = await this.persist({
          sound_label: es,
          confidence: top.confidence,
          decibels,
          risk_level: risk,
          azimuth_angle: azimuth,
          metadata: {
            yamnet_label: top.yamnetLabel,
            model_version: this.classifier.modelName,
            audio_time_ms: frame.audioTimeMs,
          },
        });
        result.persisted = ok;
        if (ok) {
          this.stats.inserted++;
          this.lastEmitKey = key;
          this.lastEmitAt = now;
        } else {
          this.stats.persistErrors++;
        }
      } catch {
        this.stats.persistErrors++;
      }
    }

    this.onResult?.(result);
    return result;
  }

  resetStats(): void {
    this.stats = {
      framesSeen: 0,
      confident: 0,
      inserted: 0,
      droppedLowConf: 0,
      persistErrors: 0,
      lastLabel: UNCLASSIFIED,
      lastConfidence: 0,
    };
    this.lastEmitKey = '';
    this.lastEmitAt = 0;
  }
}

export { createMemoryPersist, createSupabasePersist };
export { CONFIDENCE_THRESHOLD, UNCLASSIFIED };
