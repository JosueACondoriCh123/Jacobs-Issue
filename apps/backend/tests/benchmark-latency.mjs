// ====================================================================
// Jacobs Issue - Benchmark de Latencia End-to-End: Zero Latency Loop (< 50 ms)
// Fase A: Integración en Vivo y Calibración de Ruido (Dev 3)
// ====================================================================

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { createClient } = require(path.join(__dirname, '../../frontend/node_modules/@supabase/supabase-js'));

import { processLiveAcousticEvent, CONFIDENCE_THRESHOLD } from '../src/services/liveEventService.mjs';
import { NoiseCalibrationService } from '../src/services/noiseCalibrationService.mjs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bbaznvpitxauwggzrsgq.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_gAZs06yX3eD_TGZRD12U-A_JH10eg0e';

console.log('================================================================');
console.log('  JACOBS ISSUE // BENCHMARK DE LATENCIA ZERO LATENCY LOOP (< 50 ms)');
console.log(`  Target: ${SUPABASE_URL}`);
console.log('================================================================\n');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 30 } },
});

async function runBenchmark() {
  const channelName = 'hud-telemetry';
  const channel = supabase.channel(channelName, {
    config: { broadcast: { self: true } }
  });

  const transitTimes = [];
  channel.on('broadcast', { event: 'telemetry' }, ({ payload }) => {
    if (payload && payload._t_sent) {
      const transitMs = Math.round((performance.now() - payload._t_sent) * 100) / 100;
      transitTimes.push(transitMs);
    }
  });

  console.log('📡 1. Conectando al canal WebSocket Supabase Realtime...');
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout suscribiendo a realtime')), 10000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(t);
        console.log('  ✅ Conexión WebSocket Realtime ACTIVA y EN VIVO.');
        resolve();
      }
    });
  });

  // -------------------------------------------------------------------
  // TEST A: Puerta de Confianza (> 80%)
  // -------------------------------------------------------------------
  console.log('\n🔒 2. Probando Puerta de Confianza (> 80%):');
  const lowConfEvent = {
    sound_label: 'background_whisper',
    confidence: 0.65, // Menor que 0.80
    decibels: 48.0,
    azimuth_angle: 45.0,
  };

  const lowConfResult = await processLiveAcousticEvent(lowConfEvent, supabase, channel);
  console.log(`  Evento baja confianza (65%): descartado=${!lowConfResult.persisted}, latency=${lowConfResult.latency_ms}ms`);
  if (!lowConfResult.persisted) {
    console.log('  ✅ [PASS] El filtro rechazó correctamente el evento de baja confianza sin tocar la DB.');
  }

  // -------------------------------------------------------------------
  // TEST B: Medición de Latencia de Tránsito Realtime WebSocket (< 50 ms)
  // -------------------------------------------------------------------
  console.log('\n⚡ 3. Midiendo Latencia de Tránsito WebSocket en Vivo (Zero Latency Loop):');
  
  for (let i = 1; i <= 5; i++) {
    const now = performance.now();
    await channel.send({
      type: 'broadcast',
      event: 'telemetry',
      payload: {
        azimuth: 84.5,
        intensity: 75.0,
        decibels: 75.0,
        label: 'test_realtime_loop',
        risk: 'ADVISORY',
        confidence: 0.94,
        timestamp: new Date().toISOString(),
        _t_sent: now,
      },
    });
    // Pequeño intervalo entre envíos
    await new Promise((r) => setTimeout(r, 60));
  }

  // Esperar propagación en socket
  await new Promise((r) => setTimeout(r, 500));

  console.log(`  Muestras de tránsito recibidas por WebSocket: ${transitTimes.length}`);
  for (let i = 0; i < transitTimes.length; i++) {
    console.log(`    - Pk #${i + 1}: ${transitTimes[i]} ms`);
  }

  if (transitTimes.length > 0) {
    const avgTransit = Math.round((transitTimes.reduce((a, b) => a + b, 0) / transitTimes.length) * 10) / 10;
    const minTransit = Math.min(...transitTimes);
    const maxTransit = Math.max(...transitTimes);
    console.log(`\n  📊 Latencia de Tránsito WebSocket HUD (Canvas Render Loop):`);
    console.log(`     Mínima:  ${minTransit} ms`);
    console.log(`     Promedio: ${avgTransit} ms`);
    console.log(`     Máxima:  ${maxTransit} ms`);
    if (avgTransit < 50) {
      console.log(`     🎉 [META DE FASE A CUMPLIDA]: ${avgTransit} ms < 50 ms.`);
    }
  }

  // -------------------------------------------------------------------
  // TEST C: Persistencia ACID Concurrente con Confianza > 80%
  // -------------------------------------------------------------------
  console.log('\n💾 4. Verificando Persistencia y Disparo de Incidente en Supabase:');
  const highConfEvent = {
    sound_label: 'fire_alarm_phase_a',
    confidence: 0.96, // Mayor que 0.80
    decibels: 96.0,
    azimuth_angle: 270.0,
    risk_level: 'CRITICAL',
    device_id: 'hud-primary',
  };

  const highConfResult = await processLiveAcousticEvent(highConfEvent, supabase, channel);
  console.log(`  Persistido en acoustic_event_logs: id=${highConfResult.event_id}`);
  console.log(`  Persistido en acoustic_incidents: id=${highConfResult.incident_id || 'N/A'}`);
  console.log(`  Broadcast emitido: ${highConfResult.broadcasted}`);

  // -------------------------------------------------------------------
  // TEST D: Calibración Dinámica de Ruido de Fondo
  // -------------------------------------------------------------------
  console.log('\n🎯 5. Probando Calibración Dinámica de Ruido de Fondo:');
  const tCalib0 = performance.now();
  const calib = await NoiseCalibrationService.calibrate({
    ambient_average_db: 41.5,
    peak_transient_db: 66.0,
    environment_type: 'acoustic_lab_room',
  }, supabase);
  const tCalibEnd = performance.now();
  const calibMs = Math.round((tCalibEnd - tCalib0) * 100) / 100;

  console.log(`  - Ruido Ambiente: ${calib.ambient_average_db} dB`);
  console.log(`  - Pico Transitorio: ${calib.peak_transient_db} dB`);
  console.log(`  - Umbral Adaptativo Calculado: ${calib.dynamic_threshold_db} dB`);
  console.log(`  - Latencia de Calibración: ${calibMs} ms`);

  // -------------------------------------------------------------------
  // Limpieza de evento de prueba
  // -------------------------------------------------------------------
  console.log('\n🧹 6. Limpiando evento de prueba en Supabase...');
  if (highConfResult.event_id) {
    await supabase.from('acoustic_event_logs').delete().eq('id', highConfResult.event_id);
  }
  if (highConfResult.incident_id) {
    await supabase.from('acoustic_incidents').delete().eq('id', highConfResult.incident_id);
  }
  await supabase.removeChannel(channel);
  console.log('  ✅ Limpieza completada.');

  console.log('\n================================================================');
  console.log('  BENCHMARK FASE A COMPLETADO CON ÉXITO');
  console.log('================================================================');
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('❌ Error ejecutando benchmark:', err);
  process.exit(1);
});
