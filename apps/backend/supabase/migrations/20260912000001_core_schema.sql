-- ====================================================================
-- EchoVision (PhonoSpatial HUD) - Migración 001: Core Schema
-- Tablas persistentes: profiles, acoustic_event_logs, notification_dispatch_logs
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tabla de Perfiles de Usuario (vinculada a Google OAuth / auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.profiles IS 'Perfil extendido de usuario sincronizado automáticamente desde Supabase Auth (Google OAuth)';

-- 2. Tabla de Eventos Acústicos en Tiempo Real (Persistencia SED & Telemetría)
CREATE TABLE IF NOT EXISTS public.acoustic_event_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  timestamp timestamptz DEFAULT now() NOT NULL,
  sound_label text NOT NULL,
  confidence float NOT NULL DEFAULT 0.0,
  decibels float NOT NULL DEFAULT 0.0,
  risk_level text NOT NULL CHECK (risk_level IN ('NORMAL', 'ADVISORY', 'CRITICAL')),
  azimuth_angle float NOT NULL DEFAULT 0.0,
  metadata jsonb DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.acoustic_event_logs IS 'Bitácora persistente de eventos acústicos espaciales 360° clasificados por YAMNet/SED e insertados a 60 FPS';

-- Índices de alto rendimiento para consultas analíticas y tiempo real
CREATE INDEX IF NOT EXISTS idx_acoustic_events_timestamp ON public.acoustic_event_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_acoustic_events_user_time ON public.acoustic_event_logs (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_acoustic_events_risk ON public.acoustic_event_logs (risk_level);

-- 3. Tabla de Despacho y Auditoría de Notificaciones Críticas
CREATE TABLE IF NOT EXISTS public.notification_dispatch_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.acoustic_event_logs(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  dispatch_type text NOT NULL CHECK (dispatch_type IN ('EMAIL_GMAIL', 'RESEND', 'WEBHOOK', 'SMS')),
  recipient text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  payload jsonb NOT NULL,
  sent_at timestamptz DEFAULT now() NOT NULL,
  error_message text
);

COMMENT ON TABLE public.notification_dispatch_logs IS 'Auditoría inmutable de alertas críticas despachadas a contactos de emergencia vía Gmail API / Resend / Webhooks';

CREATE INDEX IF NOT EXISTS idx_notifications_user_sent ON public.notification_dispatch_logs (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_event ON public.notification_dispatch_logs (event_id);
