import { supabase } from '../lib/supabase';
import type { AcousticEventRow } from '../types/hud';

/**
 * Fila de ingesta de Dev 4: el espejo local de Dev 1 (`types/hud.ts`) no trae
 * `metadata`, asi que se extiende aqui en vez de editar su archivo (aislamiento).
 */
export interface IngestRow extends AcousticEventRow {
  metadata?: Record<string, unknown>;
}

/** Inserta una fila; true si Supabase confirmo, false si no hay backend o fallo. */
export type PersistFn = (row: IngestRow) => Promise<boolean>;

export interface PersistedRow extends IngestRow {
  sound_label: string;
  confidence: number;
  decibels: number;
  risk_level: string;
  azimuth_angle: number;
}

/**
 * Persistencia real: INSERT en acoustic_event_logs. La RLS (migracion 003)
 * permite insertar a anon/authenticated/service_role, asi que funciona con la
 * clave publicable del frontend. El trigger de Dev 3 despacha CRITICAL solo.
 * Sin credenciales (demo), resuelve false sin lanzar: la etiqueta sigue viva
 * para el HUD via broadcast, solo no hay auditoria persistente.
 */
export function createSupabasePersist(userId?: string | null): PersistFn {
  return async (row) => {
    if (!supabase) return false;
    const { error } = await supabase.from('acoustic_event_logs').insert({
      user_id: userId ?? null,
      sound_label: row.sound_label,
      confidence: row.confidence,
      decibels: row.decibels,
      risk_level: row.risk_level,
      azimuth_angle: row.azimuth_angle,
      ...(row.metadata ? { metadata: row.metadata } : {}),
    });
    if (error) {
      console.warn('[dev4] ingest fallo:', error.message);
      return false;
    }
    return true;
  };
}

/** Persistencia en memoria para tests y demo sin backend. */
export function createMemoryPersist(sink: PersistedRow[]): PersistFn {
  return async (row) => {
    sink.push(row as PersistedRow);
    return true;
  };
}
