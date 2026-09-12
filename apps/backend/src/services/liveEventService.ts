/**
 * EchoVision (PhonoSpatial HUD) - Live Event Service (Dev 3)
 * Circuito de datos en vivo de latencia cero (Zero Latency Loop < 50 ms)
 * Doble vía: Broadcast inmediato por Realtime + Persistencia ACID en PostgreSQL
 */

import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export const CONFIDENCE_THRESHOLD = 0.80;
export const TELEMETRY_CHANNEL = 'hud-telemetry';
export const TELEMETRY_EVENT = 'telemetry';

export type RiskLevel = 'NORMAL' | 'ADVISORY' | 'CRITICAL';

export interface AcousticEventInput {
  sound_label: string;
  confidence: number;
  decibels: number;
  azimuth_angle: number;
  risk_level?: RiskLevel;
  user_id?: string | null;
  device_id?: string;
  session_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  success: boolean;
  persisted: boolean;
  broadcasted: boolean;
  event_id?: string;
  incident_id?: string;
  latency_ms: number;
  reason?: string;
  payload: Record<string, unknown>;
}

/**
 * Procesa un evento acústico con la regla de confianza > 80% y emisión concurrente.
 */
export async function processLiveAcousticEvent(
  event: AcousticEventInput,
  supabase: SupabaseClient,
  existingChannel?: RealtimeChannel | null
): Promise<IngestResult> {
  const startTime = performance.now();

  const confidence = typeof event.confidence === 'number' ? event.confidence : 0.0;
  const decibels = Math.round((event.decibels || 50.0) * 10) / 10;
  const azimuth = ((Math.round((event.azimuth_angle || 0.0) * 10) / 10) % 360 + 360) % 360;
  const label = event.sound_label?.trim() || 'Sonido no clasificado';

  // Derivar nivel de riesgo si no viene explícito
  let risk: RiskLevel = event.risk_level || 'NORMAL';
  if (!event.risk_level) {
    if (decibels >= 85) risk = 'CRITICAL';
    else if (decibels >= 70) risk = 'ADVISORY';
  }

  // Payload normalizado para el Canvas HUD de Dev 1
  const hudPayload = {
    azimuth,
    intensity: decibels,
    decibels,
    label,
    risk,
    confidence: Math.round(confidence * 100) / 100,
    timestamp: new Date().toISOString(),
    deviceId: event.device_id || 'hud-primary',
    isOnset: true,
  };

  // 1. FILTRADO: Regla estricta de confianza > 80%
  if (confidence <= CONFIDENCE_THRESHOLD) {
    const elapsed = Math.round((performance.now() - startTime) * 100) / 100;
    return {
      success: false,
      persisted: false,
      broadcasted: false,
      latency_ms: elapsed,
      reason: `Confianza insuficiente (${(confidence * 100).toFixed(1)}% <= 80%). No califica para persistencia ni alerta HUD.`,
      payload: hudPayload,
    };
  }

  // 2. CIRCUITO DUAL CONCURRENTE (Zero Latency Loop)
  let broadcastPromise: Promise<boolean>;
  const activeChannel = existingChannel || supabase.channel(TELEMETRY_CHANNEL);

  // Vía Rápida: WebSocket Broadcast (< 15 ms)
  broadcastPromise = (async () => {
    try {
      await activeChannel.send({
        type: 'broadcast',
        event: TELEMETRY_EVENT,
        payload: hudPayload,
      });
      return true;
    } catch (err) {
      console.warn('[LiveEventService] Error en broadcast Realtime:', err);
      return false;
    }
  })();

  // Vía Duradera: Inserción ACID en PostgreSQL (< 35 ms)
  const persistPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('acoustic_event_logs')
        .insert({
          user_id: event.user_id || null,
          sound_label: label,
          confidence,
          decibels,
          risk_level: risk,
          azimuth_angle: azimuth,
          metadata: {
            device_id: event.device_id || 'hud-primary',
            session_id: event.session_id || null,
            ...(event.metadata || {}),
          },
        })
        .select('id')
        .single();

      if (error) throw error;
      return { ok: true, id: data?.id as string };
    } catch (err) {
      console.error('[LiveEventService] Error insertando en acoustic_event_logs:', err);
      return { ok: false, id: undefined };
    }
  })();

  // Ejecución simultánea
  const [broadcastOk, persistResult] = await Promise.all([broadcastPromise, persistPromise]);

  // Si es CRITICAL, persistir también en acoustic_incidents para disparar tr_critical_escalation
  let incidentId: string | undefined;
  if (risk === 'CRITICAL' && persistResult.ok) {
    try {
      const { data: incData } = await supabase
        .from('acoustic_incidents')
        .insert({
          user_id: event.user_id || null,
          sound_label: label,
          confidence,
          peak_decibels: decibels,
          azimuth_angle: azimuth,
          risk_level: 'CRITICAL',
        })
        .select('id')
        .single();
      incidentId = incData?.id;
    } catch (err) {
      console.warn('[LiveEventService] Error registrando acoustic_incident crítico:', err);
    }
  }

  const totalLatency = Math.round((performance.now() - startTime) * 100) / 100;

  return {
    success: broadcastOk || persistResult.ok,
    persisted: persistResult.ok,
    broadcasted: broadcastOk,
    event_id: persistResult.id,
    incident_id: incidentId,
    latency_ms: totalLatency,
    payload: hudPayload,
  };
}
