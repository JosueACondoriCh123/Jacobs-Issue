export interface CalibrationBaselinePayload {
  ambient_average_db: number;
  peak_transient_db: number;
  environment_type: string;
}

/** Suelo de ruido adaptativo por percentil movil (inmune a transitorios). */
export class NoiseFloorTracker {
  constructor(opts?: {
    windowSeconds?: number;
    updatesPerSecond?: number;
    percentile?: number;
  });
  readonly floorDb: number;
  readonly peakDb: number;
  readonly ambientAverageDb: number;
  push(db: number): void;
  /** Payload exacto de POST /api/v1/calibration/baseline. */
  toCalibrationBaseline(environmentType?: string): CalibrationBaselinePayload;
  reset(): void;
}
