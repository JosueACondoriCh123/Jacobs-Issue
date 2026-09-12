import { fft, nextPow2, hannWindow } from '../audio/dsp/fft.js'

/**
 * Utilidades de visualización de audio para Forensics y Sound Studio.
 *
 * Reutilizan la FFT del módulo de audio en lugar de traer otra librería: ya está
 * verificada (round-trip con error 2.6e-14) y evita duplicar código de DSP.
 */

/**
 * Reduce una señal larga a `buckets` pares (mín, máx) para dibujar la forma de
 * onda. Dibujar 15360 puntos en un canvas de 600 px desperdicia trabajo y además
 * pierde los picos; quedarse con el mínimo y el máximo de cada tramo los conserva.
 */
export function waveformPeaks(pcm: Float32Array, buckets: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const step = Math.max(1, Math.floor(pcm.length / buckets))
  for (let i = 0; i < pcm.length; i += step) {
    let min = Infinity
    let max = -Infinity
    const end = Math.min(i + step, pcm.length)
    for (let j = i; j < end; j++) {
      const v = pcm[j]
      if (v < min) min = v
      if (v > max) max = v
    }
    out.push([min === Infinity ? 0 : min, max === -Infinity ? 0 : max])
  }
  return out
}

export interface Spectrogram {
  /** columnas[t][f] en dB, normalizado a 0..1 para pintar. */
  columns: Float32Array[]
  bins: number
  hopSeconds: number
  maxFreqHz: number
}

/**
 * Espectrograma por STFT.
 *
 * Ventana de Hann obligatoria: sin ella la fuga espectral de la ventana
 * rectangular emborrona todo el eje de frecuencias (verificado en el módulo de
 * audio: un tono de 200 Hz llegaba a leerse como 2700 Hz).
 */
export function computeSpectrogram(
  pcm: Float32Array,
  sampleRate: number,
  windowSize = 512,
  hop = 128,
): Spectrogram {
  const n = nextPow2(windowSize)
  const win = hannWindow(windowSize)
  const columns: Float32Array[] = []
  const bins = n / 2

  const re = new Float64Array(n)
  const im = new Float64Array(n)

  for (let start = 0; start + windowSize <= pcm.length; start += hop) {
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < windowSize; i++) re[i] = pcm[start + i] * win[i]
    fft(re, im, false)

    const col = new Float32Array(bins)
    for (let k = 0; k < bins; k++) {
      const mag = Math.hypot(re[k], im[k]) / windowSize
      // Escala logarítmica: en lineal solo se vería el pico más fuerte y el
      // resto del espectro quedaría negro.
      const db = 20 * Math.log10(Math.max(mag, 1e-8))
      col[k] = Math.max(0, Math.min(1, (db + 90) / 90))
    }
    columns.push(col)
  }

  return { columns, bins, hopSeconds: hop / sampleRate, maxFreqHz: sampleRate / 2 }
}

/**
 * Envolvente por bandas en escala mel-aproximada: la "huella" que muestra Sound
 * Studio al enrolar un sonido. No pretende ser MFCC completo; es una firma
 * comparable y legible a simple vista.
 */
export function spectralSignature(pcm: Float32Array, sampleRate: number, bands = 24): Float32Array {
  const n = nextPow2(Math.min(2048, pcm.length))
  const win = hannWindow(Math.min(2048, pcm.length))
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const len = Math.min(2048, pcm.length)
  for (let i = 0; i < len; i++) re[i] = pcm[i] * win[i]
  fft(re, im, false)

  const out = new Float32Array(bands)
  const nyquist = sampleRate / 2
  const melMax = hzToMel(nyquist)
  const melMin = hzToMel(60)

  for (let b = 0; b < bands; b++) {
    const lo = melToHz(melMin + ((melMax - melMin) * b) / bands)
    const hi = melToHz(melMin + ((melMax - melMin) * (b + 1)) / bands)
    const kLo = Math.max(1, Math.floor((lo / nyquist) * (n / 2)))
    const kHi = Math.min(n / 2 - 1, Math.ceil((hi / nyquist) * (n / 2)))
    let sum = 0
    let count = 0
    for (let k = kLo; k <= kHi; k++) {
      sum += Math.hypot(re[k], im[k])
      count++
    }
    const mag = count > 0 ? sum / count : 0
    const db = 20 * Math.log10(Math.max(mag / n, 1e-8))
    out[b] = Math.max(0, Math.min(1, (db + 90) / 90))
  }
  return out
}

/** Distancia coseno entre dos firmas: 0 = idénticas, 1 = sin parecido. */
export function signatureDistance(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 1
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1)
}

/** Paleta de riesgo compartida por todas las pantallas. */
export const RISK_COLOR: Record<string, string> = {
  NORMAL: '#00ff88',
  ADVISORY: '#ffb020',
  CRITICAL: '#ff1e56',
}
