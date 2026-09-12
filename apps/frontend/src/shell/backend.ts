import { supabase, isSupabaseConfigured } from '../lib/supabase'
import type { RiskLevel } from '../types/hud'
import { notifyLiveEvent } from '../lib/liveBackend'

/**
 * Capa de persistencia real contra Supabase.
 *
 * Regla que gobierna todo este archivo: la interfaz NUNCA debe dar por bueno un
 * guardado que no ocurrió. Cada operación devuelve dónde acabó realmente el dato
 * (`SyncState`) y las pantallas lo muestran. Un panel de accesibilidad que dice
 * "guardado" cuando el dato solo está en el navegador, o "enviado" cuando no
 * salió ningún correo, es peor que uno que admite sus límites.
 *
 * Lo que permite el RLS del backend (comprobado contra el proyecto real):
 *
 *   sensor_devices            lectura y escritura ANÓNIMAS (user_id NULL)
 *   spatial_zones             exige sesión iniciada
 *   custom_sound_signatures   exige sesión iniciada
 *   emergency_contacts        exige sesión iniciada
 *   notification_dispatch_logs  solo lo escribe la Edge Function (service_role)
 */

export type SyncState = 'local' | 'synced' | 'error'

export interface SyncResult<T> {
  state: SyncState
  data: T
  /** Motivo legible cuando el estado no es 'synced'. */
  reason?: string
}

/** Sesión activa, o null si se navega como invitado. */
export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id ?? null
}

export function backendAvailable(): boolean {
  return isSupabaseConfigured && Boolean(supabase)
}

const NEEDS_LOGIN = 'Requiere iniciar sesión con Google: el RLS del backend exige un usuario.'
const NO_BACKEND = 'Sin credenciales de Supabase configuradas.'

// ---------------------------------------------------------------- dispositivos

export interface RemoteDevice {
  id: string
  device_name: string
  device_room: string
  status: string
  battery_level: number | null
  last_heartbeat: string
  user_id: string | null
}

/**
 * Registra o actualiza este equipo como nodo sensor.
 *
 * `sensor_devices` acepta `user_id` nulo, así que esto funciona sin login: es la
 * única de las tres pantallas que puede sincronizar de verdad para un invitado.
 */
