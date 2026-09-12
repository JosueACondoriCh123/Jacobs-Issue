import { supabase } from './supabase'
import type { HUDTelemetryEvent } from '../types/hud'
export async function persistLiveEvent(event: HUDTelemetryEvent): Promise<void> {
  if (!supabase) throw new Error('Sin Supabase: evento local, no guardado')
  const { data:sessionData, error:sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  const { error } = await supabase.from('acoustic_event_logs').insert({
    id:event.id,user_id:sessionData.session?.user.id ?? null,
    timestamp:event.capturedAt ?? event.timestamp,sound_label:event.label,confidence:event.confidence,
    decibels:event.intensity,risk_level:event.risk,azimuth_angle:event.directionValid ? event.azimuth : 0,
    metadata:{kind:'event',directionValid:event.directionValid === true,spatialConfidence:event.spatialConfidence ?? 0,
      model_version:event.model,captured_at:event.capturedAt,emitted_at:new Date().toISOString(),
      level_estimated:true,device_id:localStorage.getItem('jacobs-issue.device_id')},
  }).select('id').single()
  if (error) throw new Error(`No guardado: ${error.message}`)
}
export async function notifyLiveEvent(eventId?: string) {
  if (!eventId) return { outcome:'FAILED' as const,detail:'El evento no está identificado/persistido; no se envió correo.',recipients:[],types:[] }
  if (!supabase) return { outcome:'FAILED' as const,detail:'Supabase no configurado',recipients:[],types:[] }
  const { data } = await supabase.auth.getSession()
  if (!data.session) return { outcome:'NEEDS_LOGIN' as const,detail:'Inicia sesión para enviar correo.',recipients:[],types:[] }
  try {
    const { data:report,error } = await supabase.functions.invoke('notify-emergency',{body:{event_id:eventId}})
    if (error) throw error
    const results: Array<{contact:string;status:string;type:string;error?:string}> = report?.results ?? []
    const empty={recipients:[],types:[]}
    if (!results.length) return {outcome:report?.code === 'NO_CONTACTS' ? 'NO_CONTACTS' as const : 'FAILED' as const,detail:report?.error ?? 'No se confirmó ningún envío',...empty}
    const accepted=results.filter(r => r.status === 'SENT' && r.type === 'RESEND')
    return {
      outcome:accepted.length === results.length ? 'SENT' as const : 'FAILED' as const,
      detail:accepted.length === results.length ? 'Aceptado por Resend; entrega al buzón aún no confirmada.' : results.find(r => r.error)?.error ?? 'No se confirmó el envío a todos los contactos',
      recipients:accepted.map(r => r.contact),types:[...new Set(results.map(r => r.type))],
    }
  } catch (error) {
    return {outcome:'FAILED' as const,detail:`No se pudo confirmar el envío: ${error instanceof Error ? error.message : String(error)}`,recipients:[],types:[]}
  }
}
