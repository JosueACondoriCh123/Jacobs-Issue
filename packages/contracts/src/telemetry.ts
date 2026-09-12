/**
 * Jacobs Issue - Contratos Compartidos Inmutables (Single Source of Truth)
 * Para integración entre Dev 1 (HUD), Dev 2 (DSP), Dev 3 (Backend) y Dev 4 (AI Model).
 */

export type RiskLevel = 'NORMAL' | 'ADVISORY' | 'CRITICAL';

export interface HUDTelemetry {
  azimuth: number;
  intensity: number;
  label: string;
  risk: RiskLevel;
  id?: string;
  kind?: 'level' | 'event';
  capturedAt?: string;
  emittedAt?: string;
  spatialConfidence?: number;
  directionValid?: boolean;
  model?: string;
}

export interface HUDTelemetryEvent extends HUDTelemetry {
  id: string;
  confidence: number;
  timestamp: string;
  source: 'mock' | 'broadcast' | 'postgres';
  decibels?: number;
}

export interface AcousticEventRow {
  id?: string;
  user_id?: string;
  timestamp?: string;
  sound_label: string;
  confidence: number;
  decibels: number;
  risk_level: RiskLevel;
  azimuth_angle: number;
  metadata?: Record<string, unknown>;
}

export interface NotificationDispatchRow {
  id?: string;
  event_id?: string;
  user_id?: string;
  dispatch_type: 'EMAIL_GMAIL' | 'RESEND' | 'WEBHOOK';
  recipient: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  payload: Record<string, unknown>;
  sent_at?: string;
  error_message?: string;
}

export const REALTIME_CHANNELS = {
  HUD_TELEMETRY: 'hud-telemetry',
} as const;

export const REALTIME_EVENTS = {
  TELEMETRY: 'telemetry',
  EMERGENCY: 'emergency',
} as const;

export interface CalibrationBaselinePayload {
  ambient_average_db: number;
  peak_transient_db: number;
  environment_type: string;
  user_id?: string;
  device_id?: string;
}

export interface CalibrationBaselineResponse {
  success: boolean;
  baseline_id: string;
  dynamic_threshold_db: number;
  ambient_average_db: number;
  peak_transient_db: number;
  environment_type: string;
  status: string;
  created_at?: string;
}

export interface DeviceProvisionPayload {
  device_id?: string;
  device_name?: string;
  device_room?: string;
  battery_level?: number;
  status?: string;
  user_id?: string;
}

export interface SensorDeviceRow {
  id: string;
  user_id?: string | null;
  device_name: string;
  device_room: string;
  battery_level?: number | null;
  status: string;
  last_heartbeat: string;
  created_at?: string;
}

export interface DeviceProvisionResponse {
  success: boolean;
  device_id: string;
  device: SensorDeviceRow;
}
