import { act } from 'react'
import { createRoot, type Root as ReactRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DspAudioFrame, DspTelemetry } from '../audio/types'

const fakes=vi.hoisted(()=>({engines:[] as any[],dispatch:vi.fn(),persist:vi.fn()}))
vi.mock('../lib/supabase',()=>({supabase:null,isSupabaseConfigured:false}))
vi.mock('../hooks/useAuth',()=>({useAuth:()=>({user:{id:'owner'},isLoading:false})}))
vi.mock('../hooks/useHudTelemetry',()=>({useHudTelemetry:()=>({telemetry:{source:'idle',timestamp:new Date().toISOString(),label:'Sin señal',intensity:0,confidence:0,risk:'NORMAL',azimuth:0,id:'idle'},history:[],connection:'ERROR',error:'Offline test',averageIntensity:0})}))
vi.mock('../ai/yamnetClassifier',()=>({YamnetClassifier:class {modelName='yamnet';isLoaded=false;async load(){this.isLoaded=true}dispose(){this.isLoaded=false}async classifyAsync(){return [{yamnetLabel:'Siren',confidence:0.95}]}}}))
vi.mock('../lib/liveBackend',()=>({persistLiveEvent:(...args:unknown[])=>fakes.persist(...args)}))
vi.mock('../audio/telemetryPublisher',()=>({TelemetryPublisher:class {transportName='test-only';async connect(){}async disconnect(){}publish(){}publishEvent(){}}}))
vi.mock('../audio/captureEngine',()=>({AudioCaptureEngine:class {
  status={active:false,stereo:false,warnings:[]};telemetry=new Set<(t:DspTelemetry)=>void>();frames=new Set<(f:DspAudioFrame)=>void>();statuses=new Set<(s:unknown)=>void>();starts=0
  constructor(){fakes.engines.push(this)} get isActive(){return this.status.active}
  async start(){this.starts++;this.status.active=true;return this.status}stop(){this.status.active=false}
  setSplOffset(){}setOnsetThreshold(){}onSnapshot(){return ()=>{}}
  onStatusChange(fn:(s:unknown)=>void){this.statuses.add(fn);return ()=>this.statuses.delete(fn)}
  onTelemetry(fn:(t:DspTelemetry)=>void){this.telemetry.add(fn);return ()=>this.telemetry.delete(fn)}
  onFrame(fn:(f:DspAudioFrame)=>void){this.frames.add(fn);return ()=>this.frames.delete(fn)}
}}))
vi.mock('./backend',()=>({currentUserId:async()=> 'owner',listContacts:async()=>({state:'synced',data:[]}),listDispatchLogs:async()=>({state:'synced',data:[]}),dispatchEmergency:(...args:unknown[])=>fakes.dispatch(...args),saveContact:vi.fn(),deleteContact:vi.fn()}))
vi.mock('../landing/Landing',()=>({Landing:()=> <span>Public landing</span>}))
vi.mock('../landing/AuthScreen',()=>({AuthScreen:()=> <span>Access screen</span>}))
// Root is real. A small shell avoids rendering Three.js or unrelated screens.
vi.mock('./AppShell',async()=>{
  const {useEchoStore}=await import('./store');const {SafetyTree}=await import('../screens/SafetyTree')
  return {default:()=>{const store=useEchoStore();return <><button id="start" onClick={()=>void store.start()}>Start</button><button id="mini" onClick={()=>void store.miniHud.open()}>Mini</button><span id="capture">{store.signal}</span><SafetyTree/></>}}
})
import Root from '../Root'

let root:ReactRoot,host:HTMLDivElement
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
const switchRoute=async(route:string)=>{await act(async()=>{window.location.hash=route;window.dispatchEvent(new Event('hashchange'));await flush()})}
const sendSample=async()=>{
  const engine=fakes.engines[0]
  await act(async()=>{
    const t={type:'telemetry',db:65,peakDb:65,azimuth:0,spatialConfidence:0,noiseFloorDb:40,risk:'NORMAL',isOnset:false,effectiveStereo:false,audioTimeMs:0} as DspTelemetry
    engine.telemetry.forEach((fn:(t:DspTelemetry)=>void)=>fn(t))
    engine.frames.forEach((fn:(f:DspAudioFrame)=>void)=>fn({type:'frame',pcm:new Float32Array(15360),sampleRate:16000,azimuth:0,peakDb:65,audioTimeMs:0,capturedAt:new Date().toISOString()}))
    await flush()
  })
}
beforeEach(async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));localStorage.clear();window.location.hash='/hud';fakes.engines.length=0
  fakes.persist.mockReset().mockResolvedValue(undefined);fakes.dispatch.mockReset().mockResolvedValue({outcome:'SENT',detail:'Accepted, not delivered',recipients:['authorized@example.com'],types:['RESEND']})
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async()=>{root.render(<Root/>);await flush()})
  await act(async()=>{host.querySelector<HTMLButtonElement>('#start')!.click();host.querySelector<HTMLButtonElement>('#mini')!.click();await flush()})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers()})
describe('root-owned capture, model, Mini HUD and escalation',()=>{
  it('survives app routes and public routes without resetting capture or countdown',async()=>{
    await sendSample();expect(document.body.textContent).toContain('ESCALADO EN 15 s')
    await act(async()=>{vi.advanceTimersByTime(5000);await flush()})
    await switchRoute('/forensics');await switchRoute('/')
    expect(fakes.engines).toHaveLength(1);expect(fakes.engines[0].starts).toBe(1);expect(fakes.engines[0].isActive).toBe(true)
    expect(document.body.querySelector('.mini-hud-fallback')).not.toBeNull()
    expect(document.body.textContent).toContain('ESCALADO EN 10 s')
    await act(async()=>{vi.advanceTimersByTime(10000);await flush()})
    expect(fakes.dispatch).toHaveBeenCalledTimes(1)
    expect(fakes.dispatch).toHaveBeenCalledWith({event_id:fakes.persist.mock.calls[0][0].id})
  })
  it('allows acknowledgment after a route change and never reports stale audio as quiet',async()=>{
    await sendSample();await switchRoute('/dosimetry')
    await act(async()=>{vi.advanceTimersByTime(2100);await flush()})
    expect(document.body.querySelector('.mini-state-no_signal')).not.toBeNull()
    const button=Array.from(document.body.querySelectorAll('button')).find(b=>b.textContent==='RECONOZCO LA ALERTA')!
    await act(async()=>{button.click();vi.advanceTimersByTime(20000);await flush()})
    expect(fakes.dispatch).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('RECONOCIDO')
  })
})
