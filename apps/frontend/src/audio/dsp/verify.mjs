/**
 * Verificacion offline del nucleo DSP. Node puro, sin framework de tests.
 *   node apps/frontend/src/audio/dsp/verify.mjs
 *
 * Valida los algoritmos sin depender de hardware ni de la acustica de la sala,
 * que es justo lo que no se puede dar por bueno en la sede de un hackathon.
 */
import { fft, nextPow2 } from './fft.js';
import { AWeightingFilter } from './aWeighting.js';
import { GccPhatEstimator, heuristicAzimuthFromSpectrum } from './gccPhat.js';
import { NoiseFloorTracker } from './noiseFloor.js';
import { OnsetDetector } from './onset.js';
import { rmsToDbfs, dbfsToSpl, intensityFromDb, riskFromDb } from './spl.js';

let failures = 0;
let checks = 0;

function ok(name, cond, detail) {
  checks++;
  const suffix = detail ? '  ' + detail : '';
  if (cond) {
    console.log('  PASS  ' + name + suffix);
  } else {
    failures++;
    console.log('  FAIL  ' + name + suffix);
  }
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

const FS = 48000;

// ---------------------------------------------------------------- FFT
console.log('\n[1] FFT');
{
  // Una sinusoide pura debe dar un unico pico en su bin.
  const n = 1024;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const bin = 64;
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);
  fft(re, im, false);
  let peakBin = 0;
  let peakMag = 0;
  for (let i = 0; i < n / 2; i++) {
    const m = Math.hypot(re[i], im[i]);
    if (m > peakMag) { peakMag = m; peakBin = i; }
  }
  ok('pico en el bin correcto', peakBin === bin, 'bin=' + peakBin + ' esperado=' + bin);

  // Round-trip FFT -> IFFT debe devolver la senal original.
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin(i * 0.1) + 0.3 * Math.cos(i * 0.7);
  const orig = Float64Array.from(a);
  fft(a, b, false);
  fft(a, b, true);
  let maxErr = 0;
  for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(a[i] - orig[i]));
  ok('round-trip FFT/IFFT', maxErr < 1e-9, 'err=' + maxErr.toExponential(2));
  ok('nextPow2', nextPow2(1000) === 1024 && nextPow2(1024) === 1024);
}

// ------------------------------------------------------- Ponderacion A
console.log('\n[2] Ponderacion A (IEC 61672, tolerancia clase 1 aprox +-1 dB)');
{
  const f = new AWeightingFilter(FS);
  // Valores tabulados de la curva A.
  const table = [
    [31.5, -39.4], [63, -26.2], [125, -16.1], [250, -8.6], [500, -3.2],
    [1000, 0.0], [2000, 1.2], [4000, 1.0], [8000, -1.1],
  ];
  for (const pair of table) {
    const freq = pair[0];
    const expected = pair[1];
    const got = f.responseDb(freq, FS);
    ok(String(freq).padStart(5) + ' Hz', near(got, expected, 1.0),
      'medido=' + got.toFixed(2) + ' dB  tabla=' + expected.toFixed(1) + ' dB');
  }

  // El filtro debe dejar pasar 1 kHz sin alterar el nivel.
  const f2 = new AWeightingFilter(FS);
  const block = new Float32Array(FS);
  for (let i = 0; i < block.length; i++) block[i] = Math.sin((2 * Math.PI * 1000 * i) / FS);
  const stats = f2.processBlockStats(block);
  const expectedRms = 1 / Math.SQRT2;
  ok('RMS de 1 kHz sin atenuar', near(stats.rms, expectedRms, 0.02),
    'rms=' + stats.rms.toFixed(4) + ' esperado=' + expectedRms.toFixed(4));
}