export async function registerDevice(
  deviceId: string,
  deviceName: string,
  room: string,
): Promise<SyncResult<RemoteDevice | null>> {
  if (!supabase) return { state: 'local', data: null, reason: NO_BACKEND }

  const userId = await currentUserId()
  const row = {
    id: deviceId,
    user_id: userId,
    device_name: deviceName,
    device_room: room,
    status: 'online',
    last_heartbeat: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('sensor_devices')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single()

  if (error) return { state: 'error', data: null, reason: error.message }
  return { state: 'synced', data: data as RemoteDevice }
}

/** Pulso de vida. El contrato del equipo es cada 30 s. */
export async function sendHeartbeat(deviceId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from('sensor_devices')
    .update({ last_heartbeat: new Date().toISOString(), status: 'online' })
    .eq('id', deviceId)
  return !error
}

export async function listDevices(): Promise<SyncResult<RemoteDevice[]>> {
  if (!supabase) return { state: 'local', data: [], reason: NO_BACKEND }
  const { data, error } = await supabase
    .from('sensor_devices')
    .select('id,device_name,device_room,status,battery_level,last_heartbeat,user_id')
    .order('last_heartbeat', { ascending: false })
  if (error) return { state: 'error', data: [], reason: error.message }
  return { state: 'synced', data: (data ?? []) as RemoteDevice[] }
}

// ------------------------------------------------------------------- sonidos

export interface RemoteSound {
  id: string
  custom_label: string
  spectral_signature: number[]
  risk_level: RiskLevel
  status: string
  registered_at: string
}

export async function saveCustomSound(sound: {
  label: string
  signature: number[]
  risk: RiskLevel
  centroidHz: number
}): Promise<SyncResult<RemoteSound | null>> {
  if (!supabase) return { state: 'local', data: null, reason: NO_BACKEND }
  const userId = await currentUserId()
  if (!userId) return { state: 'local', data: null, reason: NEEDS_LOGIN }

  const { data, error } = await supabase
    .from('custom_sound_signatures')
    .insert({
      user_id: userId,
      custom_label: sound.label,
      spectral_signature: sound.signature,
      risk_level: sound.risk,
      status: 'active',
      // Columnas añadidas por la migración relacional; si no existieran, el
      // insert fallaría entero, así que se envían solo estas dos y no más.
      label: sound.label,
      spectral_centroid_hz: sound.centroidHz,
      mfcc_signature: sound.signature,
      default_risk: sound.risk,
    })
    .select()
    .single()

  if (error) return { state: 'error', data: null, reason: error.message }
  return { state: 'synced', data: data as RemoteSound }
}

export async function listCustomSounds(): Promise<SyncResult<RemoteSound[]>> {
  if (!supabase) return { state: 'local', data: [], reason: NO_BACKEND }
  const userId = await currentUserId()
  if (!userId) return { state: 'local', data: [], reason: NEEDS_LOGIN }

  const { data, error } = await supabase
    .from('custom_sound_signatures')
    .select('id,custom_label,spectral_signature,risk_level,status,registered_at')
    .order('registered_at', { ascending: false })
  if (error) return { state: 'error', data: [], reason: error.message }
  return { state: 'synced', data: (data ?? []) as RemoteSound[] }
}

export async function deleteCustomSound(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('custom_sound_signatures').delete().eq('id', id)
  return !error
}

// ------------------------------------------------------------------ contactos

export interface RemoteContact {
  id: string
  name: string
  email: string
  relationship?: string | null
  relation?: string | null
  verified?: boolean | null
}

export async function listContacts(): Promise<SyncResult<RemoteContact[]>> {
  if (!supabase) return { state: 'local', data: [], reason: NO_BACKEND }
  const userId = await currentUserId()
  if (!userId) return { state: 'local', data: [], reason: NEEDS_LOGIN }

  const { data, error } = await supabase.from('emergency_contacts').select('*')
  if (error) return { state: 'error', data: [], reason: error.message }
  return { state: 'synced', data: (data ?? []) as RemoteContact[] }
}

export async function saveContact(contact: {
  name: string
  email: string
  relation: string
}): Promise<SyncResult<RemoteContact | null>> {
  if (!supabase) return { state: 'local', data: null, reason: NO_BACKEND }
  const userId = await currentUserId()
  if (!userId) return { state: 'local', data: null, reason: NEEDS_LOGIN }

  const { data, error } = await supabase
    .from('emergency_contacts')
    .insert({ user_id: userId, name: contact.name, email: contact.email, relationship: contact.relation })
    .select()
    .single()

  if (error) return { state: 'error', data: null, reason: error.message }
  return { state: 'synced', data: data as RemoteContact }
}

export async function deleteContact(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('emergency_contacts').delete().eq('id', id)
  return !error
}

// ------------------------------------------------------------------ despacho

/**
 * Qué ocurrió REALMENTE al intentar avisar a alguien.
 *
 * La distinción entre SENT y LOGGED_ONLY no es un tecnicismo: la Edge Function,
 * si no tiene configurada `RESEND_API_KEY` ni `EMERGENCY_WEBHOOK_URL`, escribe
 * el registro de auditoría y responde `success: true` habiendo hecho solo un
 * `console.log`. Nadie recibe nada. Se detecta porque el `type` devuelto es
 * `EMAIL_GMAIL` en lugar de `RESEND` o `WEBHOOK`.
 */
export type DispatchOutcome =
  | 'SENT'
  | 'LOGGED_ONLY'
  | 'NOT_DEPLOYED'
  | 'NEEDS_LOGIN'
  | 'NO_CONTACTS'
  | 'FAILED'

export interface DispatchReport {
  outcome: DispatchOutcome
  detail: string
  recipients: string[]
  /** Tipos devueltos por la función: RESEND, WEBHOOK o EMAIL_GMAIL. */
  types: string[]
}

export async function dispatchEmergency(payload: { event_id: string }): Promise<DispatchReport> {
  return notifyLiveEvent(payload.event_id)
}

export interface RemoteDispatchLog {
  id: string
  dispatch_type: string
  recipient: string
  status: string
  event_id?: string
  sent_at?: string
  created_at?: string
  error_message?: string | null
}

export async function listDispatchLogs(): Promise<SyncResult<RemoteDispatchLog[]>> {
  if (!supabase) return { state: 'local', data: [], reason: NO_BACKEND }
  const userId = await currentUserId()
  if (!userId) return { state: 'local', data: [], reason: NEEDS_LOGIN }

  const { data, error } = await supabase
    .from('notification_dispatch_logs')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(50)
  if (error) return { state: 'error', data: [], reason: error.message }
  return { state: 'synced', data: (data ?? []) as RemoteDispatchLog[] }
}
