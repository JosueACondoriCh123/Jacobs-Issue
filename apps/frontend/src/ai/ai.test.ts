import { describe, expect, it, vi } from 'vitest';
import { ClassifierBridge } from './classifierBridge';
import { classify, classifyLabel, setClassifierEngine, useNeuralBackend } from './classify';
import { frameToPatch, melFilterbank, periodicHann, waveformToExamples, waveformToLogMel } from './features';
import { N_FRAME, N_MEL } from './features';
import { HeuristicClassifier } from './heuristicClassifier';
import { createMemoryPersist } from './ingestClient';
import type { PersistedRow } from './ingestClient';
import { createLabelProvider } from './labelProvider';
import { lookupYamnetLabel } from './labels';
import { resolvePrediction, riskFromDb } from './riskMapper';
import { scoresToRankedAsync, YamnetClassifier, parseClassMapCsv } from './yamnetClassifier';
import { CONFIDENCE_THRESHOLD } from './types';
import {
  buildWavPcm16Mono,
  parseWavToMono16k,
  runWavThroughBridge,
  sliceYamnetWindows,
  synthImpulse,
  synthSilence,
  synthSpeechLike,
  synthTone,
} from './wavHarness';

const FRAME = { azimuth: 30, peakDb: 60, audioTimeMs: 0, sampleRate: 16000 };

function bridgeWithMemory(sink: PersistedRow[], dedupeMs = 0) {
  return new ClassifierBridge({ persist: createMemoryPersist(sink), dedupeMs });
}

describe('dev4 confidence gate (contrato >0.80)', () => {
  it('persiste el fixture de sirena y conserva dB + azimut', async () => {
    const sink: PersistedRow[] = [];
    const b = bridgeWithMemory(sink);
    const r = await b.handleFrame({ pcm: synthTone(1800, 0.5), ...FRAME, peakDb: 96.5 });
    expect(r?.yamnetLabel).toBe('Siren');
    expect(r?.persisted).toBe(true);
    expect(r && r.confidence).toBeGreaterThan(CONFIDENCE_THRESHOLD);
    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({
      sound_label: 'Sirena de emergencia',
      risk_level: 'CRITICAL',
      decibels: 96.5,
      azimuth_angle: 30,
    });
  });

  it('descarta ruido ambiental bajo confianza sin persistir', async () => {
    const sink: PersistedRow[] = [];
    const b = bridgeWithMemory(sink);
    const low = new Float32Array(15360).fill(0.001);
    const r = await b.handleFrame({ pcm: low, ...FRAME });
    expect(r).toBeNull();
    expect(sink).toHaveLength(0);
    expect(b.currentLabel).toBe('Sonido sin clasificar');
    expect(b.snapshot.droppedLowConf).toBe(1);
  });
});

describe('dev4 mapeo semantico de riesgo', () => {
  it('alarma a 65 dB sigue siendo CRITICAL (override semantico)', () => {
    expect(resolvePrediction('Fire alarm', 65)).toMatchObject({
      es: 'Alarma de incendio',
      risk: 'CRITICAL',
    });
  });

  it('bocina a 60 dB sube el piso a ADVISORY', () => {
    expect(resolvePrediction('Vehicle horn, car horn, honking', 60).risk).toBe('ADVISORY');
  });

  it('etiqueta desconocida cae a fallback sin mentir', () => {
    expect(lookupYamnetLabel('Teleportation hum')).toBeNull();
    expect(resolvePrediction('Teleportation hum', 75)).toMatchObject({
      es: 'Sonido sin clasificar',
      risk: 'ADVISORY',
    });
  });

  it('riskFromDb respeta los umbrales 70/85 de los fixtures', () => {
    expect(riskFromDb(52.4)).toBe('NORMAL');
    expect(riskFromDb(78.2)).toBe('ADVISORY');
    expect(riskFromDb(96.5)).toBe('CRITICAL');
  });
});

describe('dev4 antirrebote', () => {
  it('misma etiqueta dentro de la ventana no reinserta', async () => {
    const sink: PersistedRow[] = [];
    const b = bridgeWithMemory(sink, 60_000);
    const frame = { pcm: synthTone(1800, 0.5), ...FRAME, peakDb: 96.5 };
    await b.handleFrame(frame);
    const r2 = await b.handleFrame(frame);
    expect(sink).toHaveLength(1);
    expect(r2?.persisted).toBe(false);
  });
});

