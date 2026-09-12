/**
 * API publica del modulo de audio (Dev 2).
 *
 * Para Dev 1 (HUD):
 *   const engine = new AudioCaptureEngine()
 *   const publisher = new TelemetryPublisher()
 *   await publisher.connect()
 *   await engine.start()
 *   engine.onTelemetry((t) => publisher.publish(t))
 *
 * Para Dev 4 (clasificador):
 *   engine.onFrame(({ pcm }) => classify(pcm))   // 15360 muestras a 16 kHz
 */
export { AudioCaptureEngine } from './captureEngine'
export type { CaptureOptions } from './captureEngine'
export { TelemetryPublisher, toPayload, toHudAzimuth, getDefaultTransport } from './telemetryPublisher'
export type { PublisherOptions, TransportKind } from './telemetryPublisher'
export { MockTransport, subscribeMockTelemetry } from './transport/mockTransport'
export { SupabaseTransport } from './transport/supabaseTransport'
export type { TelemetryTransport } from './transport/types'
export * from './types'
