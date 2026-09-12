import { ClassifierBridge } from './classifierBridge';
import type { ClassifierFrame } from './types';

/**
 * Harness de Dev 4 para WAVs pregrabados (entorno de pruebas asignado).
 *
 * Sin dependencias: parsea WAV PCM 8/16/32-bit int o 32-bit float, mezcla a
 * mono, remuestrea lineal a 16 kHz y trocea en ventanas YAMNet de 15360
 * muestras con 50% de solape, igual que el worklet de Dev 2.
 */

export const YAMNET_WINDOW = 15360;
export const YAMNET_HOP = 7680;
export const YAMNET_RATE = 16000;

export interface WavInfo {
  sampleRate: number;
  channels: number;
  frames: number;
  durationSec: number;
}

export function parseWavToMono16k(buf: ArrayBuffer): { pcm: Float32Array; info: WavInfo } {
  const view = new DataView(buf);
  const readAscii = (off: number, len: number): string => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
    return s;
  };
  if (readAscii(0, 4) !== 'RIFF' || readAscii(8, 4) !== 'WAVE') {
    throw new Error('wav: cabecera RIFF/WAVE no encontrada.');
  }
  let off = 12;
  let fmtChannels = 1;
  let fmtRate = YAMNET_RATE;
  let fmtBits = 16;
  let fmtFloat = false;
  let dataStart = -1;
  let dataLen = 0;
  while (off + 8 <= view.byteLength) {
    const id = readAscii(off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      const audioFmt = view.getUint16(off + 8, true);
      fmtChannels = view.getUint16(off + 10, true);
      fmtRate = view.getUint32(off + 12, true);
      fmtBits = view.getUint16(off + 22, true);
      fmtFloat = audioFmt === 3;
    } else if (id === 'data') {
      dataStart = off + 8;
      dataLen = size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (dataStart < 0) throw new Error('wav: chunk data no encontrado.');

  const bytesPerSample = fmtBits / 8;
  const totalFrames = Math.floor(dataLen / (bytesPerSample * fmtChannels));
  const mono = new Float32Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    let acc = 0;
    for (let c = 0; c < fmtChannels; c++) {
      const pos = dataStart + (f * fmtChannels + c) * bytesPerSample;
      let v = 0;
      if (fmtFloat && fmtBits === 32) v = view.getFloat32(pos, true);
      else if (fmtBits === 16) v = view.getInt16(pos, true) / 32768;
      else if (fmtBits === 8) v = (view.getUint8(pos) - 128) / 128;
      else if (fmtBits === 32) v = view.getInt32(pos, true) / 2147483648;
      else throw new Error(`wav: ${fmtBits} bits no soportado.`);
      acc += v;
    }
    mono[f] = acc / fmtChannels;
  }

  const pcm = fmtRate === YAMNET_RATE ? mono : resampleLinear(mono, fmtRate, YAMNET_RATE);
  return {
    pcm,
    info: {
      sampleRate: fmtRate,
      channels: fmtChannels,
      frames: totalFrames,
      durationSec: totalFrames / fmtRate,
    },
  };
}

export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = src - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Trocea PCM 16 kHz en ventanas solapadas listas para handleFrame(). */
export function sliceYamnetWindows(
  pcm: Float32Array,
  opts: { azimuth?: number; peakDb?: number } = {},
): ClassifierFrame[] {
  const out: ClassifierFrame[] = [];
  if (pcm.length < YAMNET_WINDOW) return out;
  let t = 0;
  for (let start = 0; start + YAMNET_WINDOW <= pcm.length; start += YAMNET_HOP) {
    out.push({
      pcm: pcm.slice(start, start + YAMNET_WINDOW),
      sampleRate: YAMNET_RATE,
      azimuth: opts.azimuth ?? 0,
      peakDb: opts.peakDb ?? 60,
      audioTimeMs: t,
    });
    t += (YAMNET_HOP / YAMNET_RATE) * 1000;
  }
  return out;
}

/** Pasa un WAV completo por el puente y devuelve filas persistidas + stats. */
export async function runWavThroughBridge(
  buf: ArrayBuffer,
  bridge: ClassifierBridge,
  opts: { azimuth?: number; peakDb?: number } = {},
): Promise<{ windows: number; results: number }> {
  const { pcm } = parseWavToMono16k(buf);
  const windows = sliceYamnetWindows(pcm, opts);
  let results = 0;
  for (const w of windows) {
    const r = await bridge.handleFrame(w);
    if (r) results++;
  }
  return { windows: windows.length, results };
}

// --- Fixtures sinteticos (sin binarios en el repo) ---------------------------

/** Silencio digital: el heuristico debe dar Silence 0.97 y persistir. */
export function synthSilence(samples = YAMNET_WINDOW): Float32Array {
  return new Float32Array(samples);
}

/** Tono sostenido (sirena): seno puro a `freq` Hz con amplitud `amp`. */
export function synthTone(freq = 1800, amp = 0.5, samples = YAMNET_WINDOW): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / YAMNET_RATE);
  }
  return out;
}

/** Voz aproximada: suma de formantes modulada en amplitud a ~4 Hz. */
export function synthSpeechLike(samples = YAMNET_WINDOW): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / YAMNET_RATE;
    const mod = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
    out[i] =
      mod *
      (0.25 * Math.sin(2 * Math.PI * 220 * t) +
        0.15 * Math.sin(2 * Math.PI * 440 * t) +
        0.08 * Math.sin(2 * Math.PI * 880 * t));
  }
  return out;
}

/** Impulso agudo (golpe/cristal): ruido de banda ancha con decaimiento. */
export function synthImpulse(samples = YAMNET_WINDOW, seed = 7): Float32Array {
  const out = new Float32Array(samples);
  let s = seed;
  const rand = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < samples; i++) {
    const env = Math.exp(-i / (samples * 0.08));
    out[i] = rand() * 2 * 0.9 * env;
  }
  return out;
}

/** Construye un WAV PCM16 mono minimo en memoria (para tests del parser). */
export function buildWavPcm16Mono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const header = 44;
  const buf = new ArrayBuffer(header + samples.length * 2);
  const v = new DataView(buf);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const c = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(header + i * 2, Math.round(c * 32767), true);
  }
  return buf;
}
