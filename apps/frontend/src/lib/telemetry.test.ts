import { describe, expect, it, vi } from 'vitest'
import {
  mapAcousticEvent,
  mapRealtimeBroadcast,
  normalizeAzimuth,
  normalizeTelemetry,
} from './telemetry'
import { getAmbientState } from './miniHudState'
import { generateMockTelemetry } from '../services/mockTelemetryEmitter'

describe('telemetry contract adapters', () => {
  it('normalizes angles into a 360 degree HUD', () => {
    expect(normalizeAzimuth(-10)).toBe(350)
    expect(normalizeAzimuth(725)).toBe(5)
  })

  it('sanitizes broadcast telemetry', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'event-id' })
    const event = normalizeTelemetry({
      azimuth: 480,
      intensity: 132,
      label: 'Sirena',
      risk: 'critical',
      confidence: 1.4,
    })

    expect(event).toMatchObject({
      id: 'event-id',
      azimuth: 120,
      intensity: 120,
      label: 'Sirena',
      risk: 'CRITICAL',
      confidence: 1,
      source: 'broadcast',
    })
    vi.unstubAllGlobals()
  })

  it('maps the agreed Supabase row shape', () => {
    const event = mapAcousticEvent({
      id: 'row-1',
      timestamp: '2026-09-12T12:00:00.000Z',
      sound_label: 'Bocina',
      confidence: 0.91,
      decibels: 83.5,
      risk_level: 'ADVISORY',
      azimuth_angle: 271,
    })

    expect(event).toMatchObject({
      id: 'row-1',
      timestamp: '2026-09-12T12:00:00.000Z',
      label: 'Bocina',
      confidence: 0.91,
      intensity: 83.5,
      risk: 'ADVISORY',
      azimuth: 271,
      source: 'postgres',
    })
    expect(event.receivedAt).toEqual(expect.any(String))
    expect(event.latencyMs).toEqual(expect.any(Number))
  })

  it('accepts a database-shaped envelope over the fast broadcast path', () => {
    const event = mapRealtimeBroadcast({
      commit_timestamp: new Date().toISOString(),
      new: {
        id: 'shared-event-id',
        sound_label: 'Alarma de incendio',
        decibels: 96,
        azimuth_angle: 44,
        confidence: 0.97,
        risk_level: 'CRITICAL',
      },
    })

    expect(event).toMatchObject({
      id: 'shared-event-id',
      label: 'Alarma de incendio',
      intensity: 96,
      azimuth: 44,
      confidence: 0.97,
      risk: 'CRITICAL',
      source: 'broadcast',
    })
    expect(event.latencyMs).not.toBeNull()
  })

  it('produces a contract-safe mock event', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'mock-id' })
    const event = generateMockTelemetry(() => 0)
    expect(event).toMatchObject({
      id: 'mock-id',
      label: 'Conversación cercana',
      azimuth: 0,
      intensity: 52,
      risk: 'NORMAL',
      source: 'mock',
    })
    vi.unstubAllGlobals()
  })
})

describe('mini HUD ambient states', () => {
  it.each([
    [36, 'NORMAL', 'QUIET', false],
    [58, 'NORMAL', 'NORMAL', false],
    [74, 'NORMAL', 'ADVISORY', true],
    [92, 'NORMAL', 'CRITICAL', true],
  ] as const)('maps %i dB to %s', (intensity, risk, state, hasAlert) => {
    expect(getAmbientState({ intensity, risk })).toMatchObject({ id: state, hasAlert })
  })

  it('lets an explicit risk classification override the dB threshold', () => {
    expect(getAmbientState({ intensity: 54, risk: 'CRITICAL' }).id).toBe('CRITICAL')
  })
})
