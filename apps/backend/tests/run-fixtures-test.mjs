// ====================================================================
// EchoVision - Test Runner para Fixtures de Dev 3 (Backend Architect)
// Ejecución: node apps/backend/tests/run-fixtures-test.mjs
// ====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');
const migrationsDir = path.join(__dirname, '../supabase/migrations');

console.log('====================================================');
console.log('  ECHOVISION BACKEND // TEST RUNNER DE FIXTURES DEV 3');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

// -------------------------------------------------------------------
// 1. Verificación de Carga y Esquema de Fixtures JSON
// -------------------------------------------------------------------
console.log('🔹 1. Validando Fixtures JSON Acústicos:');

const criticalFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'acoustic_event_critical.json'), 'utf-8'));
assert(criticalFixture.risk_level === 'CRITICAL', 'Fixture Crítico tiene risk_level == CRITICAL');
assert(criticalFixture.decibels >= 85, `Fixture Crítico tiene decibels >= 85 dB (${criticalFixture.decibels} dB)`);
assert(criticalFixture.azimuth_angle >= 0 && criticalFixture.azimuth_angle <= 360, 'Fixture Crítico tiene azimut válido (0-360°)');

const advisoryFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'acoustic_event_advisory.json'), 'utf-8'));
assert(advisoryFixture.risk_level === 'ADVISORY', 'Fixture Advisory tiene risk_level == ADVISORY');
assert(advisoryFixture.decibels >= 70 && advisoryFixture.decibels < 85, `Fixture Advisory en rango adecuado (${advisoryFixture.decibels} dB)`);

const normalFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'acoustic_event_normal.json'), 'utf-8'));
assert(normalFixture.risk_level === 'NORMAL', 'Fixture Normal tiene risk_level == NORMAL');
assert(normalFixture.decibels < 70, `Fixture Normal tiene decibels < 70 dB (${normalFixture.decibels} dB)`);

const contacts = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'emergency_contacts.json'), 'utf-8'));
assert(Array.isArray(contacts) && contacts.length >= 2, `Directorio de contactos tiene ${contacts.length} registros`);
assert(contacts.every(c => c.email && c.name && c.is_active), 'Todos los contactos de emergencia tienen email, nombre y estado activo');

const baseline = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'baseline_calibration.json'), 'utf-8'));
const calculatedThreshold = Math.round((baseline.ambient_average_db + 0.6 * (baseline.peak_transient_db - baseline.ambient_average_db)) * 10) / 10;
assert(calculatedThreshold === baseline.expected_dynamic_threshold_db, `Cálculo de umbral dinámico de calibración correcto (${calculatedThreshold} dB)`);

const deviceFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'device_provisioning.json'), 'utf-8'));
assert(deviceFixture.device_name && deviceFixture.device_room, 'Fixture de provisión de dispositivo contiene nombre y sala');
function simulateDeviceProvision(body) {
  let deviceId = body.device_id || body.deviceId || body.id;
  if (!deviceId) {
    deviceId = `hud-${Math.random().toString(36).substring(2, 10)}`;
  }
  return {
    device_id: deviceId,
    device: {
      id: deviceId,
      device_name: body.device_name || body.deviceName || (deviceId === 'hud-primary' ? 'EchoVision HUD Primary Unit' : `EchoVision Device (${deviceId})`),
      device_room: body.device_room || body.deviceRoom || (deviceId === 'hud-primary' ? 'Master HUD / Central' : 'Sala Principal'),
      battery_level: body.battery_level ?? 100,
      status: body.status || 'online',
      last_heartbeat: new Date().toISOString()
    }
  };
}
const provisioned = simulateDeviceProvision(deviceFixture);
assert(provisioned.device_id.startsWith('hud-'), `DeviceId emitido dinámicamente con prefijo válido: ${provisioned.device_id}`);

const hudPrimaryFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'device_hud_primary.json'), 'utf-8'));
const provisionedHudPrimary = simulateDeviceProvision(hudPrimaryFixture);
assert(provisionedHudPrimary.device_id === 'hud-primary', 'DeviceId explícito hud-primary preservado y registrado correctamente');
assert(provisionedHudPrimary.device.id === 'hud-primary', 'Objeto device contiene id == hud-primary');

