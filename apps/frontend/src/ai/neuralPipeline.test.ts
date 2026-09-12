// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NeuralPipeline, type NeuralPipelineOptions } from './neuralPipeline'
import { getSignalState } from '../lib/signalState'
import { normalizeTelemetry } from '../lib/telemetry'
import { getAmbientState } from '../lib/miniHudState'

const frame=(value=0)=>({type:'frame' as const,pcm:new Float32Array([value]),sampleRate:16000 as const,azimuth:90,peakDb:65,audioTimeMs:0,directionValid:false,spatialConfidence:0})
const flush=async()=>{for(let i=0;i<12;i++) await Promise.resolve()}
function setup() {
  const options:NeuralPipelineOptions={classifier:{modelName:'yamnet',classifyAsync:vi.fn(async()=>[{yamnetLabel:'Siren',confidence:0.91}])},persist:vi.fn(async()=>{}),onEvent:vi.fn(),onConfirmed:vi.fn(),onPrediction:vi.fn(),onError:vi.fn()}
  return {options,pipeline:new NeuralPipeline(options)}
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
describe('real inference orchestration',()=>{
  it('keeps only the latest waiting PCM and never overlaps inference',async()=>{
    const {options,pipeline}=setup()
    let finish!:(value:[])=>void
    options.classifier.classifyAsync=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValue([])
    pipeline.push(frame(1));pipeline.push(frame(2));pipeline.push(frame(3))
    expect(options.classifier.classifyAsync).toHaveBeenCalledTimes(1)
    finish([]);await flush()
    expect(options.classifier.classifyAsync).toHaveBeenCalledTimes(2)
    expect(options.classifier.classifyAsync).toHaveBeenLastCalledWith(new Float32Array([3]))
  })
  it.each([0.2,0.80,NaN])('does not persist confidence %s',async confidence=>{
    const {options,pipeline}=setup()
    options.classifier.classifyAsync=vi.fn(async()=>[{yamnetLabel:'Siren',confidence}])
    pipeline.push(frame());await flush()
    expect(options.persist).not.toHaveBeenCalled();expect(options.onConfirmed).not.toHaveBeenCalled()
  })
  it('emits only after confirmed insertion, with the same UUID and no mono angle',async()=>{
    const {options,pipeline}=setup();let finish!:()=>void
    options.persist=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}))
    pipeline.push(frame());await flush()
    expect(options.onEvent).toHaveBeenLastCalledWith(expect.objectContaining({persistence:'SAVING',confidence:0.91,spatialConfidence:0,directionValid:false,azimuth:0,risk:'CRITICAL'}))
    expect(options.onConfirmed).not.toHaveBeenCalled()
    finish();await flush()
    const inserted=vi.mocked(options.persist).mock.calls[0][0]
    expect(options.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({id:inserted.id,persistence:'SAVED'}))
  })
  it('keeps rejected persistence local/error, never broadcasts success',async()=>{
    const {options,pipeline}=setup();options.persist=vi.fn(async()=>{throw new Error('RLS rejected')})
    pipeline.push(frame());await flush()
    expect(options.onEvent).toHaveBeenLastCalledWith(expect.objectContaining({persistence:'ERROR'}))
    expect(options.onConfirmed).not.toHaveBeenCalled();expect(options.onError).toHaveBeenCalledWith('RLS rejected')
  })
  it('debounces identical classifications for 2.5 seconds',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-12T12:00:00Z'))
    const {options,pipeline}=setup();pipeline.push(frame());await flush();pipeline.push(frame());await flush()
    expect(options.persist).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2500);pipeline.push(frame());await flush();expect(options.persist).toHaveBeenCalledTimes(2)
  })
  it('does not revive a stopped run or replace model failures with heuristic guesses',async()=>{
    const {options,pipeline}=setup();let finish!:(value:[])=>void
    options.classifier.classifyAsync=vi.fn(()=>new Promise<[]>(resolve=>{finish=resolve}))
    pipeline.push(frame());pipeline.reset();finish([]);await flush();expect(options.onPrediction).not.toHaveBeenCalled()
    options.classifier.classifyAsync=vi.fn(async()=>{throw new Error('weights corrupt')})
    pipeline.push(frame());await flush();expect(options.onError).toHaveBeenCalledWith(expect.stringContaining('Inferencia YAMNet'))
    expect(options.persist).not.toHaveBeenCalled()
  })
})
describe('honest signal state',()=>{
  it('expires after two seconds, rather than reporting a quiet room',()=>{
    expect(getSignalState(true,100,2100,false)).toBe('LIVE')
    expect(getSignalState(true,100,2101,false)).toBe('STALE')
    expect(getAmbientState({intensity:0,risk:'NORMAL'},'STALE')).toMatchObject({id:'NO_SIGNAL',hasAlert:false})
    expect(getSignalState(false,null,3000,true)).toBe('STOPPED')
    expect(getSignalState(true,null,3000,false)).toBe('STARTING')
  })
  it('never trusts missing classifier or spatial confidence',()=>{
    expect(normalizeTelemetry({azimuth:93,directionValid:true})).toMatchObject({confidence:0,spatialConfidence:0,directionValid:false,azimuth:0})
  })
})
