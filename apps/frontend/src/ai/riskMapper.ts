import { lookupYamnetLabel } from './labels';
import type { RiskLevel } from '../types/hud';

/**
 * Riesgo preliminar solo por nivel (duplicado intencional de 1 funcion de
 * Dev 2: importar su DSP acoplaria los modulos y violaria el aislamiento).
 */
export function riskFromDb(db: number): RiskLevel {
  if (db >= 85) return 'CRITICAL';
  if (db >= 70) return 'ADVISORY';
  return 'NORMAL';
}

/**
 * Etiquetas cuyo significado exige CRITICAL aunque el nivel no lo sugiera:
 * una alarma de incendio a 65 dB sigue siendo una alarma de incendio.
 */
const CRITICAL_OVERRIDE = new Set([
  'siren',
  'fire alarm',
  'smoke detector, smoke alarm',
  'alarm',
  'burglar alarm',
  'screaming',
  'glass',
  'explosion',
  'gunshot, gunfire',
]);

/** Etiquetas que elevan el piso a ADVISORY aunque el nivel sea bajo. */
const ADVISORY_FLOOR = new Set([
  'vehicle horn, car horn, honking',
  'crying, sobbing',
  'baby cry, infant cry',
  'dog',
  'bark',
  'thunder',
  'thump, thud',
  'knock',
  'doorbell',
  'telephone bell ringing',
  'bicycle',
  'car',
  'car passing by',
  'motorcycle',
  'truck',
  'bus',
  'car alarm',
  'engine starting',
]);

export function refineRisk(yamnetLabel: string, dbRisk: RiskLevel): RiskLevel {
  const key = yamnetLabel.trim().toLowerCase();
  if (CRITICAL_OVERRIDE.has(key)) return 'CRITICAL';
  if (ADVISORY_FLOOR.has(key)) return dbRisk === 'CRITICAL' ? 'CRITICAL' : 'ADVISORY';
  return dbRisk;
}

/** Etiqueta HUD en español + riesgo semantico final para una prediccion. */
export function resolvePrediction(
  yamnetLabel: string,
  decibels: number,
): { es: string; risk: RiskLevel } {
  const entry = lookupYamnetLabel(yamnetLabel);
  const dbRisk = riskFromDb(decibels);
  if (!entry) return { es: 'Sonido sin clasificar', risk: dbRisk };
  return { es: entry.es, risk: refineRisk(yamnetLabel, dbRisk) };
}
