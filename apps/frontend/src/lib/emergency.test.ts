// @vitest-environment node
// Test-only dependency doubles: production always uses Supabase and Resend.
import { describe, expect, it, vi } from 'vitest'
import { createEmergencyHandler, type EmergencyDependencies, type EventRecord } from '../../../backend/supabase/functions/notify-emergency/handler'
const event:EventRecord={id:'e0000000-0000-4000-8000-000000000001',user_id:'owner',sound_label:'Alarma',confidence:0.91,decibels:65,risk_level:'CRITICAL',azimuth_angle:90,timestamp:'2026-09-12T12:00:00Z',metadata:{directionValid:false}}
function setup() {
  const deps:EmergencyDependencies={authenticate:vi.fn(async()=> 'owner'),event:vi.fn(async()=>event),contacts:vi.fn(async()=>[{id:'c1',name:'Authorized test contact',email:'test@example.com'}]),queued:vi.fn(async()=>({id:'q1',status:'PENDING',dispatch_type:'EMAIL_GMAIL'})),mark:vi.fn(async()=>{}),fetch:vi.fn(async()=>new Response(JSON.stringify({id:'provider-id'}),{status:200})),apiKey:'server-test-only',from:'Jacobs Issue <verified@example.com>'}
  const request=(body:unknown={event_id:event.id},authenticated=true)=>new Request('https://example.com/notify',{method:'POST',headers:{'Content-Type':'application/json',...(authenticated ? {Authorization:'Bearer test-token'} : {})},body:JSON.stringify(body)})
  return {deps,request,handler:createEmergencyHandler(deps)}
}
describe('authenticated server-resolved emergency email',()=>{
  it('rejects missing auth before reading data or sending',async()=>{const {deps,handler,request}=setup();expect((await handler(request(undefined,false))).status).toBe(401);expect(deps.event).not.toHaveBeenCalled();expect(deps.fetch).not.toHaveBeenCalled()})
  it('rejects events belonging to another user',async()=>{const {deps,handler,request}=setup();deps.event=vi.fn(async()=>({...event,user_id:'other'}));expect((await handler(request())).status).toBe(404);expect(deps.fetch).not.toHaveBeenCalled()})
  it.each([0.80,0.4])('does not email low-confidence events (%s)',async confidence=>{const {deps,handler,request}=setup();deps.event=vi.fn(async()=>({...event,confidence}));expect((await handler(request())).status).toBe(422);expect(deps.fetch).not.toHaveBeenCalled()})
  it('fails explicitly without provider secrets, never simulates sent',async()=>{const {deps,handler,request}=setup();deps.apiKey=undefined;const response=await handler(request());expect(response.status).toBe(503);expect((await response.json()).code).toBe('RESEND_NOT_CONFIGURED');expect(deps.mark).not.toHaveBeenCalled();expect(deps.fetch).not.toHaveBeenCalled()})
  it('does not invent fallback contacts',async()=>{const {deps,handler,request}=setup();deps.contacts=vi.fn(async()=>[]);expect((await handler(request())).status).toBe(422);expect(deps.fetch).not.toHaveBeenCalled()})
  it('ignores client identities and recipients; reuses queued logs and a stable key',async()=>{
    const {deps,handler,request}=setup()
    const response=await handler(request({event_id:event.id,user_id:'attacker',contacts:['attacker@example.com']}))
    expect(response.status).toBe(200);expect(deps.event).toHaveBeenCalledWith('owner',event.id)
    const calls=vi.mocked(deps.fetch).mock.calls;const options=calls[0][1]!
    expect(JSON.parse(String(options.body)).to).toEqual(['test@example.com'])
    expect(String(options.body)).toContain('No disponible')
    expect(options.headers).toMatchObject({'Idempotency-Key':`jacobs-issue-${event.id}-c1`})
    expect(deps.mark).toHaveBeenCalledWith('q1','SENT',expect.objectContaining({provider_id:'provider-id',delivery:'UNCONFIRMED'}),null)
    expect((await response.json()).results[0]).toMatchObject({status:'SENT',delivery:'UNCONFIRMED'})
    await handler(request());expect(vi.mocked(deps.fetch).mock.calls[1][1]!.body).toBe(options.body)
  })
  it('does not trust legacy simulated SENT; avoids re-sending real RESEND acceptance',async()=>{
    const {deps,handler,request}=setup();deps.queued=vi.fn(async()=>({id:'q1',status:'SENT',dispatch_type:'EMAIL_GMAIL'}))
    await handler(request());expect(deps.fetch).toHaveBeenCalledTimes(1)
    deps.queued=vi.fn(async()=>({id:'q1',status:'SENT',dispatch_type:'RESEND'}))
    await handler(request());expect(deps.fetch).toHaveBeenCalledTimes(1)
  })
  it('records provider failure, never acceptance or delivery',async()=>{
    const {deps,handler,request}=setup();deps.fetch=vi.fn(async()=>new Response('{}',{status:403}))
    const body=await (await handler(request())).json();expect(body.success).toBe(false);expect(body.dispatched_count).toBe(0)
    expect(deps.mark).toHaveBeenCalledWith('q1','FAILED',expect.any(Object),expect.stringContaining('HTTP 403'))
  })
})
