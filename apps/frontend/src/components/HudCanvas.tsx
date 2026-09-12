import { useEffect, useRef } from 'react'
import type { HUDTelemetryEvent } from '../types/hud'

interface HudCanvasProps {
  telemetry: HUDTelemetryEvent
}

const riskColors = {
  NORMAL: '#00f0ff',
  ADVISORY: '#ffd166',
  CRITICAL: '#ff1e56',
} as const

const lerpAngle = (from: number, to: number, amount: number) => {
  const delta = ((to - from + 540) % 360) - 180
  return from + delta * amount
}

export function HudCanvas({ telemetry }: HudCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const telemetryRef = useRef(telemetry)
  const currentAngle = useRef(telemetry.azimuth)
  const currentIntensity = useRef(telemetry.intensity)

  useEffect(() => {
    telemetryRef.current = telemetry
  }, [telemetry])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let frame = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio, 2)
      width = rect.width
      height = rect.height
      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const draw = (time: number) => {
      const data = telemetryRef.current
      const color = riskColors[data.risk]
      currentAngle.current = lerpAngle(currentAngle.current, data.azimuth, reduceMotion ? 1 : 0.055)
      currentIntensity.current += (data.intensity - currentIntensity.current) * (reduceMotion ? 1 : 0.07)

      context.clearRect(0, 0, width, height)
      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.34

      const glow = context.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.45)
      glow.addColorStop(0, 'rgba(0, 240, 255, 0.035)')
      glow.addColorStop(0.58, 'rgba(0, 240, 255, 0.018)')
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
      context.fillStyle = glow
      context.fillRect(0, 0, width, height)

      context.save()
      context.translate(cx, cy)
      context.strokeStyle = 'rgba(82, 226, 236, 0.16)'
      context.lineWidth = 1
      context.setLineDash([2, 6])
      for (let ring = 1; ring <= 4; ring += 1) {
        context.beginPath()
        context.arc(0, 0, (radius * ring) / 4, 0, Math.PI * 2)
        context.stroke()
      }
      context.setLineDash([])

      for (let degree = 0; degree < 360; degree += 5) {
        const angle = (degree * Math.PI) / 180
        const major = degree % 30 === 0
        const inner = radius + (major ? 8 : 13)
        const outer = radius + 19
        context.strokeStyle = major ? 'rgba(141, 247, 255, 0.72)' : 'rgba(74, 188, 198, 0.28)'
        context.beginPath()
        context.moveTo(Math.sin(angle) * inner, -Math.cos(angle) * inner)
        context.lineTo(Math.sin(angle) * outer, -Math.cos(angle) * outer)
        context.stroke()
      }

      const sweep = reduceMotion ? 0 : (time * 0.00034) % (Math.PI * 2)
      const sweepGradient = context.createConicGradient(sweep, 0, 0)
      sweepGradient.addColorStop(0, 'rgba(0,240,255,0)')
      sweepGradient.addColorStop(0.06, 'rgba(0,240,255,0.18)')
      sweepGradient.addColorStop(0.12, 'rgba(0,240,255,0)')
      context.fillStyle = sweepGradient
      context.beginPath()
      context.arc(0, 0, radius, 0, Math.PI * 2)
      context.fill()

      const angle = (currentAngle.current * Math.PI) / 180
      context.globalAlpha = data.directionValid === true ? 1 : 0
      const strength = Math.min(1, Math.max(0.2, currentIntensity.current / 105))
      const vectorLength = radius * (0.42 + strength * 0.48)
      const vx = Math.sin(angle) * vectorLength
      const vy = -Math.cos(angle) * vectorLength

      context.shadowColor = color
      context.shadowBlur = data.risk === 'CRITICAL' ? 22 : 13
      context.strokeStyle = color
      context.lineWidth = data.risk === 'CRITICAL' ? 3 : 2
      context.beginPath()
      context.moveTo(0, 0)
      context.lineTo(vx, vy)
      context.stroke()

      const pulse = reduceMotion ? 1 : 1 + Math.sin(time * 0.008) * 0.12
      context.fillStyle = color
      context.beginPath()
      context.arc(vx, vy, (7 + strength * 8) * pulse, 0, Math.PI * 2)
      context.fill()
      context.shadowBlur = 0

      context.strokeStyle = color
      context.globalAlpha = 0.34
      context.lineWidth = 1
      context.beginPath()
      context.arc(vx, vy, 27 * pulse, 0, Math.PI * 2)
      context.stroke()
      context.globalAlpha = 1

      context.fillStyle = 'rgba(205, 251, 255, 0.9)'
      context.globalAlpha = 1
      context.font = '600 11px "IBM Plex Mono", monospace'
      context.textAlign = 'center'
      context.fillText('N', 0, -radius - 30)
      context.fillText('E', radius + 31, 4)
      context.fillText('S', 0, radius + 38)
      context.fillText('W', -radius - 31, 4)

      context.strokeStyle = 'rgba(0, 240, 255, 0.66)'
      context.lineWidth = 1.5
      const bracket = 22
      const gap = 8
      context.beginPath()
      context.moveTo(-bracket, -gap)
      context.lineTo(-gap, -gap)
      context.lineTo(-gap, -bracket)
      context.moveTo(bracket, gap)
      context.lineTo(gap, gap)
      context.lineTo(gap, bracket)
      context.stroke()
      context.restore()

      if (data.risk === 'CRITICAL') {
        const alpha = reduceMotion ? 0.12 : 0.08 + (Math.sin(time * 0.006) + 1) * 0.045
        context.strokeStyle = `rgba(255, 30, 86, ${alpha + 0.25})`
        context.lineWidth = 2
        context.strokeRect(7, 7, width - 14, height - 14)
        context.fillStyle = `rgba(255, 30, 86, ${alpha})`
        context.fillRect(0, 0, width, height)
      }

      frame = window.requestAnimationFrame(draw)
    }

    frame = window.requestAnimationFrame(draw)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="hud-canvas" aria-hidden="true" />
}