// ------------------------------------------------------------ GCC-PHAT
console.log('\n[3] GCC-PHAT: recuperacion de un retardo conocido');
{
  const frameSize = 1024;
  const est = new GccPhatEstimator({ frameSize, sampleRate: FS, micDistanceM: 0.15 });

  // Genera un par de canales donde right va retrasado `delay` muestras.
  function makePair(delay) {
    const len = frameSize + 128;
    const src = new Float32Array(len);
    // Ruido de banda ancha: es lo que mejor exhibe el comportamiento de GCC-PHAT.
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    for (let i = 0; i < len; i++) src[i] = rnd();
    const left = new Float32Array(frameSize);
    const right = new Float32Array(frameSize);
    const base = 64;
    for (let i = 0; i < frameSize; i++) {
      left[i] = src[base + i];
      right[i] = src[base + i - delay];
    }
    return { left, right };
  }

  for (const d of [-16, -8, -3, 0, 3, 8, 16]) {
    const p = makePair(d);
    const r = est.estimateLag(p.left, p.right);
    ok('retardo ' + String(d).padStart(3) + ' muestras',
      near(r.lag, d, 0.5) && r.confidence > 0.2,
      'lag=' + r.lag.toFixed(3) + ' conf=' + r.confidence.toFixed(2));
  }

  // Convencion de signo: fuente a la IZQUIERDA -> llega antes al canal izquierdo
  // -> el canal derecho va RETRASADO -> lag positivo -> azimut NEGATIVO.
  const pl = makePair(12);
  const rl = est.estimate(pl.left, pl.right);
  ok('fuente a la izquierda da azimut negativo', rl.azimuth < -5,
    'azimut=' + rl.azimuth.toFixed(1) + ' grados');

  const pr = makePair(-12);
  const rr = est.estimate(pr.left, pr.right);
  ok('fuente a la derecha da azimut positivo', rr.azimuth > 5,
    'azimut=' + rr.azimuth.toFixed(1) + ' grados');

  const pc = makePair(0);
  const rc = est.estimate(pc.left, pc.right);
  ok('canales identicos dan ~0 grados', near(rc.azimuth, 0, 3),
    'azimut=' + rc.azimuth.toFixed(2));

  // Ruido descorrelacionado -> confianza baja, se debe descartar.
  const nL = new Float32Array(frameSize);
  const nR = new Float32Array(frameSize);
  let s1 = 777;
  let s2 = 999;
  const rnd1 = () => { s1 = (s1 * 1103515245 + 12345) & 0x7fffffff; return (s1 / 0x7fffffff) * 2 - 1; };
  const rnd2 = () => { s2 = (s2 * 1103515245 + 54321) & 0x7fffffff; return (s2 / 0x7fffffff) * 2 - 1; };
  for (let i = 0; i < frameSize; i++) { nL[i] = rnd1(); nR[i] = rnd2(); }
  const rn = est.estimateLag(nL, nR);
  ok('ruido descorrelacionado da confianza baja', rn.confidence < 0.35,
    'conf=' + rn.confidence.toFixed(3));

  ok('maxLag coherente con 15 cm', est.maxLag >= 21 && est.maxLag <= 25, 'maxLag=' + est.maxLag);
}

// -------------------------------------------------------------- Nivel
console.log('\n[4] Nivel y riesgo');
{
  ok('RMS 1.0 da 0 dBFS', near(rmsToDbfs(1), 0, 1e-9));
  ok('RMS 0.5 da aprox -6 dBFS', near(rmsToDbfs(0.5), -6.02, 0.02));
  ok('silencio no produce -Infinity', Number.isFinite(rmsToDbfs(0)));
  ok('dBFS -40 con offset 100 da 60 dB SPL', near(dbfsToSpl(-40, 100), 60, 1e-9));
  ok('SPL recortado a rango fisico', dbfsToSpl(60, 100) === 140 && dbfsToSpl(-300, 100) === 0);
  ok('intensity 30 dB da 0', intensityFromDb(30) === 0);
  ok('intensity 90 dB da 1', intensityFromDb(90) === 1);
  ok('intensity 60 dB da 0.5', near(intensityFromDb(60), 0.5, 1e-9));
  ok('riesgo por nivel',
    riskFromDb(50) === 'NORMAL' && riskFromDb(75) === 'ADVISORY' && riskFromDb(95) === 'CRITICAL');
}

