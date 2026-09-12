/**
 * Ponderacion A (IEC 61672) como cascada de biquads.
 *
 * Diseno por matched-z transform: los 4 ceros analogicos en s=0 se mapean a z=1,
 * y cada polo analogico en s=-2*pi*f se mapea a z=exp(-2*pi*f/fs).
 * La ganancia se normaliza numericamente a 0 dB en 1 kHz, que es la definicion
 * de la curva A.
 *
 * Sin esto, "60 dB" no significaria nada: la curva A es lo que hace que la
 * lectura se parezca a como el oido percibe el nivel.
 */

const F1 = 20.598997;
const F2 = 107.65265;
const F3 = 737.86223;
const F4 = 12194.217;

/** Biquad Direct Form I: y = b0*x + b1*x1 + b2*x2 - a1*y1 - a2*y2 */
class Biquad {
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2;
    this.a1 = a1; this.a2 = a2;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }

  /** @param {number} x @returns {number} */
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }

  reset() { this.x1 = this.x2 = this.y1 = this.y2 = 0; }

  /** Respuesta |H(e^jw)|. @param {number} w rad/muestra @returns {number} */
  magnitudeAt(w) {
    const cw = Math.cos(w), sw = Math.sin(w);
    const c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);
    const nRe = this.b0 + this.b1 * cw + this.b2 * c2w;
    const nIm = -(this.b1 * sw + this.b2 * s2w);
    const dRe = 1 + this.a1 * cw + this.a2 * c2w;
    const dIm = -(this.a1 * sw + this.a2 * s2w);
    return Math.hypot(nRe, nIm) / Math.hypot(dRe, dIm);
  }
}

export class AWeightingFilter {
  /** @param {number} sampleRate */
  constructor(sampleRate) {
    const p = (f) => Math.exp((-2 * Math.PI * f) / sampleRate);
    const p1 = p(F1), p2 = p(F2), p3 = p(F3), p4 = p(F4);

    // Seccion 1: dos ceros en z=1, polo doble en p1
    const s1 = new Biquad(1, -2, 1, -2 * p1, p1 * p1);
    // Seccion 2: dos ceros en z=1, polos en p2 y p3
    const s2 = new Biquad(1, -2, 1, -(p2 + p3), p2 * p3);
    // Seccion 3: sin ceros, polo doble en p4
    const s3 = new Biquad(1, 0, 0, -2 * p4, p4 * p4);

    this.sections = [s1, s2, s3];

    // Por definicion la curva A vale 0 dB a 1 kHz.
    const w1k = (2 * Math.PI * 1000) / sampleRate;
    let mag = 1;
    for (const s of this.sections) mag *= s.magnitudeAt(w1k);
    this.gain = 1 / mag;
  }

  /** @param {number} x @returns {number} muestra ponderada en A */
  process(x) {
    let y = x;
    for (let i = 0; i < this.sections.length; i++) y = this.sections[i].process(y);
    return y * this.gain;
  }

  /**
   * Procesa un bloque devolviendo RMS y pico, sin asignar memoria.
   * @param {Float32Array} block
   * @returns {{ rms: number, peak: number }}
   */
  processBlockStats(block) {
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < block.length; i++) {
      const y = this.process(block[i]);
      sumSq += y * y;
      const a = y < 0 ? -y : y;
      if (a > peak) peak = a;
    }
    return { rms: Math.sqrt(sumSq / block.length), peak };
  }

  reset() { for (const s of this.sections) s.reset(); }

  /**
   * Respuesta de la cascada en dB. Usado por el test offline para contrastar
   * contra los valores tabulados de la IEC 61672.
   * @param {number} freqHz @param {number} sampleRate @returns {number} dB
   */
  responseDb(freqHz, sampleRate) {
    const w = (2 * Math.PI * freqHz) / sampleRate;
    let mag = this.gain;
    for (const s of this.sections) mag *= s.magnitudeAt(w);
    return 20 * Math.log10(mag);
  }
}
