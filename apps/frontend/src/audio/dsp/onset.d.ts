/** Deteccion de eventos discretos: umbral relativo + histeresis + refractario. */
export class OnsetDetector {
  constructor(opts?: { triggerDb?: number; releaseDb?: number; refractoryMs?: number });
  readonly triggerDb: number;
  /** true solo en el frame de ataque de un evento. */
  update(db: number, floorDb: number, nowMs: number): boolean;
  thresholdDb(floorDb: number): number;
  reset(): void;
}
