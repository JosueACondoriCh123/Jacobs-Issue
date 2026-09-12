/**
 * Estimacion de direccion de llegada (DOA) por GCC-PHAT.
 *
 * Idea: si el sonido viene de la izquierda, llega al microfono izquierdo unos
 * microsegundos antes que al derecho. Ese retardo inter-aural (ITD) determina
 * el angulo. GCC-PHAT lo estima con robustez frente a reverberacion porque
 * normaliza el espectro cruzado en fase, descartando la magnitud: los ecos
 * alteran la amplitud mucho mas que la fase del frente de onda directo.
 *
 * LIMITACION INHERENTE, asumida y documentada: dos microfonos no resuelven la
 * ambiguedad delante/detras (un sonido a +30 y otro a 150 grados producen el
 * mismo ITD). El rango util es -90..+90 y asi se reporta.
 */

import { fft, nextPow2, hannWindow } from './fft.js';
import { clamp } from './spl.js';

export const SPEED_OF_SOUND = 343; // m/s a 20 C
/** Separacion tipica entre los microfonos de un portatil. Ajustable. */
export const DEFAULT_MIC_DISTANCE_M = 0.15;

export class GccPhatEstimator {
  /**
   * @param {object} opts
   * @param {number} opts.frameSize muestras por ventana de analisis
   * @param {number} opts.sampleRate
   * @param {number} [opts.micDistanceM]
   */
  constructor({ frameSize, sampleRate, micDistanceM = DEFAULT_MIC_DISTANCE_M }) {
    this.frameSize = frameSize;
    this.sampleRate = sampleRate;
    this.micDistanceM = micDistanceM;

    // Zero-padding al doble: sin el, la IFFT da correlacion *circular* y un
    // retardo real cerca del borde aparece envuelto en el extremo opuesto.
    this.n = nextPow2(frameSize * 2);

    this.reA = new Float64Array(this.n);
    this.imA = new Float64Array(this.n);
    this.reB = new Float64Array(this.n);
    this.imB = new Float64Array(this.n);
    this.window = hannWindow(frameSize);

    // Con 15 cm de separacion el ITD maximo fisico son ~21 muestras a 48 kHz.
    // Buscar mas alla solo invita a falsos picos de reverberacion.
    this.maxLag = Math.ceil((micDistanceM / SPEED_OF_SOUND) * sampleRate) + 2;
  }

  /**
   * @param {Float32Array} left @param {Float32Array} right
   * @returns {{ lag: number, confidence: number }} lag en muestras
   *   (positivo = canal derecho retrasado = fuente a la izquierda)
   */
  estimateLag(left, right) {
    const { n, frameSize, reA, imA, reB, imB, window } = this;

    reA.fill(0); imA.fill(0); reB.fill(0); imB.fill(0);
    for (let i = 0; i < frameSize; i++) {
      reA[i] = left[i] * window[i];
      reB[i] = right[i] * window[i];
    }

    fft(reA, imA, false);
    fft(reB, imB, false);

    // Espectro cruzado R = B * conj(A), normalizado en fase: esto es el "PHAT".
    // El orden importa y esta verificado en verify.mjs: con B*conj(A) el indice
    // del pico ES directamente el retardo del canal derecho respecto al izquierdo.
    // Con A*conj(B) sale el mismo valor con el signo invertido.
    for (let i = 0; i < n; i++) {
      const cRe = reB[i] * reA[i] + imB[i] * imA[i];
      const cIm = imB[i] * reA[i] - reB[i] * imA[i];
      const mag = Math.hypot(cRe, cIm);
      if (mag > 1e-12) {
        reA[i] = cRe / mag;
        imA[i] = cIm / mag;
      } else {
        reA[i] = 0;
        imA[i] = 0;
      }
    }

    fft(reA, imA, true);

    // Estadistica sobre TODA la correlacion, no solo sobre la ventana buscada.
    // La normalizacion PHAT blanquea el espectro, asi que incluso dos senales
    // sin relacion producen un pico local dentro de +-maxLag: comparar contra la
    // media de esa ventana no distingue nada. Contra el fondo global si.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += reA[i];
    mean /= n;
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const d = reA[i] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / n);

    // Busca el pico dentro de +-maxLag. Los lags negativos viven al final del array.
    let bestIdx = 0;
    let bestVal = -Infinity;

    for (let lag = -this.maxLag; lag <= this.maxLag; lag++) {
      const idx = lag >= 0 ? lag : n + lag;
      const v = reA[idx];
      if (v > bestVal) {
        bestVal = v;
        bestIdx = lag;
      }
    }

