import { supabase, isSupabaseConfigured } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const SUPABASE_ANON_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim() || ''

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  }

  if (supabase) {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) {
      headers['Authorization'] = `Bearer ${data.session.access_token}`
    } else {
      headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`
    }
  }

  return headers
}

export interface CalibrationPayload {
  ambient_average_db: number
  peak_transient_db: number
  environment_type?: string
  user_id?: string
  device_id?: string
}

export interface CalibrationResponse {
  success: boolean
  baseline_id: string
  dynamic_threshold_db: number
  ambient_average_db: number
  peak_transient_db: number
  environment_type: string
  status: string
  created_at?: string
}

/**
 * Envía la calibración del suelo de ruido calculada por Dev 2
 * al endpoint POST /api/v1/calibration/baseline
 */
export async function sendCalibrationBaseline(
  payload: CalibrationPayload,
): Promise<CalibrationResponse | null> {
  if (!isSupabaseConfigured) {
    console.warn('[EchoVision API] Supabase no configurado, simulando calibración local.')
    const dynamicThreshold = Math.round(
      (payload.ambient_average_db + 0.6 * (payload.peak_transient_db - payload.ambient_average_db)) * 10,
    ) / 10
    return {
      success: true,
      baseline_id: 'mock-baseline-local',
      dynamic_threshold_db: dynamicThreshold,
      ambient_average_db: payload.ambient_average_db,
      peak_transient_db: payload.peak_transient_db,
      environment_type: payload.environment_type || 'indoor_default',
      status: 'active',
    }
  }

  const url = `${SUPABASE_URL}/functions/v1/api-v1/calibration/baseline`
  const headers = await getAuthHeaders()

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Error ${res.status} al guardar calibración: ${errText}`)
  }

  return res.json()
}

export interface DeviceProvisionPayload {
  device_id?: string
  device_name?: string
  device_room?: string
  battery_level?: number
  status?: string
}

export interface DeviceProvisionResponse {
  success: boolean
  device_id: string
  device: {
    id: string
    device_name: string
    device_room: string
    battery_level: number
    status: string
    last_heartbeat: string
    user_id: string | null
  }
}

/**
 * Registra o provisiona un dispositivo emitiendo un deviceId real en lugar del estático 'hud-primary'
 * Endpoint: POST /api/v1/devices
 */
export async function provisionDevice(
  payload: DeviceProvisionPayload = {},
): Promise<DeviceProvisionResponse> {
  // Si ya se guardó un device_id en localStorage, reutilizarlo para mantener identidad persistente
  const storedId = localStorage.getItem('echovision.device_id')
  const body = {
    ...payload,
    device_id: payload.device_id || (storedId && storedId !== 'hud-primary' ? storedId : undefined),
  }

  if (!isSupabaseConfigured) {
    const fallbackId = body.device_id || `hud-${Math.random().toString(36).substring(2, 10)}`
    localStorage.setItem('echovision.device_id', fallbackId)
    return {
      success: true,
      device_id: fallbackId,
      device: {
        id: fallbackId,
        device_name: body.device_name || `EchoVision HUD (${fallbackId})`,
        device_room: body.device_room || 'Sala Principal',
        battery_level: body.battery_level ?? 100,
        status: 'online',
        last_heartbeat: new Date().toISOString(),
        user_id: null,
      },
    }
  }

  const url = `${SUPABASE_URL}/functions/v1/api-v1/devices`
  const headers = await getAuthHeaders()

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Error ${res.status} al provisionar dispositivo: ${errText}`)
  }

  const data: DeviceProvisionResponse = await res.json()
  if (data?.device_id) {
    localStorage.setItem('echovision.device_id', data.device_id)
  }
  return data
}

export interface PersistEventPayload {
  sound_label: string
  decibels: number
  risk_level: 'NORMAL' | 'ADVISORY' | 'CRITICAL'
  azimuth_angle?: number
  confidence?: number
  is_onset?: boolean
  device_id?: string
  session_id?: string
  metadata?: Record<string, unknown>
}

/**
 * Persiste un evento acústico u onset en la tabla acoustic_event_logs
 * respetando RLS y asociando la sesión activa si existe.
 */
export async function persistAcousticEvent(payload: PersistEventPayload): Promise<unknown> {
  if (!supabase) {
    console.log('[EchoVision Mock Event Persisted]', payload)
    return { success: true, mock: true }
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user?.id ?? null

  const metadata = {
    device_id: payload.device_id || localStorage.getItem('echovision.device_id') || 'hud-primary',
    session_id: payload.session_id || sessionData.session?.access_token ? 'authenticated-session' : 'guest-session',
    is_onset: payload.is_onset ?? true,
    ...(payload.metadata || {}),
  }

  const { data, error } = await supabase
    .from('acoustic_event_logs')
    .insert({
      user_id: userId,
      sound_label: payload.sound_label,
      decibels: payload.decibels,
      risk_level: payload.risk_level,
      confidence: payload.confidence ?? 0.95,
      azimuth_angle: payload.azimuth_angle ?? 0.0,
      metadata,
    })
    .select()
    .single()

  if (error) throw error
  return data
}
