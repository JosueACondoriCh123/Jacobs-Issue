import type { DspAudioFrame } from '../audio/types'
import type { HUDTelemetryEvent } from '../types/hud'
import { normalizeTelemetry } from '../lib/telemetry'
import { resolvePrediction } from './riskMapper'
import { UNCLASSIFIED, type RankedPrediction } from './types'

export type ModelState = 'IDLE' | 'LOADING' | 'READY' | 'ERROR'
export type PersistenceState = 'LOCAL' | 'SAVING' | 'SAVED' | 'ERROR'
export interface NeuralFrame extends DspAudioFrame {
  spatialConfidence?: number
  directionValid?: boolean
  capturedAt?: string
}
export interface NeuralPipelineOptions {
  classifier: { modelName: string; classifyAsync(pcm: Float32Array): Promise<RankedPrediction[]> }
  persist(event: HUDTelemetryEvent): Promise<void>
  onEvent(event: HUDTelemetryEvent): void
  onConfirmed(event: HUDTelemetryEvent): void
  onPrediction(label: string, confidence: number, risk: HUDTelemetryEvent['risk']): void
  onError(error: string): void
}
/** Exactly one inference/persist in flight; no polling or reclassifying old PCM. */
export class NeuralPipeline {
  private latest: NeuralFrame | null = null
  private busy = false
  private generation = 0
  private lastKey = ''
  private lastAt = 0
  private dedupeKeys = new Map<string,number>()
  constructor(private options: NeuralPipelineOptions) {}
  reset() { this.generation++; this.latest=null; this.lastKey=''; this.lastAt=0; this.dedupeKeys.clear() }
  push(frame: NeuralFrame) {
    this.latest=frame
    if (!this.busy) void this.drain()
  }
  private async drain() {
    this.busy=true
    try {
      while (this.latest) {
        const frame=this.latest; this.latest=null
        const generation=this.generation
        try {
          const ranked=await this.options.classifier.classifyAsync(frame.pcm)
          if (generation !== this.generation) continue
          const top=ranked[0]
          if (!top || !Number.isFinite(top.confidence) || top.confidence <= 0.8) {
            this.options.onPrediction(UNCLASSIFIED,top?.confidence ?? 0,'NORMAL')
            continue
          }
          const prediction=resolvePrediction(top.yamnetLabel,frame.peakDb)
          this.options.onPrediction(prediction.es,top.confidence,prediction.risk)
          const now=Date.now(), key=`${prediction.es}|${prediction.risk}`
          if (now-(this.dedupeKeys.get(key) ?? 0) < 2500) continue
          this.dedupeKeys.set(key,now)
          const event=normalizeTelemetry({
            id:crypto.randomUUID(),kind:'event',label:prediction.es,risk:prediction.risk,
            confidence:top.confidence,intensity:frame.peakDb,azimuth:frame.azimuth,
            spatialConfidence:frame.spatialConfidence ?? 0,directionValid:frame.directionValid === true,
            capturedAt:frame.capturedAt ?? new Date(now).toISOString(),
            timestamp:frame.capturedAt ?? new Date(now).toISOString(),
            model:this.options.classifier.modelName,persistence:'LOCAL',
          },'local')
          this.options.onEvent({...event,persistence:'SAVING'})
          try {
            await this.options.persist(event)
            if (generation !== this.generation) continue
            const confirmed={...event,persistence:'SAVED' as const,emittedAt:new Date().toISOString()}
            this.options.onEvent(confirmed)
            this.options.onConfirmed(confirmed)
            this.lastKey=key; this.lastAt=now
          } catch (error) {
            if (generation !== this.generation) continue
            this.options.onEvent({...event,persistence:'ERROR'})
            this.options.onError(error instanceof Error ? error.message : String(error))
          }
          if (this.dedupeKeys.size > 64) this.dedupeKeys.delete(this.dedupeKeys.keys().next().value!)
        } catch (error) {
          if (generation !== this.generation) continue
          this.options.onPrediction(UNCLASSIFIED,0,'NORMAL')
          this.options.onError(`Inferencia YAMNet: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally { this.busy=false }
  }
}
