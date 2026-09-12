/**
 * API publica del modulo Dev 4 (AI Audio Model & Ingest Worker).
 *
 * Vive 100% en `src/ai/` para cero conflictos de fusion con Dev 1/2/3.
 *
 * Desmockeo del label (sin API key, sin red):
 *   import { createLabelProvider } from './ai'
 *   const labels = createLabelProvider()
 *   engine.onFrame(({ pcm, peakDb }) => labels.push(pcm, peakDb))
 *   engine.onTelemetry((t) => publisher.publish(t, labels.current))
 *
 * Ingesta persistente (contrato >0.80 + Supabase):
 *   import { ClassifierBridge } from './ai'
 *   const bridge = new ClassifierBridge({ userId: auth.user?.id ?? null })
 *   engine.onFrame((f) => void bridge.handleFrame(f))
 */
export { classify, classifyLabel, setClassifierEngine, useNeuralBackend } from './classify';
export type { ClassifyEngine, SimpleClassification } from './classify';
export { createLabelProvider, LabelProvider } from './labelProvider';
export type { LabelProviderOptions } from './labelProvider';
export { ClassifierBridge } from './classifierBridge';
export type { BridgeOptions } from './classifierBridge';
export { createMemoryPersist, createSupabasePersist } from './ingestClient';
export type { PersistFn, PersistedRow } from './ingestClient';
export { HeuristicClassifier } from './heuristicClassifier';
export {
  createYamnetClassifier,
  parseClassMapCsv,
  parseYamnetClassMap,
  scoresToRankedAsync,
  YamnetClassifier,
  YAMNET_LOCAL_MODEL_URL,
} from './yamnetClassifier';
export { YAMNET_CLASSES, YAMNET_SAMPLE_RATE, YAMNET_SAMPLES, YAMNET_TFHUB_URL } from './yamnetClassifier';
export {
  frameToPatch,
  melFilterbank,
  periodicHann,
  waveformToExamples,
  waveformToLogMel,
} from './features';
export {
  LOG_OFFSET,
  MEL_MAX_HZ,
  MEL_MIN_HZ,
  N_FRAME,
  N_MEL,
  STFT_HOP,
  STFT_WINDOW,
  YAMNET_SR,
  YAMNET_WINDOW_SAMPLES,
} from './features';
export { YAMNET_LABELS, lookupYamnetLabel } from './labels';
export type { LabelEntry } from './labels';
export { refineRisk, resolvePrediction, riskFromDb } from './riskMapper';
export { CONFIDENCE_THRESHOLD, UNCLASSIFIED, YAMNET_CLASSES as CONTRACT_CLASSES } from './types';
export type {
  AsyncSoundClassifier,
  BridgeStats,
  ClassifyBackendKind,
  ClassificationResult,
  ClassifierFrame,
  RankedPrediction,
  RiskLevel,
  SoundClassifier,
  YamnetLoadProgress,
} from './types';
