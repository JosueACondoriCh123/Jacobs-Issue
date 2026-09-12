/**
 * Conversion de nivel: RMS digital -> dBFS -> dB SPL *estimado*.
 *
 * IMPORTANTE, y se repite en la interfaz de usuario: la Web Audio API solo
 * entrega amplitud relativa a fondo de escala (dBFS). Un dB SPL absoluto
 * exigiria un microfono calibrado. Hacemos dB_SPL ~= dBFS + offset, donde el
 * offset se ajusta a mano contra un sonometro de referencia. Presentar esto
 * como medicion absoluta seria falso; se etiqueta siempre como "estimado".
 */

/** Offset por defecto para microfonos integrados de portatil. */
export const DEFAULT_SPL_OFFSET_DB = 100;

/** Por debajo de esto consideramos silencio digital y evitamos log(0). */
const EPSILON = 1e-10;

/** @param {number} rms @returns {number} dBFS (negativo) */
export function rmsToDbfs(rms) {
  return 20 * Math.log10(Math.max(rms, EPSILON));
}

/**
 * @param {number} dbfs @param {number} [offsetDb]
 * @returns {number} dB(A) SPL estimado, recortado a un rango fisicamente sensato
 */
export function dbfsToSpl(dbfs, offsetDb = DEFAULT_SPL_OFFSET_DB) {
  return clamp(dbfs + offsetDb, 0, 140);
}

/**
 * Normaliza dB(A) al 0..1 que consume el HUD.
 * 30 dB(A) (habitacion silenciosa) -> 0 ; 90 dB(A) (trafico intenso) -> 1.
 * @param {number} db @returns {number}
 */
export function intensityFromDb(db) {
  return clamp((db - 30) / 60, 0, 1);
}

/**
 * Riesgo preliminar, solo por nivel. Dev 4 lo refina con la etiqueta semantica
 * (una alarma de incendio a 70 dB es CRITICAL aunque el nivel no lo sugiera).
 * @param {number} db @returns {'NORMAL'|'ADVISORY'|'CRITICAL'}
 */
export function riskFromDb(db) {
  if (db >= 85) return 'CRITICAL';
  if (db >= 70) return 'ADVISORY';
  return 'NORMAL';
}

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
