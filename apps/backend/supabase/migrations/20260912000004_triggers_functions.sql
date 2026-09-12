-- ====================================================================
-- Jacobs Issue (PhonoSpatial HUD) - Migración 004: Triggers & Funciones
-- Automatización de Google OAuth y Despacho de Alertas Críticas
-- ====================================================================

-- 1. Función para actualizar timestamps automáticamente
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de actualización de timestamp
DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_emergency_contacts_updated_at ON public.emergency_contacts;
CREATE TRIGGER set_emergency_contacts_updated_at
  BEFORE UPDATE ON public.emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER set_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Automatización de Google OAuth: Creación de Perfil y Preferencias Iniciales
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Crear perfil de usuario con metadatos de Google
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Usuario Jacobs Issue'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  -- Crear preferencias sensoriales por defecto
  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger asociado a auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Trigger Automático para Alertas Críticas (Auto-Queue a notification_dispatch_logs)
CREATE OR REPLACE FUNCTION public.handle_critical_acoustic_event()
RETURNS TRIGGER AS $$
DECLARE
  v_contact RECORD;
BEGIN
  -- Solo accionar si el evento clasificado es de riesgo CRITICAL
  IF NEW.risk_level = 'CRITICAL' AND NEW.user_id IS NOT NULL THEN
    -- Encontrar contactos de emergencia activos para el usuario
    FOR v_contact IN 
      SELECT id, email, name 
      FROM public.emergency_contacts 
      WHERE user_id = NEW.user_id AND is_active = true
    LOOP
      -- Encolar despacho inmediato de alerta
      INSERT INTO public.notification_dispatch_logs (
        event_id,
        user_id,
        dispatch_type,
        recipient,
        status,
        payload
      ) VALUES (
        NEW.id,
        NEW.user_id,
        'EMAIL_GMAIL',
        v_contact.email,
        'PENDING',
        jsonb_build_object(
          'contact_name', v_contact.name,
          'sound_label', NEW.sound_label,
          'decibels', NEW.decibels,
          'azimuth_angle', NEW.azimuth_angle,
          'confidence', NEW.confidence,
          'timestamp', NEW.timestamp
        )
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_critical_acoustic_event ON public.acoustic_event_logs;
CREATE TRIGGER on_critical_acoustic_event
  AFTER INSERT ON public.acoustic_event_logs
  FOR EACH ROW
  WHEN (NEW.risk_level = 'CRITICAL')
  EXECUTE FUNCTION public.handle_critical_acoustic_event();
