/**
 * Diezmado 48 kHz -> 16 kHz para el clasificador de Dev 4.
 *
 * YAMNet exige exactamente 16 kHz mono float32 en [-1, 1]. Tomar una de cada
 * tres muestras sin filtrar antes produciria aliasing: todo lo que haya por
 * encima de 8 kHz (sibilantes, cristales, alarmas agudas) se plegaria hacia
 * abajo y contaminaria el espectro que ve la red. De ahi el FIR paso-bajo.
 *
 * El filtro es un sinc enventanado con Hann, calculado una vez en el constructor.
 */

const DECIMATION = 3; // 48000 / 16000
const NUM_TAPS = 61; // orden par de retardo; suficiente para ~60 dB de rechazo
const CUTOFF_HZ = 7200; // margen bajo los 8 kHz de Nyquist del destino

export class Decimator48to16 {
  constructor() {
    this.taps = buildLowpass(NUM_TAPS, CUTOFF_HZ, 48000);
    this.history = new Float32Array(NUM_TAPS);
    this.phase = 0;
  }

  /**
   * Procesa muestras a 48 kHz y escribe las de 16 kHz en `out`.
   * @param {Float32Array} input
   * @param {Float32Array} out buffer destino
   * @param {number} outOffset
   * @returns {number} numero de muestras escritas en `out`
   */
  process(input, out, outOffset) {
    const { taps, history } = this;
    const n = taps.length;
    let written = 0;

    for (let i = 0; i < input.length; i++) {
      // Desplaza la historia e inserta la muestra nueva.
      history.copyWithin(0, 1);
      history[n - 1] = input[i];

      this.phase++;
      if (this.phase === DECIMATION) {
        this.phase = 0;
        let acc = 0;
        for (let k = 0; k < n; k++) acc += history[k] * taps[k];
        if (outOffset + written < out.length) {
          out[outOffset + written] = acc;
          written++;
        }
      }
    }

    return written;
  }

  reset() {
    this.history.fill(0);
    this.phase = 0;
  }
}

/**
 * Sinc enventanado con Hann, normalizado a ganancia unidad en continua.
 * @param {number} numTaps @param {number} cutoffHz @param {number} sampleRate
 * @returns {Float32Array}
 */
function buildLowpass(numTaps, cutoffHz, sampleRate) {
  const taps = new Float32Array(numTaps);
  const fc = cutoffHz / sampleRate; // normalizada, 0..0.5
  const mid = (numTaps - 1) / 2;
  let sum = 0;

  for (let i = 0; i < numTaps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (numTaps - 1));
    const v = sinc * win;
    taps[i] = v;
    sum += v;
  }

  for (let i = 0; i < numTaps; i++) taps[i] /= sum;
  return taps;
}
