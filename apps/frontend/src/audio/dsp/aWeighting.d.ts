/** Ponderacion A (IEC 61672) como cascada de tres biquads, normalizada a 0 dB en 1 kHz. */
export class AWeightingFilter {
  constructor(sampleRate: number);
  readonly gain: number;
  /** Procesa una muestra manteniendo el estado del filtro. */
  process(x: number): number;
  /** Procesa un bloque y devuelve su RMS y pico ponderados en A. */
  processBlockStats(block: Float32Array): { rms: number; peak: number };
  reset(): void;
  /** Respuesta de la cascada en dB. Usado por la verificacion offline. */
  responseDb(freqHz: number, sampleRate: number): number;
}
