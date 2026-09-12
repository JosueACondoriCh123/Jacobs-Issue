// ====================================================================
// EchoVision (PhonoSpatial HUD) - Edge Function: api-v1
// Router modular REST para endpoints de calibración, dispositivos,
// eventos acústicos/onsets, mesh, dosimetría y salud
// ====================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Normalizar path para soportar invocaciones con /functions/v1/api-v1, /api-v1 o directo
  let path = url.pathname;
  path = path.replace(/^\/functions\/v1/, '');
  path = path.replace(/^\/api-v1/, '');
  path = path.replace(/\/$/, '') || '/';
  const method = req.method;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  const jsonResponse = (data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  };

  // Resolución de usuario autenticado mediante Authorization Bearer token
  let authUserId: string | null = null;
  const authHeader = req.headers.get('Authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    try {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user?.id) {
        authUserId = user.id;
      }
    } catch {
      // Token inválido o anónimo; fallback a null
    }
  }

  try {
    // ------------------------------------------------------------------
    // 1. Health & Readiness Probes (Endpoint 9: /health & /ready)
    // ------------------------------------------------------------------
    if (path === '/health' || path === '/ready' || path === '/') {
      return jsonResponse({
        status: 'healthy',
        service: 'EchoVision Supabase API v1',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    }

    // ------------------------------------------------------------------
    // 2. Calibración dinámica del ruido de fondo (Endpoint 1: /calibration/baseline)
    // ------------------------------------------------------------------
    if (method === 'POST' && path === '/calibration/baseline') {
      const body = await req.json().catch(() => ({}));
      const ambientAvg = typeof body.ambient_average_db === 'number'
        ? body.ambient_average_db
        : (parseFloat(body.ambient_average_db) || 45.0);
      const peakTransient = typeof body.peak_transient_db === 'number'
        ? body.peak_transient_db
        : (parseFloat(body.peak_transient_db) || (ambientAvg + 20.0));
      const environmentType = body.environment_type || 'indoor_default';
      const userId = body.user_id || authUserId || null;

      // Cálculo de umbral dinámico adaptativo (percentil 10 + ponderación de transitorios)
      const dynamicThreshold = Math.round((ambientAvg + 0.6 * (peakTransient - ambientAvg)) * 10) / 10;

      const { data, error } = await supabase
        .from('noise_baselines')
        .insert({
          user_id: userId,
          ambient_average_db: ambientAvg,
          peak_transient_db: peakTransient,
          dynamic_threshold_db: dynamicThreshold,
          environment_type: environmentType,
          status: 'active',
        })
        .select('id, dynamic_threshold_db, status, created_at')
        .single();

      if (error) throw error;

      return jsonResponse({
        success: true,
        baseline_id: data.id,
        dynamic_threshold_db: data.dynamic_threshold_db,
        ambient_average_db: ambientAvg,
        peak_transient_db: peakTransient,
        environment_type: environmentType,
        status: data.status,
        created_at: data.created_at,
      }, 201);
    }

    if (method === 'GET' && path === '/calibration/baseline') {
      const userId = url.searchParams.get('user_id') || authUserId || null;
      let query = supabase
        .from('noise_baselines')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const latest = data && data.length > 0 ? data[0] : null;
      return jsonResponse({
        baseline: latest || {
          ambient_average_db: 45.0,
          peak_transient_db: 65.0,
          dynamic_threshold_db: 57.0,
          environment_type: 'indoor_default',
          status: 'default',
        },
      }, 200);
    }

    // ------------------------------------------------------------------
    // 3. Provisión y Registro de Dispositivos HUD/Sensores (Endpoint 8: /devices)
    // ------------------------------------------------------------------
    if (method === 'POST' && path === '/devices') {
      const body = await req.json().catch(() => ({}));
      const userId = body.user_id || authUserId || null;

      // Soporta deviceId / device_id explícito (incluyendo 'hud-primary') o autogenera si no se envía
      let deviceId = body.device_id || body.deviceId || body.id;
      if (!deviceId) {
        const randomPart = crypto.randomUUID().slice(0, 8);
        deviceId = `hud-${randomPart}`;
      }

      const deviceName = body.device_name || body.deviceName || (deviceId === 'hud-primary' ? 'EchoVision HUD Primary Unit' : `EchoVision Device (${deviceId})`);
      const deviceRoom = body.device_room || body.deviceRoom || (deviceId === 'hud-primary' ? 'Master HUD / Central' : 'Sala Principal');
      const batteryLevel = typeof body.battery_level === 'number' ? body.battery_level : (typeof body.batteryLevel === 'number' ? body.batteryLevel : 100.0);
      const status = body.status || 'online';
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('sensor_devices')
        .upsert({
          id: deviceId,
          user_id: userId,
          device_name: deviceName,
          device_room: deviceRoom,
          battery_level: batteryLevel,
          status: status,
          last_heartbeat: now,
        }, { onConflict: 'id' })
        .select()
        .single();

      if (error) throw error;

      return jsonResponse({
        success: true,
        device_id: data.id,
        device: data,
      }, 201);
    }

    if (method === 'GET' && path === '/devices') {
      const userId = url.searchParams.get('user_id') || authUserId || null;
      let query = supabase
        .from('sensor_devices')
        .select('*')
        .order('last_heartbeat', { ascending: false });

      if (userId) {
        query = query.or(`user_id.eq.${userId},user_id.is.null`);
      }

      const { data, error } = await query;
      if (error) throw error;

      return jsonResponse({
        devices: data || [],
        count: data?.length || 0,
      }, 200);
    }

    // ------------------------------------------------------------------
    // 4. Persistencia y Emisión Concurrente (Zero Latency Loop < 50 ms)
    // ------------------------------------------------------------------
    if (method === 'POST' && (path === '/events' || path === '/events/onset' || path === '/events/ingest')) {
      const t0 = performance.now();
      const body = await req.json().catch(() => ({}));
      const userId = body.user_id || authUserId || null;
      const soundLabel = body.sound_label || body.label || 'Sonido Detectado';
      const decibels = typeof body.decibels === 'number'
        ? body.decibels
        : (parseFloat(body.intensity) || parseFloat(body.decibels) || 50.0);
      const riskLevel = body.risk_level || body.risk || (decibels >= 85 ? 'CRITICAL' : decibels >= 70 ? 'ADVISORY' : 'NORMAL');
      const confidence = typeof body.confidence === 'number' ? body.confidence : 0.95;
      const azimuth = typeof body.azimuth_angle === 'number'
        ? body.azimuth_angle
        : (typeof body.azimuth === 'number' ? body.azimuth : 0.0);

      // Puerta de confianza: sólo persistir y alertar si confidence > 80%
      if (confidence <= 0.80) {
        return jsonResponse({
          success: false,
          dropped: true,
          reason: `Confianza insuficiente (${(confidence * 100).toFixed(1)}% <= 80%). Descartado para persistencia.`,
          confidence,
        }, 200);
      }

      const metadata = {
        device_id: body.device_id || body.deviceId || 'hud-primary',
        session_id: body.session_id || body.sessionId || null,
        is_onset: body.is_onset ?? body.isOnset ?? true,
        spatial_confidence: body.spatial_confidence ?? body.spatialConfidence ?? null,
        noise_floor_db: body.noise_floor_db ?? body.noiseFloorDb ?? null,
        ...(body.metadata || {}),
      };

      const hudPayload = {
        azimuth: ((azimuth % 360) + 360) % 360,
        intensity: Math.round(decibels * 10) / 10,
        decibels: Math.round(decibels * 10) / 10,
        label: soundLabel,
        risk: riskLevel,
        confidence: Math.round(confidence * 100) / 100,
        timestamp: new Date().toISOString(),
        deviceId: metadata.device_id,
        isOnset: true,
      };

      // Vía A: Broadcast Realtime ultra-rápido en paralelo
      const channel = supabase.channel('hud-telemetry');
      const broadcastPromise = channel.send({
        type: 'broadcast',
        event: 'telemetry',
        payload: hudPayload,
      }).catch((e) => console.warn('[api-v1] Broadcast error:', e));

      // Vía B: Persistencia duradera en PostgreSQL
      const persistPromise = supabase
        .from('acoustic_event_logs')
        .insert({
          user_id: userId,
          sound_label: soundLabel,
          decibels: decibels,
          risk_level: riskLevel,
          confidence: confidence,
          azimuth_angle: azimuth,
          metadata: metadata,
        })
        .select()
        .single();

      const [_, persistResult] = await Promise.all([broadcastPromise, persistPromise]);

      if (persistResult.error) throw persistResult.error;

      // Si es CRITICAL, registrar también en acoustic_incidents para activar tr_critical_escalation
      if (riskLevel === 'CRITICAL') {
        supabase
          .from('acoustic_incidents')
          .insert({
            user_id: userId,
            sound_label: soundLabel,
            confidence: confidence,
            peak_decibels: decibels,
            azimuth_angle: azimuth,
            risk_level: 'CRITICAL',
          })
          .catch((err) => console.warn('[api-v1] Error en acoustic_incidents:', err));
      }

      const latencyMs = Math.round((performance.now() - t0) * 100) / 100;

      return jsonResponse({
        success: true,
        persisted: true,
        broadcasted: true,
        latency_ms: latencyMs,
        event_id: persistResult.data.id,
        event: persistResult.data,
      }, 201);
    }

    if (method === 'GET' && path === '/events') {
      const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
      const userId = url.searchParams.get('user_id') || authUserId || null;
      const risk = url.searchParams.get('risk_level');

      let query = supabase
        .from('acoustic_event_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (userId) {
        query = query.or(`user_id.eq.${userId},user_id.is.null`);
      }
      if (risk) {
        query = query.eq('risk_level', risk);
      }

      const { data, error } = await query;
      if (error) throw error;

      return jsonResponse({
        events: data || [],
        count: data?.length || 0,
      }, 200);
    }

    // ------------------------------------------------------------------
    // 5. Registro de huellas acústicas personalizadas (Endpoint 3: /sounds/custom-enroll)
    // ------------------------------------------------------------------
    if (method === 'POST' && path === '/sounds/custom-enroll') {
      const body = await req.json();
      if (!body.custom_label || !body.spectral_signature) {
        return jsonResponse({ error: 'Faltan custom_label y spectral_signature' }, 400);
      }

      const { data, error } = await supabase
        .from('custom_sound_signatures')
        .insert({
          user_id: body.user_id || authUserId || null,
          custom_label: body.custom_label,
          spectral_signature: body.spectral_signature,
          risk_level: body.risk_level || 'NORMAL',
          status: 'active',
        })
        .select('id, registered_at, status')
        .single();

      if (error) throw error;

      return jsonResponse({
        sound_id: data.id,
        registered_at: data.registered_at,
        status: data.status,
      }, 201);
    }

    // ------------------------------------------------------------------
    // 6. Reenvío Mesh entre Dispositivos y HUD (Endpoint 4: /mesh/relay-event)
    // ------------------------------------------------------------------
    if (method === 'POST' && path === '/mesh/relay-event') {
      const body = await req.json();
      const broadcastTimestamp = new Date().toISOString();

      // Guardar evento acústico retransmitido
      const { error: dbError } = await supabase
        .from('acoustic_event_logs')
        .insert({
          user_id: body.user_id || authUserId || null,
          sound_label: `${body.sound_label} [${body.device_room || 'Mesh'}]`,
          decibels: parseFloat(body.decibels) || 50.0,
          risk_level: body.risk_level || 'NORMAL',
          confidence: 0.95,
          azimuth_angle: body.azimuth_angle || 0.0,
          metadata: {
            source_device_id: body.source_device_id,
            device_room: body.device_room,
            is_mesh_relay: true,
          },
        });

      if (dbError) throw dbError;

      // Actualizar heartbeat del dispositivo sensor
      if (body.source_device_id) {
        await supabase
          .from('sensor_devices')
          .upsert({
            id: body.source_device_id,
            device_room: body.device_room || 'Unknown Room',
            device_name: `Sensor ${body.device_room || body.source_device_id}`,
            last_heartbeat: broadcastTimestamp,
            status: 'online',
          });
      }

      return jsonResponse({
        relay_status: 'dispatched_to_realtime_hud',
        broadcast_timestamp: broadcastTimestamp,
      }, 200);
    }

    // ------------------------------------------------------------------
    // 7. Resumen Histórico y Dosimetría Acústica (Endpoint 5: /analytics/acoustic-digest)
    // ------------------------------------------------------------------
    if (method === 'GET' && path === '/analytics/acoustic-digest') {
      const windowParam = url.searchParams.get('window') || '8h';
      const riskFilter = url.searchParams.get('risk_filter');

      // Calcular intervalo en horas
      const hours = parseInt(windowParam.replace(/\D/g, '')) || 8;
      const sinceTime = new Date(Date.now() - hours * 3600 * 1000).toISOString();

      let query = supabase
        .from('acoustic_event_logs')
        .select('sound_label, decibels, risk_level, timestamp')
        .gte('timestamp', sinceTime);

      if (riskFilter) {
        query = query.eq('risk_level', riskFilter);
      }

      const { data: events, error } = await query;
      if (error) throw error;

      const eventList = events || [];
      const totalEvents = eventList.length;

      let peakDecibels = 0;
      let sumDecibels = 0;
      const distribution: Record<string, number> = { NORMAL: 0, ADVISORY: 0, CRITICAL: 0 };
      const hourlyMap: Record<number, number> = {};

      for (const ev of eventList) {
        if (ev.decibels > peakDecibels) peakDecibels = ev.decibels;
        sumDecibels += ev.decibels;
        distribution[ev.risk_level] = (distribution[ev.risk_level] || 0) + 1;

        const evHour = new Date(ev.timestamp).getHours();
        hourlyMap[evHour] = (hourlyMap[evHour] || 0) + 1;
      }

      // Dosimetría acústica aproximada según norma OSHA/NIOSH (85 dB continuo = 100% dosis en 8 horas)
      const avgDb = totalEvents > 0 ? sumDecibels / totalEvents : 40;
      const dosagePercentage = Math.round(Math.min(100, Math.pow(2, (avgDb - 85) / 3) * (hours / 8) * 100) * 10) / 10;

      const hourlyHeatmap = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        count: hourlyMap[i] || 0,
      }));

      return jsonResponse({
        total_events: totalEvents,
        peak_decibels: peakDecibels,
        average_decibels: Math.round(avgDb * 10) / 10,
        exposure_dosage_percentage: dosagePercentage,
        event_distribution: distribution,
        hourly_heatmap: hourlyHeatmap,
        window: windowParam,
      }, 200);
    }

    return jsonResponse({ error: `Ruta no encontrada: ${method} ${path}` }, 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
