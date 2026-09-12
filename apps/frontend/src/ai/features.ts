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
  const fftBins = 512 / 2 + 1;
  const melLow = hzToMel(MEL_MIN_HZ);
  const melHigh = hzToMel(MEL_MAX_HZ);
  const melPoints: number[] = [];
  for (let i = 0; i < N_MEL + 2; i++) {
    melPoints.push(melLow + ((melHigh - melLow) * i) / (N_MEL + 1));
  }
  const bank: Float64Array[] = [];
  for (let m = 0; m < N_MEL; m++) {
    const filt = new Float64Array(fftBins);
    const f0 = melPoints[m];
    const f1 = melPoints[m + 1];
    const f2 = melPoints[m + 2];
    for (let k = 0; k < fftBins; k++) {
      const mel = hzToMel(k * YAMNET_SR / 512);
      filt[k] = k === 0 ? 0 : Math.max(0, Math.min((mel - f0) / (f1 - f0), (f2 - mel) / (f2 - f1)));
    }
    bank.push(filt);
  }
  cachedMelMatrix = bank;
  return bank;
}

/** FFT radix-2 in-place sobre (re, im). n debe ser potencia de 2. */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;
        const nxRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nxRe;
      }
    }
  }
}

/** Magnitud del espectro via FFT-512 (bins 0..256). Cuesta O(n log n). */
function magnitudeSpectrum(frame: Float64Array): Float64Array {
  const size = 512;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(frame.subarray(0, Math.min(frame.length, size)));
  fftInPlace(re, im);
  const bins = 512 / 2 + 1;
  const out = new Float64Array(bins);
  for (let k = 0; k < bins; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return out;
}

/**
 * Log-mel de toda la forma de onda: filas = frames STFT de 10 ms.
 * Equivale a features.py::waveform_to_log_mel_spectrogram().
 * La magnitud via FFT-512: el parche 96x64 completo cuesta ~10 ms
 * en hilo principal, dentro del presupuesto del circuito en vivo.
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
  // Official pad_waveform: pad PCM, not log-mel. Silence is log(0.001), not 0.
  const minimum = 15600; // 0.96 + 0.025 - 0.010 seconds at 16 kHz.
  const total = minimum + Math.ceil(Math.max(0, pcm.length - minimum) / 7680) * 7680;
  const padded = new Float32Array(total);
  padded.set(pcm);
  const logMel = waveformToLogMel(padded);
  const patches: Float32Array[] = [];
  let offset = 0;
  while (offset + N_FRAME <= logMel.length) {
    const patch = new Float32Array(N_FRAME * N_MEL);
    for (let f = 0; f < N_FRAME; f++) patch.set(logMel[offset + f], f * N_MEL);
    patches.push(patch);
    offset += N_FRAME / 2;
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
