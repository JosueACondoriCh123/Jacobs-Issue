/**
 * Suelo de ruido adaptativo por percentil movil.
 *
 * Usar la media seria un error: un solo portazo la desplazaria durante segundos
 * y el detector de onsets quedaria sordo justo despues del evento mas interesante.
 * El percentil 10 sobre una ventana de 5 s ignora los transitorios y sigue al
 * ambiente real.
 *
 * Produce ademas, tal cual, el payload de POST /api/v1/calibration/baseline.
 */
export class NoiseFloorTracker {
  /**
   * @param {object} [opts]
   * @param {number} [opts.windowSeconds=5]
   * @param {number} [opts.updatesPerSecond=47] ritmo con el que se llama a push()
   * @param {number} [opts.percentile=0.1]
   */
  constructor({ windowSeconds = 5, updatesPerSecond = 47, percentile = 0.1 } = {}) {
    this.capacity = Math.max(16, Math.round(windowSeconds * updatesPerSecond));
    this.percentile = percentile;
    this.buf = new Float64Array(this.capacity);
    this.count = 0;
    this.head = 0;
    this._sorted = new Float64Array(this.capacity);
    this.floorDb = 30;
    this.peakDb = 0;
  }

  /** @param {number} db */
  push(db) {
    this.buf[this.head] = db;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    if (db > this.peakDb) this.peakDb = db;

    const n = this.count;
    const s = this._sorted.subarray(0, n);
    s.set(this.buf.subarray(0, n));
    s.sort();
    const idx = Math.min(n - 1, Math.floor(this.percentile * n));
    this.floorDb = s[idx];
  }

  /** Mediana del ambiente: mas representativa que la media aritmetica. */
  get ambientAverageDb() {
    const n = this.count;
    if (n === 0) return this.floorDb;
    const s = this._sorted.subarray(0, n);
    return s[Math.floor(0.5 * n)];
  }

  /**
   * @param {string} [environmentType]
   * @returns {{ambient_average_db:number, peak_transient_db:number, environment_type:string}}
   */
  toCalibrationBaseline(environmentType = 'unknown') {
    return {
      ambient_average_db: round1(this.ambientAverageDb),
      peak_transient_db: round1(this.peakDb),
      environment_type: environmentType,
    };
  }

  reset() {
    this.count = 0;
    this.head = 0;
    this.peakDb = 0;
    this.floorDb = 30;
  }
}

function round1(v) { return Math.round(v * 10) / 10; }
