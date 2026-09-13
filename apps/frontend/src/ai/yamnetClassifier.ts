import type {
  AsyncSoundClassifier,
  ClassifyBackendKind,
  RankedPrediction,
  YamnetLoadProgress,
} from './types';
import { YAMNET_CLASSES, YAMNET_SAMPLE_RATE, YAMNET_SAMPLES } from './types';
import { frameToPatch } from './features';

interface TfTensor {
  dispose(): void;
  data(): Promise<Float32Array | Int32Array | Uint8Array>;
}

interface TfLayersModel {
  predict(inputs: unknown): unknown;
  execute(inputs: unknown, outputs?: string | string[]): unknown;
  executeAsync?(inputs: unknown, outputs?: string | string[]): Promise<unknown>;
  dispose(): void;
}

interface TfGraphModel {
  execute?(inputs: unknown, outputs?: string | string[]): unknown;
  executeAsync(inputs: unknown, outputs?: string | string[]): Promise<unknown>;
  dispose(): void;
}

interface TfLike {
  tensor(data: Float32Array, shape: number[]): TfTensor;
  loadGraphModel(url: string, opts?: Record<string, unknown>): Promise<TfGraphModel>;
  loadLayersModel(url: string): Promise<TfLayersModel>;
  setBackend(name: string): Promise<boolean>;
  ready(): Promise<void>;
}

export const YAMNET_TFHUB_URL = 'https://tfhub.dev/google/yamnet/1';
export const YAMNET_LOCAL_MODEL_URL = 'models/yamnet/model.json';



/**
 * Convierte yamnet_class_map.csv (index,mid,display_name) en array de 521
 * display_name ordenado por indice. Acepta comillas CSV en nombres con coma.
 */
export function parseClassMapCsv(csv: string): string[] {
  const lines = csv.split(/\r?\n/);
  const names: string[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const m = line.match(/^(\d+),([^,]+),(.*)$/);
    if (!m) continue;
    const idx = Number(m[1]);
    let name = m[3].trim();
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1).replace(/""/g, '"');
    }
    names[idx] = name;
  }
  return names;
}

/**
 * YAMNet real sobre TF.js, formato layers-model autohospedado.
 *
 * Arquitectura del modelo: log-mel 96x64 -> depthwise separable convs
 * (MobileNet v1) -> embedding 1024 -> densa sigmoide de 521 clases.
 * El frontend de caracteristicas (STFT 25ms/hop 10ms, mel 125-7500 Hz,
 * log+0.001, framing 0.96 s) vive en features.ts con cero dependencias,
 * asi que este modulo solo ejecuta el grafo y ordena scores.
 *
 * Sin import estatico de TF.js: el bundle NO crece hasta que alguien llama
 * a load(). Sin modelo descargado, load() falla limpio y el puente sigue
 * sin clasificación. Sin API key: todo corre en el dispositivo.
 */
export class YamnetClassifier implements AsyncSoundClassifier {
  readonly modelName = 'yamnet-tfjs-v1';
  private tf: TfLike | null = null;
  private model: TfLayersModel | TfGraphModel | null = null;
  private backend: ClassifyBackendKind = 'heuristic';
  private labels: string[] = [];

  get isLoaded(): boolean {
    return this.model !== null;
  }

  get activeBackend(): ClassifyBackendKind {
    return this.backend;
  }