// Validación de persistencia de Onset y metadatos de sesión (Dev 4 worker integration)
function validateOnsetPersistence(event, sessionContext = {}) {
  const metadata = {
    device_id: event.deviceId || sessionContext.device_id || 'hud-primary',
    session_id: sessionContext.session_id || null,
    is_onset: event.isOnset ?? true,
    ...(event.metadata || {})
  };
  return {
    user_id: sessionContext.user_id || null,
    sound_label: event.sound_label || event.label,
    decibels: event.decibels,
    risk_level: event.risk_level || event.risk,
    confidence: event.confidence,
    azimuth_angle: event.azimuth_angle ?? event.azimuth,
    metadata
  };
}
const mockSession = { user_id: '11111111-2222-3333-4444-555555555555', session_id: 'sess-abc-123', device_id: provisioned.device_id };
const persistedOnset = validateOnsetPersistence(criticalFixture, mockSession);
assert(persistedOnset.metadata.session_id === 'sess-abc-123', 'Evento acústico persistido conserva el session_id');
assert(persistedOnset.metadata.device_id === provisioned.device_id, 'Evento acústico persistido conserva el device_id real');
assert(persistedOnset.metadata.is_onset === true, 'Evento acústico clasificado como onset persistente');

const mesh = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'mesh_relay_event.json'), 'utf-8'));
assert(mesh.source_device_id && mesh.device_room, 'Fixture de Mesh Relay contiene device_id y room');


// -------------------------------------------------------------------
// 2. Simulación de Despacho de Emergencia (Edge Function notify-emergency)
// -------------------------------------------------------------------
console.log('\n🔹 2. Simulando Lógica de Despacho de Alertas Críticas:');

function simulateNotifyEmergency(event, activeContacts) {
  if (event.risk_level !== 'CRITICAL') {
    return { dispatched: false, reason: 'Non-critical event' };
  }

  const dispatches = activeContacts.map(contact => ({
    event_id: event.id,
    user_id: event.user_id,
    dispatch_type: 'EMAIL_GMAIL',
    recipient: contact.email,
    status: 'SENT',
    subject: `🚨 ALERTA CRÍTICA ECHOVISION: ${event.sound_label.toUpperCase()}`,
    payload: {
      sound_label: event.sound_label,
      decibels: event.decibels,
      azimuth_angle: event.azimuth_angle,
      contact_name: contact.name,
    },
    sent_at: new Date().toISOString()
  }));

  return { dispatched: true, count: dispatches.length, dispatches };
}

const dispatchResult = simulateNotifyEmergency(criticalFixture, contacts);
assert(dispatchResult.dispatched === true, 'Evento crítico disparó el flujo de despacho');
assert(dispatchResult.count === 2, `Se generaron 2 auditorías de notificación para los contactos`);
assert(dispatchResult.dispatches[0].subject.includes('FIRE_ALARM_SIREN'), 'Asunto del correo contiene el sound_label en mayúsculas');

const nonCriticalResult = simulateNotifyEmergency(normalFixture, contacts);
assert(nonCriticalResult.dispatched === false, 'Evento normal NO dispara despacho de emergencia');

// -------------------------------------------------------------------
// 3. Verificación de Migraciones SQL
// -------------------------------------------------------------------
console.log('\n🔹 3. Verificando Migraciones SQL de Supabase:');

const expectedMigrations = [
  '20260912000001_core_schema.sql',
  '20260912000002_auxiliary_tables.sql',
  '20260912000003_rls_and_realtime.sql',
  '20260912000004_triggers_functions.sql'
];

for (const mig of expectedMigrations) {
  const migPath = path.join(migrationsDir, mig);
  const exists = fs.existsSync(migPath);
  assert(exists, `Migración presente: ${mig}`);
  if (exists) {
    const sqlContent = fs.readFileSync(migPath, 'utf-8');
    assert(sqlContent.length > 200, `Migración ${mig} tiene contenido SQL sustancial (${sqlContent.length} bytes)`);
  }
}

// -------------------------------------------------------------------
// 4. Verificación de Compatibilidad con Dev 1 (Frontend HUD)
// -------------------------------------------------------------------
console.log('\n🔹 4. Verificando Compatibilidad con useHudTelemetry (Dev 1):');

const requiredColumnsByDev1 = ['id', 'timestamp', 'sound_label', 'confidence', 'decibels', 'risk_level', 'azimuth_angle'];
const coreSql = fs.readFileSync(path.join(migrationsDir, '20260912000001_core_schema.sql'), 'utf-8');

for (const col of requiredColumnsByDev1) {
  assert(coreSql.includes(col), `Tabla acoustic_event_logs incluye columna requerida por Dev 1: '${col}'`);
}

// -------------------------------------------------------------------
// Resumen
// -------------------------------------------------------------------
console.log('\n====================================================');
console.log(`  RESUMEN DE PRUEBAS: ${passedTests}/${totalTests} PASARON SATISFACTORIAMENTE`);
console.log('====================================================\n');

if (passedTests === totalTests) {
  console.log('🎉 Todos los contratos, fixtures y migraciones de Dev 3 son 100% VÁLIDOS.');
  process.exit(0);
} else {
  console.error('⚠️ Se detectaron fallos en las pruebas.');
  process.exit(1);
}
