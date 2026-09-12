-- ====================================================================
-- EchoVision (PhonoSpatial HUD) - Migración 003: Row Level Security (RLS) & Realtime
-- Protección de datos de usuario e inclusión en canal Realtime a 60 FPS
-- ====================================================================

-- 1. Habilitar RLS en todas las tablas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acoustic_event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_dispatch_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.noise_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_sound_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- 2. Políticas para 'profiles'
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 3. Políticas para 'acoustic_event_logs'
-- Los usuarios leen sus propios registros o registros anónimos de demostración
CREATE POLICY "Users and HUD can read acoustic events"
  ON public.acoustic_event_logs FOR SELECT
  USING (user_id IS NULL OR auth.uid() = user_id);

-- El AI Worker (Dev 4) y sensores autorizados pueden insertar clasificaciones
CREATE POLICY "Ingest workers and authenticated users can insert acoustic events"
  ON public.acoustic_event_logs FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' OR 
    auth.role() = 'service_role' OR 
    auth.role() = 'anon'
  );

-- 4. Políticas para 'notification_dispatch_logs'
CREATE POLICY "Users can read own notification logs"
  ON public.notification_dispatch_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Edge functions and system can insert notification logs"
  ON public.notification_dispatch_logs FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR auth.uid() = user_id);

-- 5. Políticas para 'emergency_contacts'
CREATE POLICY "Users manage own emergency contacts"
  ON public.emergency_contacts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 6. Políticas para 'noise_baselines'
CREATE POLICY "Users access own noise baselines"
  ON public.noise_baselines FOR SELECT
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users insert noise baselines"
  ON public.noise_baselines FOR INSERT
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- 7. Políticas para 'custom_sound_signatures'
CREATE POLICY "Users manage own sound signatures"
  ON public.custom_sound_signatures FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 8. Políticas para 'sensor_devices'
CREATE POLICY "Users manage own sensor devices"
  ON public.sensor_devices FOR ALL
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- 9. Políticas para 'user_preferences'
CREATE POLICY "Users manage own preferences"
  ON public.user_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ====================================================================
-- 10. Configuración de Supabase Realtime (Postgres Changes)
-- ====================================================================
ALTER TABLE public.acoustic_event_logs REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'acoustic_event_logs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.acoustic_event_logs;
    END IF;
  END IF;
END $$;
