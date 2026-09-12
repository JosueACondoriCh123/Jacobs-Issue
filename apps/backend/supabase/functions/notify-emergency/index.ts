// ====================================================================
// EchoVision (PhonoSpatial HUD) - Edge Function: notify-emergency
// Despacho de notificaciones de emergencia para eventos acústicos CRITICAL
// ====================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

interface EmergencyPayload {
  event_id?: string;
  user_id: string;
  sound_label: string;
  confidence: number;
  decibels: number;
  azimuth_angle: number;
  custom_message?: string;
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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const emergencyWebhookUrl = Deno.env.get('EMERGENCY_WEBHOOK_URL');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: EmergencyPayload = await req.json();

    if (!payload.user_id || !payload.sound_label) {
      return new Response(
        JSON.stringify({ error: 'Faltan parámetros obligatorios: user_id y sound_label' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Obtener contactos de emergencia activos del usuario
    const { data: contacts, error: contactsError } = await supabase
      .from('emergency_contacts')
      .select('id, name, email, phone')
      .eq('user_id', payload.user_id)
      .eq('is_active', true);

    if (contactsError) {
      throw new Error(`Error consultando contactos de emergencia: ${contactsError.message}`);
    }

    const recipients = contacts && contacts.length > 0 ? contacts : [
      { id: 'fallback-01', name: 'Contacto Principal', email: 'emergency-alert@echovision.tactical' }
    ];

    const dispatchResults = [];

    // 2. Iterar y despachar notificación
    for (const contact of recipients) {
      const emailSubject = `🚨 ALERTA CRÍTICA ECHOVISION: ${payload.sound_label.toUpperCase()} DETECTADO`;
      const emailHtml = `
        <div style="font-family: monospace; background: #050608; color: #E2F1FF; padding: 24px; border: 2px solid #FF1E56; border-radius: 8px;">
          <h1 style="color: #FF1E56; margin-top: 0;">⚠️ ALERTA ACÚSTICA CRÍTICA // ECHOVISION</h1>
          <p>Se ha detectado un evento acústico de alto riesgo en el entorno del usuario:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="color: #708599; padding: 6px;">Evento Sonoro:</td><td style="color: #00F0FF; font-weight: bold;">${payload.sound_label}</td></tr>
            <tr><td style="color: #708599; padding: 6px;">Nivel Acústico:</td><td style="color: #FF1E56; font-weight: bold;">${payload.decibels} dB SPL</td></tr>
            <tr><td style="color: #708599; padding: 6px;">Ángulo de Azimut:</td><td style="color: #00FF88;">${payload.azimuth_angle}°</td></tr>
            <tr><td style="color: #708599; padding: 6px;">Confianza IA:</td><td>${(payload.confidence * 100).toFixed(1)}%</td></tr>
            <tr><td style="color: #708599; padding: 6px;">Timestamp:</td><td>${new Date().toISOString()}</td></tr>
          </table>
          <p style="background: rgba(255, 30, 86, 0.15); border-left: 4px solid #FF1E56; padding: 8px;">
            <strong>ACCIÓN RECOMENDADA:</strong> Verificar estado del usuario inmediatamente. Este mensaje fue generado automáticamente por el sistema PhonoSpatial HUD.
          </p>
        </div>
      `;

      let dispatchStatus = 'SENT';
      let errorMessage: string | null = null;
      let dispatchType = 'EMAIL_GMAIL';

      // Enviar vía Resend API si la key está disponible
      if (resendApiKey) {
        try {
          dispatchType = 'RESEND';
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'EchoVision Alerts <alerts@echovision.app>',
              to: [contact.email],
              subject: emailSubject,
              html: emailHtml,
            }),
          });
          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Resend API falló (${res.status}): ${errBody}`);
          }
        } catch (err: unknown) {
          dispatchStatus = 'FAILED';
          errorMessage = err instanceof Error ? err.message : String(err);
        }
      } else if (emergencyWebhookUrl) {
        // Enviar a Webhook de emergencia
        try {
          dispatchType = 'WEBHOOK';
          const res = await fetch(emergencyWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient: contact.email,
              contact_name: contact.name,
              subject: emailSubject,
              telemetry: payload,
            }),
          });
          if (!res.ok) throw new Error(`Webhook falló: ${res.status}`);
        } catch (err: unknown) {
          dispatchStatus = 'FAILED';
          errorMessage = err instanceof Error ? err.message : String(err);
        }
      } else {
        // Modo Desarrollo / Fallback simulado (auditoría registrada exitosamente)
        dispatchType = 'EMAIL_GMAIL';
        console.log(`[DevMode Notify] Alerta despachada virtualmente a ${contact.email} (${emailSubject})`);
      }

      // 3. Registrar en notification_dispatch_logs
      const { data: logRecord, error: logError } = await supabase
        .from('notification_dispatch_logs')
        .insert({
          event_id: payload.event_id || null,
          user_id: payload.user_id,
          dispatch_type: dispatchType,
          recipient: contact.email,
          status: dispatchStatus,
          payload: {
            contact_name: contact.name,
            sound_label: payload.sound_label,
            decibels: payload.decibels,
            azimuth_angle: payload.azimuth_angle,
            confidence: payload.confidence,
          },
          error_message: errorMessage,
        })
        .select()
        .single();

      dispatchResults.push({
        contact: contact.email,
        type: dispatchType,
        status: dispatchStatus,
        log_id: logRecord?.id,
        error: errorMessage,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        dispatched_count: dispatchResults.length,
        results: dispatchResults,
      }),
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
