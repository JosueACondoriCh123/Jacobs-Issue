/**
 * Tipos de Base de Datos para EchoVision (Supabase PostgreSQL)
 * Esquema: public
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Tipos Enumerados de PostgreSQL
export type RiskLevelEnum = 'NORMAL' | 'ADVISORY' | 'CRITICAL';
export type DeviceTypeEnum = 'LAPTOP_HUD' | 'MOBILE_COMPANION' | 'IOT_EDGE_MICROPHONE';
export type NotificationChannelEnum = 'GMAIL' | 'WEBHOOK_IOT' | 'SMS';
export type DispatchStatusEnum = 'PENDING' | 'SENT' | 'FAILED' | 'ACKNOWLEDGED';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          emergency_email: string | null;
          haptic_enabled: boolean;
          strobe_enabled: boolean;
          high_contrast_mode: boolean;
          global_sensitivity_threshold: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          emergency_email?: string | null;
          haptic_enabled?: boolean;
          strobe_enabled?: boolean;
          high_contrast_mode?: boolean;
          global_sensitivity_threshold?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          emergency_email?: string | null;
          haptic_enabled?: boolean;
          strobe_enabled?: boolean;
          high_contrast_mode?: boolean;
          global_sensitivity_threshold?: number;
          updated_at?: string;
        };
      };
      spatial_zones: {
        Row: {
          id: string;
          user_id: string;
          zone_name: string;
          ambient_noise_floor_db: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          zone_name: string;
          ambient_noise_floor_db?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          zone_name?: string;
          ambient_noise_floor_db?: number;
          is_active?: boolean;
        };
      };
      devices: {
        Row: {
          id: string;
          user_id: string;
          zone_id: string | null;
          device_name: string;
          device_type: DeviceTypeEnum;
          battery_level: number | null;
          is_online: boolean;
          last_heartbeat: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          zone_id?: string | null;
          device_name: string;
          device_type?: DeviceTypeEnum;
          battery_level?: number | null;
          is_online?: boolean;
          last_heartbeat?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          zone_id?: string | null;
          device_name?: string;
          device_type?: DeviceTypeEnum;
          battery_level?: number | null;
          is_online?: boolean;
          last_heartbeat?: string;
        };
      };
      custom_sound_signatures: {
        Row: {
          id: string;
          user_id: string;
          label: string | null;
          spectral_centroid_hz: number | null;
          mfcc_signature: Json | null;
          default_risk: RiskLevelEnum;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          label?: string | null;
          spectral_centroid_hz?: number | null;
          mfcc_signature?: Json | null;
          default_risk?: RiskLevelEnum;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          label?: string | null;
          spectral_centroid_hz?: number | null;
          mfcc_signature?: Json | null;
          default_risk?: RiskLevelEnum;
        };
      };
      acoustic_incidents: {
        Row: {
          id: string;
          user_id: string;
          device_id: string | null;
          zone_id: string | null;
          sound_label: string;
          confidence: number;
          peak_decibels: number;
          azimuth_angle: number;
          risk_level: RiskLevelEnum;
          is_acknowledged: boolean;
          acknowledged_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          device_id?: string | null;
          zone_id?: string | null;
          sound_label: string;
          confidence: number;
          peak_decibels: number;
          azimuth_angle: number;
          risk_level: RiskLevelEnum;
          is_acknowledged?: boolean;
          acknowledged_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          device_id?: string | null;
          zone_id?: string | null;
          sound_label?: string;
          confidence?: number;
          peak_decibels?: number;
          azimuth_angle?: number;
          risk_level?: RiskLevelEnum;
          is_acknowledged?: boolean;
          acknowledged_at?: string | null;
        };
      };
      incident_telemetry_frames: {
        Row: {
          id: number;
          incident_id: string;
          fft_spectrum_bins: Json;
          timestamp_offset_ms: number;
        };
        Insert: {
          id?: number;
          incident_id: string;
          fft_spectrum_bins: Json;
          timestamp_offset_ms: number;
        };
        Update: {
          id?: number;
          incident_id?: string;
          fft_spectrum_bins?: Json;
          timestamp_offset_ms?: number;
        };
      };
      emergency_contacts: {
        Row: {
          id: string;
          user_id: string;
          contact_name: string | null;
          name?: string | null;
          email: string;
          phone: string | null;
          priority_order: number;
          notify_on_critical: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          contact_name?: string | null;
          name?: string | null;
          email: string;
          phone?: string | null;
          priority_order?: number;
          notify_on_critical?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          contact_name?: string | null;
          name?: string | null;
          email?: string;
          phone?: string | null;
          priority_order?: number;
          notify_on_critical?: boolean;
        };
      };
      notification_dispatch_logs: {
        Row: {
          id: string;
          incident_id: string | null;
          contact_id: string | null;
          channel: NotificationChannelEnum;
          status: DispatchStatusEnum;
          payload_summary: Json | null;
          dispatched_at: string;
          acknowledged_at: string | null;
        };
        Insert: {
          id?: string;
          incident_id?: string | null;
          contact_id?: string | null;
          channel?: NotificationChannelEnum;
          status?: DispatchStatusEnum;
          payload_summary?: Json | null;
          dispatched_at?: string;
          acknowledged_at?: string | null;
        };
        Update: {
          id?: string;
          incident_id?: string | null;
          contact_id?: string | null;
          channel?: NotificationChannelEnum;
          status?: DispatchStatusEnum;
          payload_summary?: Json | null;
          dispatched_at?: string;
          acknowledged_at?: string | null;
        };
      };
      dosimetry_daily_aggregates: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          cumulative_noise_dose_pct: number;
          peak_recorded_db: number;
          critical_events_count: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          date: string;
          cumulative_noise_dose_pct?: number;
          peak_recorded_db?: number;
          critical_events_count?: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          date?: string;
          cumulative_noise_dose_pct?: number;
          peak_recorded_db?: number;
          critical_events_count?: number;
        };
      };
      // Compatibilidad con tablas existentes
      acoustic_event_logs: {
        Row: {
          id: string;
          user_id: string | null;
          timestamp: string;
          sound_label: string;
          confidence: number;
          decibels: number;
          risk_level: string;
          azimuth_angle: number;
          metadata: Json | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          timestamp?: string;
          sound_label: string;
          confidence?: number;
          decibels?: number;
          risk_level: string;
          azimuth_angle?: number;
          metadata?: Json | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          timestamp?: string;
          sound_label?: string;
          confidence?: number;
          decibels?: number;
          risk_level?: string;
          azimuth_angle?: number;
          metadata?: Json | null;
        };
      };
      sensor_devices: {
        Row: {
          id: string;
          user_id: string | null;
          device_name: string;
          device_room: string;
          battery_level: number | null;
          status: string;
          last_heartbeat: string;
          created_at: string;
        };
        Insert: {
          id: string;
          user_id?: string | null;
          device_name: string;
          device_room: string;
          battery_level?: number | null;
          status?: string;
          last_heartbeat?: string;
          created_at?: string;
        };
        Update: {
          device_name?: string;
          device_room?: string;
          battery_level?: number | null;
          status?: string;
          last_heartbeat?: string;
        };
      };
    };
  };
}