describe('dev4 puente expone etiqueta viva para el publisher', () => {
  it('currentLabel alimenta publisher.publish(t, bridge.currentLabel)', async () => {
    const sink: PersistedRow[] = [];
    const b = bridgeWithMemory(sink);
    expect(b.currentLabel).toBe('Sonido sin clasificar');
    await b.handleFrame({ pcm: synthSpeechLike(), ...FRAME, peakDb: 62 });
    expect(b.currentLabel).toBe('Voz / conversación');
  });
});

describe('dev4 harness WAV (entorno de pruebas asignado)', () => {
  it('ventanas YAMNet con 50% de solape', () => {
    const pcm = new Float32Array(15360 + 7680).fill(0.01);
    const wins = sliceYamnetWindows(pcm);
    expect(wins).toHaveLength(2);
    expect(wins[0].pcm).toHaveLength(15360);
    expect(wins[1].audioTimeMs).toBeCloseTo(480, 0);
  });

  it('parser WAV mono 16-bit + remuestreo a 16 kHz', () => {
    const tone8k = new Float32Array(8000);
    for (let i = 0; i < tone8k.length; i++) tone8k[i] = Math.sin((2 * Math.PI * 440 * i) / 8000);
    const wav = buildWavPcm16Mono(tone8k, 8000);
    const { pcm, info } = parseWavToMono16k(wav);
    expect(info.sampleRate).toBe(8000);
    expect(pcm.length).toBe(16000);
  });

  it('WAV de silencio end-to-end persiste Silence', async () => {
    const sink: PersistedRow[] = [];
    const b = bridgeWithMemory(sink);
    const wav = buildWavPcm16Mono(synthSilence(16000), 16000);
    const { windows, results } = await runWavThroughBridge(wav, b, { peakDb: 35 });
    expect(windows).toBeGreaterThanOrEqual(1);
    expect(results).toBeGreaterThanOrEqual(1);
    expect(sink[0].sound_label).toBe('Silencio');
  });

  it('impulso agudo clasifica golpe o cristal con confianza de contrato', () => {
    const c = new HeuristicClassifier();
    const [top] = c.classify(synthImpulse());
    expect(['Glass', 'Thump, thud']).toContain(top.yamnetLabel);
    expect(top.confidence).toBeGreaterThan(CONFIDENCE_THRESHOLD);
  });
});

describe('dev4 compatibilidad de fixtures backend', () => {
  it('filas persistidas calzan columnas de acoustic_event_logs', async () => {
    const sink: PersistedRow[] = [];
    const b = bridgeWithMemory(sink);
    await b.handleFrame({ pcm: synthTone(1800, 0.5), ...FRAME, peakDb: 78.2, azimuth: 85 });
    const row = sink[0];
    for (const col of ['sound_label', 'confidence', 'decibels', 'risk_level', 'azimuth_angle']) {
      expect(row).toHaveProperty(col);
    }
  });

  it('fallo de persistencia no rompe la etiqueta viva', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = new ClassifierBridge({
      persist: async () => {
        throw new Error('supabase caido');
      },
      dedupeMs: 0,
    });
    const r = await b.handleFrame({ pcm: synthTone(1800, 0.5), ...FRAME, peakDb: 96.5 });
    expect(r?.label).toBe('Sirena de emergencia');
    expect(b.snapshot.persistErrors).toBe(1);
    vi.restoreAllMocks();
  });
});

describe('dev4 classify(pcm): desmockeo sin API key', () => {
  it('devuelve etiqueta HUD en español con confianza de contrato', () => {
    const r = classify(synthTone(1800, 0.5), 96.5);
    expect(r.confident).toBe(true);
    expect(r.label).toBe('Sirena de emergencia');
    expect(r.confidence).toBeGreaterThan(CONFIDENCE_THRESHOLD);
    expect(r.risk).toBe('CRITICAL');
  });

  it('bajo umbral conserva el mock original como estado honesto', () => {
    const r = classify(new Float32Array(15360).fill(0.001), 60);
    expect(r.confident).toBe(false);
    expect(r.label).toBe('Sonido sin clasificar');
  });

  it('classifyLabel es el atajo directo para el publisher', () => {
    expect(classifyLabel(synthSpeechLike(), 62)).toBe('Voz / conversación');
    expect(classifyLabel(new Float32Array(15360).fill(0.001))).toBe('Sonido sin clasificar');
  });

  it('setClassifierEngine permite inyectar un motor sin tocar llamadores', () => {
    setClassifierEngine(() => [{ yamnetLabel: 'Dog', confidence: 0.95 }]);
    try {
      expect(classify(new Float32Array(15360), 60).label).toBe('Ladrido');
    } finally {
      setClassifierEngine(new HeuristicClassifier());
    }
  });

  it('useNeuralBackend delega cuando esta listo y cae al local si no', () => {
    const neural = {
      isLoaded: false,
      classify: (_pcm: Float32Array) => [{ yamnetLabel: 'Siren', confidence: 0.99 }],
    };
    useNeuralBackend(neural);
    expect(classify(synthSpeechLike(), 62).label).toBe('Voz / conversación');
    neural.isLoaded = true;
    expect(classify(synthSpeechLike(), 96.5).label).toBe('Sirena de emergencia');
    setClassifierEngine(new HeuristicClassifier());
  });
});

