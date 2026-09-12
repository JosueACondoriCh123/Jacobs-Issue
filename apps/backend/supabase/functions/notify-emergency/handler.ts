export interface EventRecord {
  id:string; user_id:string; sound_label:string; confidence:number; decibels:number;
  risk_level:string; azimuth_angle:number; timestamp:string; metadata?:Record<string,unknown>
}
export interface ContactRecord {id:string;name:string;email:string}
export interface QueuedLog {id:string;status:string;dispatch_type:string;payload?:Record<string,unknown>}
export interface EmergencyDependencies {
  authenticate(token:string):Promise<string | null>
  event(userId:string,eventId:string):Promise<EventRecord | null>
  contacts(userId:string):Promise<ContactRecord[]>
  queued(event:EventRecord,contact:ContactRecord):Promise<QueuedLog>
  mark(logId:string,status:'SENT'|'FAILED',payload:Record<string,unknown>,error:string|null):Promise<void>
  fetch:typeof fetch
  apiKey?:string
  from?:string
}
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export function createEmergencyHandler(deps:EmergencyDependencies) {
  return async (req:Request):Promise<Response> => {
    if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
    if(req.method!=='POST') return reply({error:'Método no permitido'},405)
    try {
      const token=req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
      const userId=token ? await deps.authenticate(token) : null
      if(!userId) return reply({error:'Sesión válida requerida',code:'NEEDS_LOGIN'},401)
      const body=await req.json().catch(()=>null)
      if(!body || typeof body.event_id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.event_id)) return reply({error:'event_id UUID requerido'},400)
      const event=await deps.event(userId,body.event_id)
      if(!event || event.user_id!==userId) return reply({error:'Evento no encontrado'},404)
      if(event.risk_level!=='CRITICAL' || !(event.confidence>0.8)) return reply({error:'Se requiere un evento crítico clasificado con confianza >80%'},422)
      const contacts=await deps.contacts(userId)
      if(!contacts.length) return reply({error:'Sin contactos activos guardados',code:'NO_CONTACTS'},422)
      if(!deps.apiKey || !deps.from) return reply({error:'Correo no disponible: configura RESEND_API_KEY y RESEND_FROM_EMAIL',code:'RESEND_NOT_CONFIGURED'},503)
      const results=[]
      for(const contact of contacts) {
        let log:QueuedLog | null=null
        try {
          if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) throw new Error('Correo del contacto inválido')
          log=await deps.queued(event,contact)
          // Legacy simulated EMAIL_GMAIL/SENT records are NOT delivery evidence.
          if(log.status==='SENT' && log.dispatch_type==='RESEND') {
            results.push({contact:contact.email,type:'RESEND',status:'SENT',log_id:log.id,delivery:'UNCONFIRMED',already_accepted:true});continue
          }
          const direction=event.metadata?.directionValid===true ? `${event.azimuth_angle}° relativos al micrófono` : 'No disponible'
          const response=await deps.fetch('https://api.resend.com/emails',{
            method:'POST',headers:{Authorization:`Bearer ${deps.apiKey}`,'Content-Type':'application/json','Idempotency-Key':`jacobs-issue-${event.id}-${contact.id}`},
            body:JSON.stringify({from:deps.from,to:[contact.email],subject:`Alerta acústica Jacobs Issue: ${event.sound_label}`,
              html:`<h1>Alerta acústica Jacobs Issue</h1><p>${escape(event.sound_label)}</p><p>Nivel estimado: ${event.decibels} dB. Dirección: ${escape(direction)}.</p><p>Evento: ${escape(event.timestamp)}. Verifica el entorno y el estado del usuario.</p>`}),
          })
          const accepted=await response.json().catch(()=>({}))
          if(!response.ok || typeof accepted.id!=='string') throw new Error(`Resend no confirmó aceptación (HTTP ${response.status})`)
          await deps.mark(log.id,'SENT',{provider_id:accepted.id,delivery:'UNCONFIRMED',event_id:event.id,contact_id:contact.id},null)
          results.push({contact:contact.email,type:'RESEND',status:'SENT',log_id:log.id,provider_id:accepted.id,delivery:'UNCONFIRMED'})
        } catch(error) {
          const message=error instanceof Error ? error.message : String(error)
          if(log) {try {await deps.mark(log.id,'FAILED',{event_id:event.id,contact_id:contact.id},message)} catch { /* report failure; never invent a saved audit */ }}
          results.push({contact:contact.email,type:'RESEND',status:'FAILED',error:message,log_id:log?.id})
        }
      }
      return reply({success:results.every(r=>r.status==='SENT'),dispatched_count:results.filter(r=>r.status==='SENT').length,results})
    } catch {return reply({error:'No se pudo completar ni confirmar el despacho'},500)}
  }
}
