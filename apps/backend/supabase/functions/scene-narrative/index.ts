// ====================================================================
// Jacobs Issue (PhonoSpatial HUD) - Edge Function: scene-narrative
// Endpoint: POST /api/v1/intelligence/scene-narrative
// Síntesis contextual en lenguaje natural mediante LLM/IA de los eventos acústicos
// ====================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

interface NarrativeRequest {
  time_window_seconds?: number;
  include_recommendations?: boolean;
  user_id?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: NarrativeRequest = await req.json().catch(() => ({}));
    const timeWindow = body.time_window_seconds || 60;
    const includeRecs = body.include_recommendations !== false;

    // 1. Obtener eventos de la ventana de tiempo
    const timeLimit = new Date(Date.now() - timeWindow * 1000).toISOString();

    let query = supabase
      .from('acoustic_event_logs')
      .select('sound_label, confidence, decibels, risk_level, azimuth_angle, timestamp')
      .gte('timestamp', timeLimit)
      .order('timestamp', { ascending: false })
      .limit(30);

    if (body.user_id) {
      query = query.eq('user_id', body.user_id);
    }

    const { data: events, error } = await query;

    if (error) {
      throw new Error(`Error consultando eventos acústicos: ${error.message}`);
    }

    const eventList = events || [];

    // 2. Determinar nivel de urgencia general
    let urgencyLevel: 'NORMAL' | 'ADVISORY' | 'CRITICAL' = 'NORMAL';
    if (eventList.some((e) => e.risk_level === 'CRITICAL')) {
      urgencyLevel = 'CRITICAL';
    } else if (eventList.some((e) => e.risk_level === 'ADVISORY')) {
      urgencyLevel = 'ADVISORY';
    }

    // 3. Generar síntesis contextual
    let narrativeSummary = '';
    let recommendedAction = '';

    if (eventList.length === 0) {
      narrativeSummary = 'Entorno acústico en calma. No se han detectado variaciones sonoras significativas en la última ventana de tiempo.';
      recommendedAction = 'Continuar monitoreo pasivo en HUD.';
    } else if (geminiApiKey) {
      // Síntesis avanzada mediante Gemini API si la API key está disponible
      try {
        const eventsPrompt = eventList.map(e => `- [${e.timestamp}] ${e.sound_label} (${e.decibels} dB, azimut ${e.azimuth_angle}°, riesgo ${e.risk_level})`).join('\n');
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Eres el motor de asistencia auditiva Jacobs Issue para personas sordas. Sintetiza en 2 oraciones concisas el entorno sonoro actual para el usuario basándote en estos eventos recientes:\n${eventsPrompt}\nResponde en formato JSON con dos campos: "narrative_summary" y "recommended_action".`
              }]
            }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const parsed = JSON.parse(geminiData.candidates[0].content.parts[0].text);
          narrativeSummary = parsed.narrative_summary;
          recommendedAction = parsed.recommended_action;
        }
      } catch (err) {
        console.warn('[scene-narrative] Fallback a generador heurístico:', err);
      }
    }

    // Fallback heurístico inteligente
    if (!narrativeSummary) {
      const topEvent = eventList[0];
      const count = eventList.length;

      if (urgencyLevel === 'CRITICAL') {
        narrativeSummary = `¡ALERTA CRÍTICA! Se detectó ${topEvent.sound_label} a ${topEvent.decibels} dB proveniente de ${topEvent.azimuth_angle}° (${count} eventos registrados). Posible situación de peligro en el entorno inmediato.`;
        recommendedAction = 'Orientar la vista hacia el vector indicado en el HUD y buscar zona segura de inmediato.';
      } else if (urgencyLevel === 'ADVISORY') {
        narrativeSummary = `Actividad acústica notable: detección reiterada de ${topEvent.sound_label} a ${topEvent.decibels} dB desde ${topEvent.azimuth_angle}°. Ruido moderadamente elevado.`;
        recommendedAction = 'Mantener atención visual a señales perimetrales del HUD.';
      } else {
        narrativeSummary = `Condiciones normales. Sonidos ambientales cotidianos (${topEvent.sound_label}, media de ${topEvent.decibels} dB).`;
        recommendedAction = 'Ninguna acción requerida.';
      }
    }

    const responsePayload = {
      narrative_summary: narrativeSummary,
      urgency_level: urgencyLevel,
      recommended_action: includeRecs ? recommendedAction : undefined,
      events_analyzed: eventList.length,
      time_window_seconds: timeWindow,
      timestamp: new Date().toISOString(),
    };

    return new Response(
      JSON.stringify(responsePayload),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