describe('dev4 LabelProvider para publisher.publish(t, labels.current)', () => {
  it('arranca en mock y desmockea tras el primer frame confiado', () => {
    const labels = createLabelProvider();
    expect(labels.current).toBe('Sonido sin clasificar');
    labels.push(synthSpeechLike(), 62);
    expect(labels.current).toBe('Voz / conversación');
  });

  it('ignora frames de baja confianza sin revertir la etiqueta', () => {
    const labels = createLabelProvider({ holdMs: 60_000 });
    labels.push(synthSpeechLike(), 62);
    labels.push(new Float32Array(15360).fill(0.001), 60);
    expect(labels.current).toBe('Voz / conversación');
  });
});

describe('dev4 frontend log-mel YAMNet (espejo de features.py)', () => {
  it('ventana 25ms periodica: Hann(400)[0]=0 y pico central ~1', () => {
    const w = periodicHann(400);
    expect(w[0]).toBeCloseTo(0, 10);
    expect(w[200]).toBeCloseTo(1, 10);
    expect(w).toHaveLength(400);
  });

  it('banco mel 64 bandas x 201 bins con energia positiva', () => {
    const bank = melFilterbank();
    expect(bank).toHaveLength(64);
    expect(bank[0]).toHaveLength(201);
    expect(bank.flatMap((f) => Array.from(f)).some((v) => v > 0)).toBe(true);
  });

  it('0.96 s produce 94 frames STFT y 1 parche 96x64 con padding', () => {
    const logMel = waveformToLogMel(synthTone(440, 0.4));
    expect(logMel).toHaveLength(94);
    expect(logMel[0]).toHaveLength(64);
    const patches = waveformToExamples(synthTone(440, 0.4));
    expect(patches).toHaveLength(1);
    expect(patches[0]).toHaveLength(N_FRAME * N_MEL);
    expect(frameToPatch(synthTone(440, 0.4))).toHaveLength(96 * 64);
  });

  it('tono 440 Hz concentra energia melodica distinta al silencio', () => {
    const tone = waveformToLogMel(synthTone(440, 0.5));
    const quiet = waveformToLogMel(new Float32Array(15360).fill(1e-6));
    const energy = (frames: Float64Array[]): number =>
      frames.flatMap((f) => Array.from(f)).reduce((a, v) => a + v, 0) / (frames.length * 64);
    expect(energy(tone)).toBeGreaterThan(energy(quiet));
  });
});

describe('dev4 grafo YAMNet TF.js (sin TF.js instalado)', () => {
  it('load() falla limpio cuando TF.js no esta instalado', async () => {
    const c = new YamnetClassifier();
    await expect(c.load()).rejects.toThrow(/TF\.js no instalado/);
    expect(c.isLoaded).toBe(false);
  });

  it('classify() exige load() previo', () => {
    const c = new YamnetClassifier();
    expect(() => c.classify(new Float32Array(15360))).toThrow(/load\(\)/);
  });

  it('parseClassMapCsv respeta indices y comas entrecomilladas', () => {
    const csv = 'index,mid,display_name\n0,/m/09x0r,Speech\n302,/m/0912c9,"Vehicle horn, car horn, honking"\n521,/m/07hvw1,Field recording\n';
    const names = parseClassMapCsv(csv);
    expect(names[0]).toBe('Speech');
    expect(names[302]).toBe('Vehicle horn, car horn, honking');
    expect(names[521]).toBe('Field recording');
  });

  it('scoresToRankedAsync ordena 521 scores y libera el tensor', async () => {
    const scores = new Float32Array(521).fill(0.01);
    scores[302] = 0.93;
    let disposed = false;
    const ranked = await scoresToRankedAsync(
      { data: async () => scores, dispose: () => { disposed = true; } },
      Array.from({ length: 521 }, (_, i) => (i === 302 ? 'Vehicle horn, car horn, honking' : `class_${i}`)),
    );
    expect(ranked[0].yamnetLabel).toBe('Vehicle horn, car horn, honking');
    expect(ranked[0].confidence).toBeCloseTo(0.93, 5);
    expect(ranked).toHaveLength(521);
    expect(disposed).toBe(true);
  });
});
