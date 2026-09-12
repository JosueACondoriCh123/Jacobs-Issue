-- ====================================================================
-- Jacobs Issue (PhonoSpatial HUD) - Migración 002: Tablas Auxiliares
-- Para Catálogo de Endpoints de Accesibilidad, Sensores y Calibración
-- ====================================================================

-- 1. Contactos de Emergencia (Endpoint 7: /api/v1/users/me/emergency-contacts)
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  relationship text DEFAULT 'contact',
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user ON public.emergency_contacts (user_id);

-- 2. Calibraciones Dinámicas de Ruido de Fondo (Endpoint 1: /api/v1/calibration/baseline)
CREATE TABLE IF NOT EXISTS public.noise_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ambient_average_db float NOT NULL,
  peak_transient_db float NOT NULL,
  dynamic_threshold_db float NOT NULL,
  environment_type text NOT NULL DEFAULT 'indoor_home',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_noise_baselines_user ON public.noise_baselines (user_id, created_at DESC);

-- 3. Huellas Acústicas Personalizadas (Endpoint 3: /api/v1/sounds/custom-enroll)
CREATE TABLE IF NOT EXISTS public.custom_sound_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  custom_label text NOT NULL,
  spectral_signature jsonb NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('NORMAL', 'ADVISORY', 'CRITICAL')),
  status text NOT NULL DEFAULT 'active',
  registered_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custom_signatures_user ON public.custom_sound_signatures (user_id);

-- 4. Registro de Nodos Sensores y Mesh (Endpoint 8: /api/v1/devices & Endpoint 4: /api/v1/mesh/relay-event)
CREATE TABLE IF NOT EXISTS public.sensor_devices (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  device_room text NOT NULL,
  battery_level float,
  status text NOT NULL DEFAULT 'online',
  last_heartbeat timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON public.sensor_devices (user_id);

-- 5. Preferencias de Personalización Sensorial (Endpoint 6: /api/v1/users/me/preferences)
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  perimeter_flash boolean DEFAULT true NOT NULL,
  haptic_vibration boolean DEFAULT true NOT NULL,
  high_contrast_palette boolean DEFAULT false NOT NULL,
  advisory_db_threshold float DEFAULT 70.0 NOT NULL,
  critical_db_threshold float DEFAULT 85.0 NOT NULL,
  auto_dispatch_alerts boolean DEFAULT true NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
