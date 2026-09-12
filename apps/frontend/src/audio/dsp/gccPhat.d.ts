export const SPEED_OF_SOUND: number;
export const DEFAULT_MIC_DISTANCE_M: number;

export interface DoaEstimate {
  /** Grados, -90 (izquierda) .. +90 (derecha). */
  azimuth: number;
  /** 0..1. Por debajo de ~0.2 la estimacion no es fiable. */
  confidence: number;
  /** Retardo inter-aural en muestras (positivo = fuente a la izquierda). */
  lag: number;
}

/** Estimador de direccion de llegada por GCC-PHAT sobre un par estereo. */
export class GccPhatEstimator {
  constructor(opts: { frameSize: number; sampleRate: number; micDistanceM?: number });
  readonly maxLag: number;
  estimateLag(left: Float32Array, right: Float32Array): { lag: number; confidence: number };
  lagToAzimuth(lagSamples: number): number;
  estimate(left: Float32Array, right: Float32Array): DoaEstimate;
}

/** Suavizado exponencial ponderado por confianza, para que el HUD no tiemble. */
export class AzimuthSmoother {
  constructor(alpha?: number);
  readonly value: number;
  update(azimuth: number, confidence: number): number;
  reset(): void;
}

/**
 * Fallback MONO: angulo estable derivado del centroide espectral.
 * No es una medida direccional; se reporta siempre con confianza espacial 0.
 */
export function heuristicAzimuthFromSpectrum(mono: Float32Array, sampleRate: number): number;
