export type RiskLevel = 'NORMAL' | 'ADVISORY' | 'CRITICAL';

/** Offset por defecto para microfonos integrados de portatil. */
export const DEFAULT_SPL_OFFSET_DB: number;

export function rmsToDbfs(rms: number): number;

/** dB SPL *estimado*: dBFS + offset calibrable. No es una medida absoluta. */
export function dbfsToSpl(dbfs: number, offsetDb?: number): number;

/** Normaliza dB(A) a 0..1 (30 dB -> 0, 90 dB -> 1). */
export function intensityFromDb(db: number): number;

/** Riesgo preliminar solo por nivel; Dev 4 lo refina con la etiqueta. */
export function riskFromDb(db: number): RiskLevel;

export function clamp(v: number, lo: number, hi: number): number;
