/**
 * Diezmado 48 kHz -> 16 kHz con FIR antialias, para alimentar a YAMNet.
 * Mantiene estado entre llamadas: se puede usar en streaming.
 */
export class Decimator48to16 {
  constructor();
  /** Devuelve cuantas muestras a 16 kHz se escribieron en `out`. */
  process(input: Float32Array, out: Float32Array, outOffset: number): number;
  reset(): void;
}
