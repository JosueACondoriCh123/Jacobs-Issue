import { classify, setClassifierEngine, useNeuralBackend } from './classify';
import type { SimpleClassification } from './classify';
import type { SoundClassifier } from './types';
import { UNCLASSIFIED } from './types';

export interface LabelProviderOptions {
  classifier?: SoundClassifier;
  /** Si supera el umbral, la etiqueta se mantiene N telemetrias (suavizado). */
  holdMs?: number;
}

const DEFAULT_HOLD_MS = 1500;

/**
 * Proveedor de etiqueta viva para el publisher de Dev 2.
 *
 * Conecta el desmockeo en 2 lineas sin editar archivos de Dev 2:
 *
 *   import { createLabelProvider } from './ai'
 *   const labels = createLabelProvider()
 *   engine.onFrame(({ pcm, peakDb }) => labels.push(pcm, peakDb))
 *   engine.onTelemetry((t) => publisher.publish(t, labels.current))
 *
 * Antes del primer frame clasificado (o si la confianza es baja),
 * `current` es "Sonido sin clasificar": el mock original se conserva como
 * estado inicial honesto, no como techo permanente.
 */
export class LabelProvider {
  private label: string = UNCLASSIFIED;
  private confidence = 0;
  private holdMs: number;
  private lastConfidentAt = 0;

  constructor(options: LabelProviderOptions = {}) {
    this.holdMs = options.holdMs ?? DEFAULT_HOLD_MS;
    if (options.classifier) setClassifierEngine(options.classifier);
  }

  /** Etiqueta vigente para publisher.publish(t, labels.current). */
  get current(): string {
    if (
      this.label !== UNCLASSIFIED &&
      Date.now() - this.lastConfidentAt > this.holdMs
    ) {
      this.label = UNCLASSIFIED;
      this.confidence = 0;
    }
    return this.label;
  }

  get currentConfidence(): number {
    return this.confidence;
  }

  /** Clasifica una ventana y actualiza la etiqueta si supera el umbral. */
  push(pcm: Float32Array, peakDb = 60): SimpleClassification {
    const result = classify(pcm, peakDb);
    if (result.confident) {
      this.label = result.label;
      this.confidence = result.confidence;
      this.lastConfidentAt = Date.now();
    }
    return result;
  }

  /** Conecta un YAMNet cargado; cae al heuristico hasta que este listo. */
  useNeuralBackend(
    neural: { classify(pcm: Float32Array): { yamnetLabel: string; confidence: number }[]; isLoaded: boolean },
  ): void {
    useNeuralBackend(neural);
  }

  reset(): void {
    this.label = UNCLASSIFIED;
    this.confidence = 0;
    this.lastConfidentAt = 0;
  }
}

export function createLabelProvider(options?: LabelProviderOptions): LabelProvider {
  return new LabelProvider(options);
}
