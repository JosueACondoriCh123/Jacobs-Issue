/**
 * Frontend log-mel de YAMNet, cero dependencias, espejo fiel de
 * tensorflow/models/research/audioset/yamnet/features.py.
 *
 * Cadena: PCM 16 kHz mono -> STFT (ventana 25 ms, hop 10 ms, Hann
 * periodica) -> espectro de magnitudes -> 64 bandas mel (125-7500 Hz,
 * formula HTK) -> log(mel + 0.001) -> framing en parches 96x64 con 50%
 * de solape (0.96 s por parche, hop 0.48 s).
 *
 * La ventana de Dev 2 (15360 muestras = 0.96 s) produce exactamente UN
 * parche de 96 frames: STFT da (15360-400)/160+1 = 94 frames + padding
 * a 96, igual que wave_to_examples() con pad. Listo para el grafo TF.js
 * sin tocar el DSP de Dev 2 ni el worklet.
 */

export const YAMNET_SR = 16000;
export const YAMNET_WINDOW_SAMPLES = 15360;
export const STFT_WINDOW = 400;
export const STFT_HOP = 160;
export const N_MEL = 64;
export const N_FRAME = 96;
export const MEL_MIN_HZ = 125;
export const MEL_MAX_HZ = 7500;
export const LOG_OFFSET = 0.001;

/** Hann PERIODICA de 400 (no la simetrica de numpy.hanning por defecto). */
export function periodicHann(length: number): Float64Array {
  const w = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / length);
  }
  return w;
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

/** Banco de filtros triangulares 64x201 (la mitad positiva de la FFT-512). */
let cachedMelMatrix: Float64Array[] | null = null;

export function melFilterbank(): Float64Array[] {
  if (cachedMelMatrix) return cachedMelMatrix;
  const fftBins = STFT_WINDOW / 2 + 1;
  const melLow = hzToMel(MEL_MIN_HZ);
  const melHigh = hzToMel(MEL_MAX_HZ);
  const melPoints: number[] = [];
  for (let i = 0; i < N_MEL + 2; i++) {
    melPoints.push(melLow + ((melHigh - melLow) * i) / (N_MEL + 1));
  }
  const hzPoints = melPoints.map(melToHz);
  const binPoints = hzPoints.map((hz) => (hz * STFT_WINDOW) / YAMNET_SR);
  const bank: Float64Array[] = [];
  for (let m = 0; m < N_MEL; m++) {
    const filt = new Float64Array(fftBins);
    const f0 = binPoints[m];
    const f1 = binPoints[m + 1];
    const f2 = binPoints[m + 2];
    for (let k = 0; k < fftBins; k++) {
      if (k >= f0 && k <= f1 && f1 > f0) filt[k] = (k - f0) / (f1 - f0);
      else if (k >= f1 && k <= f2 && f2 > f1) filt[k] = (f2 - k) / (f2 - f1);
    }
    bank.push(filt);
  }
  cachedMelMatrix = bank;
  return bank;
}

/** Magnitud de la DFT de 512 puntos para un frame real (fuerza bruta). */
function magnitudeSpectrum(frame: Float64Array): Float64Array {
  const bins = STFT_WINDOW / 2 + 1;
  const out = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    let re = 0;
    let im = 0;
    const ang = (-2 * Math.PI * k) / STFT_WINDOW;
    for (let n = 0; n < STFT_WINDOW; n++) {
      const x = frame[n];
      if (x === 0) continue;
      re += x * Math.cos(ang * n);
      im += x * Math.sin(ang * n);
    }
    out[k] = Math.sqrt(re * re + im * im);
  }
  return out;
}

/**
 * Log-mel de toda la forma de onda: filas = frames STFT de 10 ms.
 * Equivale a features.py::waveform_to_log_mel_spectrogram().
 */
export function waveformToLogMel(pcm: Float32Array): Float64Array[] {
  const window = periodicHann(STFT_WINDOW);
  const bank = melFilterbank();
  const frames: Float64Array[] = [];
  for (let start = 0; start + STFT_WINDOW <= pcm.length; start += STFT_HOP) {
    const frame = new Float64Array(STFT_WINDOW);
    for (let n = 0; n < STFT_WINDOW; n++) frame[n] = pcm[start + n] * window[n];
    const mag = magnitudeSpectrum(frame);
    const mel = new Float64Array(N_MEL);
    for (let m = 0; m < N_MEL; m++) {
      let acc = 0;
      const filt = bank[m];
      for (let k = 0; k < mag.length; k++) acc += mag[k] * filt[k];
      mel[m] = Math.log(acc + LOG_OFFSET);
    }
    frames.push(mel);
  }
  return frames;
}

/**
 * Parche 96x64 listo para el grafo. Equivale a
 * features.py::waveform_to_examples(): divide en ejemplos no solapados de
 * 96 frames; si sobra menos de un parche se descarta, si la forma es mas
 * corta se rellena con ceros.
 */
export function waveformToExamples(pcm: Float32Array): Float32Array[] {
  const logMel = waveformToLogMel(pcm);
  const patches: Float32Array[] = [];
  let offset = 0;
  while (offset + N_FRAME <= logMel.length) {
    const patch = new Float32Array(N_FRAME * N_MEL);
    for (let f = 0; f < N_FRAME; f++) patch.set(logMel[offset + f], f * N_MEL);
    patches.push(patch);
    offset += N_FRAME;
  }
  if (offset === 0) {
    const patch = new Float32Array(N_FRAME * N_MEL);
    for (let f = 0; f < logMel.length && f < N_FRAME; f++) {
      patch.set(logMel[f], f * N_MEL);
    }
    patches.push(patch);
  }
  return patches;
}

/** Un solo parche aplanado para la ventana estandar de 0.96 s. */
export function frameToPatch(pcm: Float32Array): Float32Array {
  return waveformToExamples(pcm)[0];
}