    // Interpolacion parabolica sobre el pico. Sin esto la resolucion angular
    // seria pesima: solo ~21 muestras cubren los 180 grados completos.
    const at = (lag) => reA[lag >= 0 ? lag : n + lag];
    let refined = bestIdx;
    if (bestIdx > -this.maxLag && bestIdx < this.maxLag) {
      const ym = at(bestIdx - 1);
      const y0 = bestVal;
      const yp = at(bestIdx + 1);
      const denom = ym - 2 * y0 + yp;
      if (Math.abs(denom) > 1e-12) {
        refined = bestIdx + (0.5 * (ym - yp)) / denom;
      }
    }

    // Confianza = cuantas desviaciones tipicas sobresale el pico sobre el fondo.
    // Una copia retardada da un impulso limpio (z del orden de sqrt(n), ~45 con
    // n=4096); ruido descorrelacionado se queda en z de un digito. El umbral de
    // 8 y la escala de 25 salen de medir ambos casos en verify.mjs.
    const z = std > 1e-12 ? (bestVal - mean) / std : 0;
    const confidence = clamp((z - 8) / 25, 0, 1);

    return { lag: refined, confidence };
  }

  /** @param {number} lagSamples @returns {number} azimut en grados, -90..+90 */
  lagToAzimuth(lagSamples) {
    const tau = lagSamples / this.sampleRate;
    const sinTheta = clamp((tau * SPEED_OF_SOUND) / this.micDistanceM, -1, 1);
    // Signo negativo: lag positivo = canal derecho retrasado = fuente a la izquierda.
    return -(Math.asin(sinTheta) * 180) / Math.PI;
  }

  /**
   * @param {Float32Array} left @param {Float32Array} right
   * @returns {{ azimuth: number, confidence: number, lag: number }}
   */
  estimate(left, right) {
    const { lag, confidence } = this.estimateLag(left, right);
    return { azimuth: this.lagToAzimuth(lag), confidence, lag };
  }
}

/**
 * Suavizado exponencial del angulo. Sin el, el HUD tiembla: cada ventana de
 * 21 ms da una estimacion ligeramente distinta y la aguja vibraria a 47 Hz.
 * El factor se pondera por la confianza, de modo que una estimacion dudosa
 * apenas mueve la aguja.
 */
export class AzimuthSmoother {
  /** @param {number} [alpha=0.35] */
  constructor(alpha = 0.35) {
    this.alpha = alpha;
    this.value = 0;
    this.initialized = false;
  }

  /** @param {number} azimuth @param {number} confidence @returns {number} */
  update(azimuth, confidence) {
    if (confidence <= 0.05) return this.value;
    const a = this.alpha * confidence;
    if (!this.initialized) {
      this.value = azimuth;
      this.initialized = true;
    } else {
      this.value = this.value + a * (azimuth - this.value);
    }
    return this.value;
  }

  reset() {
    this.value = 0;
    this.initialized = false;
  }
}

/**
 * Fallback para microfono MONO.
 *
 * No hay informacion direccional posible con un solo canal, asi que no se finge
 * tenerla: se deriva un angulo estable a partir del centroide espectral y se
 * reporta SIEMPRE con spatialConfidence = 0 para que el HUD lo atenue o lo
 * marque. Es un recurso de presentacion, no una medida.
 *
 * @param {Float32Array} mono @param {number} sampleRate
 * @returns {number} angulo estable en -90..+90
 */
const _heuristicCache = { size: 0, window: null, re: null, im: null };

export function heuristicAzimuthFromSpectrum(mono, sampleRate) {
  const n = nextPow2(mono.length);
  if (_heuristicCache.size !== mono.length) {
    _heuristicCache.size = mono.length;
    _heuristicCache.window = hannWindow(mono.length);
    _heuristicCache.re = new Float64Array(n);
    _heuristicCache.im = new Float64Array(n);
  }
  const { window: win, re, im } = _heuristicCache;
  re.fill(0);
  im.fill(0);

  // La ventana de Hann no es opcional aqui: sin ella la fuga espectral de una
  // ventana rectangular domina el calculo y el centroide de un tono de 200 Hz
  // sale por encima de 2700 Hz, con lo que todos los sonidos caerian del mismo
  // lado. Medido en verify.mjs.
  for (let i = 0; i < mono.length; i++) re[i] = mono[i] * win[i];
  fft(re, im, false);

  let num = 0;
  let den = 0;
  const half = n >> 1;
  for (let i = 1; i < half; i++) {
    const mag = Math.hypot(re[i], im[i]);
    num += ((i * sampleRate) / n) * mag;
    den += mag;
  }
  if (den < 1e-9) return 0;

  const centroid = num / den;
  // Mapea 100 Hz..6 kHz en escala log a -75..+75 grados.
  const lo = Math.log2(100);
  const hi = Math.log2(6000);
  const t = clamp((Math.log2(clamp(centroid, 100, 6000)) - lo) / (hi - lo), 0, 1);
  return (t * 2 - 1) * 75;
}
