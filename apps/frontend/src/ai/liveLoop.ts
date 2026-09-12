import { classify } from './classify';
import type { SimpleClassification } from './classify';
import type { SoundClassifier } from './types';
import { UNCLASSIFIED } from './types';

export interface LiveLoopOptions {
  /** Ritmo de inferencia. El circuito pide 100 ms. */
  intervalMs?: number;
  /** Presupuesto por inferencia; si se supera, se cuenta como overrun. */
  budgetMs?: number;
  classifier?: SoundClassifier;
  /** Fuente de frames 16 kHz mono (normalmente engine.onFrame). */
  onFrame?: (listener: (pcm: Float32Array, peakDb: number) => void) => () => void;
  onResult?: (r: LiveResult) => void;
}

export interface LiveResult extends SimpleClassification {
  elapsedMs: number;
  overrun: boolean;
}

export interface LiveLoopStats {
  inferences: number;
  overruns: number;
  lastElapsedMs: number;
  lastLabel: string;
  running: boolean;
}

const DEFAULT_INTERVAL_MS = 100;
const DEFAULT_BUDGET_MS = 50;

/**
 * Circuito de datos en vivo, lado Dev 4.
 *
 * Dev 2 emite frames YAMNet (0.96 s @ 16 kHz, solape 50%) cada ~480 ms;
 * este loop muestrea la ULTIMA ventana disponible cada 100 ms y corre
 * classify() sobre ella. La inferencia heuristica cuesta <1 ms; la neuronal
 * (YAMNet TF.js, parche 96x64) ~10-30 ms en device: ambas caben en el
 * presupuesto de 50 ms por tick.
 *
 * Si un tick supera el presupuesto se cuenta como overrun y se sigue: nunca
 * se bloquea el circuito ni se acumula backlog. La persistencia e ingesta
 * (>0.80 -> acoustic_event_logs + broadcast Realtime) las hace el
 * ClassifierBridge; aqui solo va la etiqueta viva para el publisher.
 *
 * Uso (sin editar archivos de Dev 2):
 *   const loop = createLiveLoop({ onFrame: (l) => engine.onFrame(({ pcm, peakDb }) => l(pcm, peakDb)) })
 *   loop.start()
 *   engine.onTelemetry((t) => publisher.publish(t, loop.current))
 */
export class LiveInferenceLoop {
  private intervalMs: number;
  private budgetMs: number;
  private onResult: ((r: LiveResult) => void) | null;
  private subscribe: ((listener: (pcm: Float32Array, peakDb: number) => void) => () => void) | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private latest: { pcm: Float32Array; peakDb: number } | null = null;
  private label: string = UNCLASSIFIED;
  private confidence = 0;
  private inferences = 0;
  private overruns = 0;
  private lastElapsedMs = 0;

  constructor(options: LiveLoopOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
    this.onResult = options.onResult ?? null;
    this.subscribe = options.onFrame ?? null;
  }

  /** Etiqueta vigente para publisher.publish(t, loop.current). */
  get current(): string {
    return this.label;
  }

  get currentConfidence(): number {
    return this.confidence;
  }

  get stats(): LiveLoopStats {
    return {
      inferences: this.inferences,
      overruns: this.overruns,
      lastElapsedMs: this.lastElapsedMs,
      lastLabel: this.label,
      running: this.timer !== null,
    };
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** Empuja un frame manualmente (tests, harness WAV, o cableado directo). */
  push(pcm: Float32Array, peakDb = 60): LiveResult {
    const start = performance.now();
    const result = classify(pcm, peakDb);
    const elapsedMs = performance.now() - start;
    return this.record(result, elapsedMs);
  }

  start(): void {
    if (this.timer !== null) return;
    if (this.subscribe) {
      this.unsubscribe = this.subscribe((pcm, peakDb) => {
        this.latest = { pcm, peakDb };
      });
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.latest = null;
  }

  private tick(): void {
    const frame = this.latest;
    if (!frame) return;
    this.latest = null;
    const start = performance.now();
    let result: SimpleClassification;
    try {
      result = classify(frame.pcm, frame.peakDb);
    } catch {
      return;
    }
    this.record(result, performance.now() - start);
  }

  private record(result: SimpleClassification, elapsedMs: number): LiveResult {
    this.inferences++;
    this.lastElapsedMs = elapsedMs;
    const overrun = elapsedMs > this.budgetMs;
    if (overrun) this.overruns++;
    if (result.confident) {
      this.label = result.label;
      this.confidence = result.confidence;
    }
    const live: LiveResult = { ...result, elapsedMs, overrun };
    this.onResult?.(live);
    return live;
  }

  reset(): void {
    this.label = UNCLASSIFIED;
    this.confidence = 0;
    this.inferences = 0;
    this.overruns = 0;
    this.lastElapsedMs = 0;
    this.latest = null;
  }
}

export function createLiveLoop(options?: LiveLoopOptions): LiveInferenceLoop {
  return new LiveInferenceLoop(options);
}