  async load(opts: {
    modelUrl?: string;
    onProgress?: (p: YamnetLoadProgress) => void;
  } = {}): Promise<void> {
    const report = opts.onProgress ?? ((): void => {});
    report({ phase: 'tfjs', progress: 0 });
    let tf: TfLike;
    try {
      const mod = (await import('@tensorflow/tfjs')) as unknown as Record<string, unknown>;
      tf = (mod.default ?? mod) as TfLike;
    } catch {
      throw new Error(
        'YAMNet: no se pudo cargar TF.js. El nivel de ruido sigue disponible, pero no hay clasificación.',
      );
    }
    await tf.ready();
    try {
      if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu');
    } catch {
      await tf.setBackend('cpu');
    }
    this.tf = tf;
    report({ phase: 'weights', progress: 0.2 });

    const url =
      opts.modelUrl ??
      `${import.meta.env.BASE_URL ?? '/'}models/yamnet/model.json`;
    try {
      this.model = await tf.loadLayersModel(url);
    } catch (err) {
      this.model = null;
      throw new Error(
        `yamnet: no se pudo cargar el modelo (${url}). Coloca el layers-model ` +
          `convertido en public/models/yamnet/model.json (+ shards). ` +
          `Detalle: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const labelsUrl=new URL('yamnet_class_map.csv',new URL(url,window.location.href));
    const labelResponse=await fetch(labelsUrl);
    if (!labelResponse.ok) {this.dispose();throw new Error('No se pudo cargar el mapa YAMNet');}
    this.labels=parseClassMapCsv(await labelResponse.text());
    if (this.labels.length!==521 || Array.from(this.labels).some(name=>!name)) {this.dispose();throw new Error('Mapa YAMNet incompleto');}
    try { await this.classifyAsync(new Float32Array(YAMNET_SAMPLES)); }
    catch(error) { this.dispose();throw error; }
    report({ phase:'ready',progress:1 });
    this.backend='yamnet';
  }

  setClassLabels(labels: string[]): void {
    this.labels = labels.slice();
  }

  classify(_pcm: Float32Array): RankedPrediction[] {
    if (!this.model) throw new Error('yamnet: llama a load() antes de classifyAsync().');
    throw new Error('YAMNet requiere classifyAsync() para leer tensores sin bloquear.');
  }

  async classifyAsync(pcm: Float32Array, features?: Float32Array): Promise<RankedPrediction[]> {
    if (!this.model || !this.tf) throw new Error('yamnet: llama a load() antes de classify().');
    if (pcm.length !== YAMNET_SAMPLES) {
      throw new Error(`yamnet: ventana de ${pcm.length}, se esperan ${YAMNET_SAMPLES}.`);
    }
    const patch = features ?? frameToPatch(pcm);
    const input = this.tf.tensor(patch, [1, 96, 64]);
    try {
      if ('predict' in this.model) {
        const out=this.model.predict(input) as TfTensor;
        const ranked=await scoresToRankedAsync(out,this.labels);
        if(ranked.length!==YAMNET_CLASSES) throw new Error('YAMNet no devolvió las 521 clases oficiales');
        return ranked;
      }
      const out = (await this.model.executeAsync?.(input, ['scores'])) as TfTensor | undefined;
      if (!out) throw new Error('yamnet: el modelo no expone execute ni executeAsync.');
      return await scoresToRankedAsync(out, this.labels);
    } finally {
      input.dispose();
    }
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
    this.tf = null;
    this.backend = 'heuristic';
  }
}

export async function createYamnetClassifier(opts?: {
  modelUrl?: string;
  onProgress?: (p: YamnetLoadProgress) => void;
}): Promise<YamnetClassifier> {
  const c = new YamnetClassifier();
  await c.load(opts);
  return c;
}

/** Convierte el tensor de scores [1, 521] en ranking (testable sin TF.js). */
export async function scoresToRankedAsync(
  scores: { data(): Promise<Float32Array | Int32Array | Uint8Array>; dispose(): void },
  labels: string[],
): Promise<RankedPrediction[]> {
  try {
    return scoresToRanked(await scores.data(), labels);
  } finally {
    scores.dispose();
  }
}

function scoresToRanked(
  data: Float32Array | Int32Array | Uint8Array | TfTensor,
  labels: string[],
): RankedPrediction[] {
  if (typeof (data as TfTensor).data === 'function') {
    throw new Error('yamnet: usa scoresToRankedAsync() para tensores TF.js.');
  }
  const arr = data instanceof Float32Array || data instanceof Int32Array || data instanceof Uint8Array
    ? Array.from(data as ArrayLike<number>)
    : [];
  const names =
    labels.length === YAMNET_CLASSES ? labels : Array.from({ length: arr.length }, (_, i) => `class_${i}`);
  return arr
    .map((confidence, i) => ({ yamnetLabel: names[i] ?? `class_${i}`, confidence }))
    .sort((a, b) => b.confidence - a.confidence);
}

export { YAMNET_CLASSES, YAMNET_SAMPLE_RATE, YAMNET_SAMPLES };
export type { ClassifyBackendKind, YamnetLoadProgress };
export { parseClassMapCsv as parseYamnetClassMap };
