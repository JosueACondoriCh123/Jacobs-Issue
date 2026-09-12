import type { RankedPrediction, SoundClassifier } from './types';

/**
 * Clasificador de respaldo determinista para demo y pruebas sin red.
 *
 * No pretende reconocer sonidos: analiza RMS/pico/zero-crossing de la ventana
 * de 0.96 s y mapea a etiquetas PLAUSIBLES del vocabulario YAMNet. El puente
 * lo trata exactamente igual que al modelo real (misma puerta de confianza,
 * mismo mapeo de riesgo, misma ingesta), asi que la cadena end-to-end queda
 * validada antes de que el TF.js pese megabytes.
 *
 * Cuando `createYamnetClassifier()` exista, sustituye a este sin tocar nada mas.
 */
export class HeuristicClassifier implements SoundClassifier {
  readonly modelName = 'heuristic-v0.1';

  classify(pcm: Float32Array): RankedPrediction[] {
    let sumSq = 0;
    let peak = 0;
    let crossings = 0;
    const n = pcm.length;
    for (let i = 0; i < n; i++) {
      const v = pcm[i];
      sumSq += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (i > 0 && (v >= 0) !== (pcm[i - 1] >= 0)) crossings++;
    }
    const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;
    const zcr = n > 1 ? crossings / (n - 1) : 0;
    const crest = peak / (rms + 1e-12);

    // Silencio digital: no hay nada que informar.
    if (rms < 1e-4) return [{ yamnetLabel: 'Silence', confidence: 0.97 }];

    // Impulso fuerte + agudo: golpe o rotura.
    if (peak > 0.5 && zcr > 0.25) {
      return peak > 0.8
        ? [
            { yamnetLabel: 'Glass', confidence: 0.86 },
            { yamnetLabel: 'Thump, thud', confidence: 0.09 },
          ]
        : [
            { yamnetLabel: 'Thump, thud', confidence: 0.84 },
            { yamnetLabel: 'Knock', confidence: 0.1 },
          ];
    }

    // Tono sostenido (senoidal, crest ~= 1.4) con energia alta: posible
    // sirena o alarma. El ZCR solo dice la frecuencia (un seno de 1800 Hz
    // cruza 0.22 veces/muestra), asi que la pureza se mide con el crest:
    // voz es modulada (crest > 2), un seno sostenido esta en 1.2..1.7.
    if (crest < 1.7 && rms > 0.05 && peak > 0.3) {
      return [
        { yamnetLabel: 'Siren', confidence: 0.83 },
        { yamnetLabel: 'Alarm', confidence: 0.08 },
      ];
    }

    // Voz: envolvente modulada (crest alto) con energia en banda media.
    if (crest >= 1.7 && rms > 0.015 && zcr > 0.01 && zcr <= 0.35) {
      return [
        { yamnetLabel: 'Speech', confidence: 0.88 },
        { yamnetLabel: 'Crowd', confidence: 0.05 },
      ];
    }

    // Residuo ambiental por defecto, confianza baja a proposito.
    return [{ yamnetLabel: 'Noise', confidence: 0.62 }];
  }
}
