import type { RiskLevel } from '../types/hud';

export type { RiskLevel };

/** Umbral de ingesta acordado: solo se persiste si confidence supera el 80%. */
export const CONFIDENCE_THRESHOLD = 0.8;

/** Etiqueta vigente mientras Dev 4 no ha clasificado nada (la misma que usa Dev 2). */
export const UNCLASSIFIED = 'Sonido sin clasificar';

/**
 * Ventana de audio para el clasificador. Estructuralmente compatible con el
 * DspAudioFrame de Dev 2 (`engine.onFrame((f) => bridge.handleFrame(f))`)
 * sin importar su codigo: acoplamiento cero, cero conflictos de fusion.
 */
export interface ClassifierFrame {
  pcm: Float32Array;
  sampleRate: number;
  azimuth: number;
  peakDb: number;
  audioTimeMs: number;
}

/** Prediccion con etiqueta en vocabulario YAMNet (ingles, clave de labels.ts). */
export interface RankedPrediction {
  yamnetLabel: string;
  confidence: number;
}

/** Resultado tras puerta de confianza, mapeo de riesgo e intento de ingesta. */
export interface ClassificationResult {
  label: string;
  yamnetLabel: string;
  confidence: number;
  risk: RiskLevel;
  decibels: number;
  azimuth: number;
  model: string;
  persisted: boolean;
}

/** Contrato que cumplen el heuristico local y el futuro YAMNet real. */
export interface SoundClassifier {
  readonly modelName: string;
  classify(pcm: Float32Array): RankedPrediction[];
}

/** Clasificador con motor neuronal opcional cargable bajo demanda. */
export interface AsyncSoundClassifier extends SoundClassifier {
  classifyAsync(pcm: Float32Array, features?: Float32Array): Promise<RankedPrediction[]>;
  readonly isLoaded: boolean;
  load(opts?: {
    modelUrl?: string;
    onProgress?: (p: YamnetLoadProgress) => void;
  }): Promise<void>;
}

/** Backend activo del puente: heuristico local o red neuronal en device. */
export type ClassifyBackendKind = 'heuristic' | 'yamnet';

export interface YamnetLoadProgress {
  phase: 'tfjs' | 'weights' | 'ready';
  progress: number;
}

/** Constantes del contrato YAMNet compartidas por features/clasificador. */
export const YAMNET_SAMPLES = 15360;
export const YAMNET_SAMPLE_RATE = 16000;
export const YAMNET_CLASSES = 521;

export interface BridgeStats {
  framesSeen: number;
  confident: number;
  inserted: number;
  droppedLowConf: number;
  persistErrors: number;
  lastLabel: string;
  lastConfidence: number;
}
