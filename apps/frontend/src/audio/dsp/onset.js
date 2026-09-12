/**
 * Deteccion de eventos acusticos discretos.
 *
 * Razon de ser: publicar cada bloque analizado como "evento" saturaria el canal
 * broadcast de Supabase (y su rate limit) y llenaria acoustic_event_logs de ruido.
 * Solo el ataque de un sonido merece ser un evento.
 *
 * Tres mecanismos combinados:
 *  - Umbral RELATIVO al suelo de ruido, no absoluto: funciona igual en una
 *    biblioteca que en una cafeteria.
 *  - Histeresis: dispara a +12 dB sobre el suelo, pero no se rearma hasta bajar
 *    de +6 dB. Evita el parpadeo cuando el nivel oscila sobre el umbral.
 *  - Periodo refractario: tras disparar, ignora 300 ms. Una palmada produce
 *    exactamente un evento, no una rafaga.
 */
export class OnsetDetector {
  /**
   * @param {object} [opts]
   * @param {number} [opts.triggerDb=12] dB sobre el suelo de ruido para disparar
   * @param {number} [opts.releaseDb=6] dB sobre el suelo para rearmar
   * @param {number} [opts.refractoryMs=300]
   */
  constructor({ triggerDb = 12, releaseDb = 6, refractoryMs = 300 } = {}) {
    this.triggerDb = triggerDb;
    this.releaseDb = releaseDb;
    this.refractoryMs = refractoryMs;
    this.armed = true;
    this.lastTriggerMs = -Infinity;
  }

  /**
   * @param {number} db nivel actual dB(A)
   * @param {number} floorDb suelo de ruido vigente
   * @param {number} nowMs
   * @returns {boolean} true solo en el frame de ataque
   */
  update(db, floorDb, nowMs) {
    const excess = db - floorDb;

    if (!this.armed && excess < this.releaseDb) {
      this.armed = true;
    }

    if (this.armed && excess >= this.triggerDb) {
      if (nowMs - this.lastTriggerMs >= this.refractoryMs) {
        this.armed = false;
        this.lastTriggerMs = nowMs;
        return true;
      }
      this.armed = false;
    }

    return false;
  }

  /** Umbral absoluto vigente, para mostrarlo en la UI de pruebas. */
  thresholdDb(floorDb) { return floorDb + this.triggerDb; }

  reset() {
    this.armed = true;
    this.lastTriggerMs = -Infinity;
  }
}
