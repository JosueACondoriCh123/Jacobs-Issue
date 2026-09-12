/** Potencia de 2 igual o mayor que n. */
export function nextPow2(n: number): number;

/** FFT radix-2 in-place. `inverse` aplica ademas el escalado 1/N. */
export function fft(re: Float64Array, im: Float64Array, inverse?: boolean): void;

/** Ventana de Hann de longitud n. */
export function hannWindow(n: number): Float64Array;
