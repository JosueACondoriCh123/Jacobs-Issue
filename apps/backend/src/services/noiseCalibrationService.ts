/**
 * Jacobs Issue (PhonoSpatial HUD) - Noise Calibration Service (Dev 3)
 * Calibración dinámica del suelo de ruido (Noise Floor) en tiempo real
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface NoiseBaselineInput {
  ambient_average_db: number;
  peak_transient_db: number;
  environment_type?: string;
  user_id?: string | null;
}

export interface NoiseBaselineResult {
  baseline_id?: string;
  ambient_average_db: number;
  peak_transient_db: number;
  dynamic_threshold_db: number;
  environment_type: string;
  status: string;
  created_at: string;
}

export class NoiseCalibrationService {
  private static cachedBaseline: NoiseBaselineResult = {
    ambient_average_db: 42.0,
    peak_transient_db: 65.0,
    dynamic_threshold_db: 55.8,
    environment_type: 'indoor_default',
    status: 'default',
    created_at: new Date().toISOString(),
  };

  /**
   * Calcula el umbral dinámico adaptativo a partir del promedio y picos transitorios.
   */
  public static calculateDynamicThreshold(ambientAvg: number, peakTransient: number): number {
    const diff = Math.max(0, peakTransient - ambientAvg);
    return Math.round((ambientAvg + 0.6 * diff) * 10) / 10;
  }

  /**
   * Guarda una calibración y actualiza la caché en caliente.
   */
  public static async calibrate(
    input: NoiseBaselineInput,
    supabase: SupabaseClient
  ): Promise<NoiseBaselineResult> {
    const ambientAvg = Math.round(Number(input.ambient_average_db || 40.0) * 10) / 10;
    const peakTransient = Math.round(Number(input.peak_transient_db || ambientAvg + 20.0) * 10) / 10;
    const dynamicThreshold = this.calculateDynamicThreshold(ambientAvg, peakTransient);
    const envType = input.environment_type?.trim() || 'indoor_room';
    const now = new Date().toISOString();

    const result: NoiseBaselineResult = {
      ambient_average_db: ambientAvg,
      peak_transient_db: peakTransient,
      dynamic_threshold_db: dynamicThreshold,
      environment_type: envType,
      status: 'active',
      created_at: now,
    };

    // Actualizar caché de memoria en 0 ms
    this.cachedBaseline = result;

    try {
      const { data, error } = await supabase
        .from('noise_baselines')
        .insert({
          user_id: input.user_id || null,
          ambient_average_db: ambientAvg,
          peak_transient_db: peakTransient,
          dynamic_threshold_db: dynamicThreshold,
          environment_type: envType,
          status: 'active',
        })
        .select('id, created_at')
        .single();

      if (!error && data) {
        result.baseline_id = data.id;
        result.created_at = data.created_at;
      }
    } catch (err) {
      console.warn('[NoiseCalibrationService] Error persistiendo baseline en DB, usando caché local:', err);
    }

    return result;
  }

  /**
   * Obtiene la calibración activa más reciente.
   */
  public static async getLatest(
    userId: string | null,
    supabase: SupabaseClient
  ): Promise<NoiseBaselineResult> {
    try {
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
      if (!error && data && data.length > 0) {
        const row = data[0];
        this.cachedBaseline = {
          baseline_id: row.id,
          ambient_average_db: row.ambient_average_db,
          peak_transient_db: row.peak_transient_db,
          dynamic_threshold_db: row.dynamic_threshold_db,
          environment_type: row.environment_type,
          status: row.status,
          created_at: row.created_at,
        };
      }
    } catch {
      // Retornar la caché si falla la red
    }

    return this.cachedBaseline;
  }
}