// --------------------------------------------------------- Suelo/onset
console.log('\n[5] Suelo de ruido y deteccion de onsets');
{
  const nf = new NoiseFloorTracker({ windowSeconds: 5, updatesPerSecond: 47 });
  // Ambiente a 40 dB con un unico portazo a 95 dB.
  for (let i = 0; i < 200; i++) nf.push(40 + Math.sin(i) * 0.5);
  const floorBefore = nf.floorDb;
  nf.push(95);
  ok('un transitorio no desplaza el suelo', near(nf.floorDb, floorBefore, 0.5),
    'antes=' + floorBefore.toFixed(2) + ' despues=' + nf.floorDb.toFixed(2));
  ok('el pico si queda registrado', nf.peakDb === 95);

  const baseline = nf.toCalibrationBaseline('office');
  ok('payload de calibracion bien formado',
    typeof baseline.ambient_average_db === 'number' &&
    typeof baseline.peak_transient_db === 'number' &&
    baseline.environment_type === 'office',
    JSON.stringify(baseline));

  const od = new OnsetDetector({ triggerDb: 12, releaseDb: 6, refractoryMs: 300 });
  let t = 0;
  let fired = 0;
  // Una palmada: sube de golpe y decae en ~150 ms, muestreado cada 21 ms.
  for (const db of [40, 40, 70, 68, 62, 55, 48, 42, 40, 40]) {
    if (od.update(db, 40, t)) fired++;
    t += 21;
  }
  ok('una palmada produce exactamente un evento', fired === 1, 'eventos=' + fired);

  // Nivel oscilando justo sobre el umbral: la histeresis debe evitar la rafaga.
  const od2 = new OnsetDetector({ triggerDb: 12, releaseDb: 6, refractoryMs: 300 });
  let fired2 = 0;
  t = 0;
  for (let i = 0; i < 40; i++) {
    if (od2.update(52 + (i % 2), 40, t)) fired2++;
    t += 21;
  }
  ok('oscilacion sobre el umbral no dispara en rafaga', fired2 <= 1, 'eventos=' + fired2);

  // Dos palmadas separadas 1 s -> dos eventos.
  const od3 = new OnsetDetector();
  let fired3 = 0;
  t = 0;
  for (const db of [40, 70, 45, 40, 40]) { if (od3.update(db, 40, t)) fired3++; t += 21; }
  t += 1000;
  for (const db of [40, 70, 45, 40]) { if (od3.update(db, 40, t)) fired3++; t += 21; }
  ok('dos palmadas separadas dan dos eventos', fired3 === 2, 'eventos=' + fired3);
}

// -------------------------------------------------------- Fallback mono
console.log('\n[6] Fallback mono (sin informacion direccional real)');
{
  const mk = (freq) => {
    const b = new Float32Array(1024);
    for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * freq * i) / FS);
    return b;
  };
  const low = heuristicAzimuthFromSpectrum(mk(200), FS);
  const high = heuristicAzimuthFromSpectrum(mk(5000), FS);
  ok('produce un angulo dentro de rango', Math.abs(low) <= 90 && Math.abs(high) <= 90,
    'bajo=' + low.toFixed(1) + ' alto=' + high.toFixed(1));
  ok('es estable (determinista)', heuristicAzimuthFromSpectrum(mk(200), FS) === low);
  ok('grave a la izquierda, agudo a la derecha', low < 0 && high > 0,
    'bajo=' + low.toFixed(1) + ' alto=' + high.toFixed(1));
}

console.log('\n' + (failures === 0 ? 'TODO OK' : 'HAY FALLOS') +
  ': ' + (checks - failures) + '/' + checks + ' comprobaciones\n');
process.exit(failures === 0 ? 0 : 1);
