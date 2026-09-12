import { HeuristicClassifier } from './heuristicClassifier';
import { resolvePrediction } from './riskMapper';
import { CONFIDENCE_THRESHOLD, UNCLASSIFIED } from './types';
import type { RiskLevel, SoundClassifier } from './types';

export interface SimpleClassification {
  /** Etiqueta HUD en español, lista para publisher.publish(t, label). */
  label: string;
  confidence: number;
  yamnetLabel: string;
  risk: RiskLevel;
  /** true cuando supera el umbral de contrato (>0.80). */
  confident: boolean;
}

const singleton = new HeuristicClassifier();

/**
 * classify(pcm) -> {label, confidence}. La funcion que desmockea
 * "Sonido sin clasificar".
 *
 * 100% local, sin API key, sin red, sin TF.js instalado: corre el
 * clasificador por defecto de Dev 4 sobre la ventana YAMNet de 15360
 * muestras @ 16 kHz y devuelve la etiqueta HUD en español.
 *
 * Cuando el YAMNet real este cargado (ver yamnetClassifier.ts), este mismo
 * nombre delegara en el sin cambiar a sus llamadores: sustituye el motor
 * con setClassifierEngine().
 */
export type ClassifyEngine = (pcm: Float32Array) => { yamnetLabel: string; confidence: number }[];

let engine: ClassifyEngine = (pcm) => singleton.classify(pcm);

export function setClassifierEngine(next: ClassifyEngine | SoundClassifier): void {
  engine =
    typeof next === 'function' ? next : (pcm) => (next as SoundClassifier).classify(pcm);
}

/** Conecta un backend async (YAMNet) preservando el heuristico como respaldo. */
export function useNeuralBackend(
  neural: { classify(pcm: Float32Array): { yamnetLabel: string; confidence: number }[]; isLoaded: boolean },
): void {
  const fallback = engine;
  engine = (pcm) => {
    if (neural.isLoaded) return neural.classify(pcm);
    return fallback(pcm);
  };
}

export function classify(pcm: Float32Array, peakDb = 60): SimpleClassification {
  let top: { yamnetLabel: string; confidence: number } | undefined;
  try {
    top = engine(pcm)[0];
  } catch {
    top = undefined;
  }
  if (!top || !(top.confidence > CONFIDENCE_THRESHOLD)) {
    return {
      label: UNCLASSIFIED,
      confidence: top?.confidence ?? 0,
      yamnetLabel: top?.yamnetLabel ?? 'Noise',
      risk: resolvePrediction(top?.yamnetLabel ?? 'Noise', peakDb).risk,
      confident: false,
    };
  }
  const { es, risk } = resolvePrediction(top.yamnetLabel, peakDb);
  return {
    label: es,
    confidence: top.confidence,
    yamnetLabel: top.yamnetLabel,
    risk,
    confident: true,
  };
}

/** Atajo para el caso mas comun: solo la etiqueta viva. */
export function classifyLabel(pcm: Float32Array, peakDb = 60): string {
  return classify(pcm, peakDb).label;
}
