import { useCallback, useEffect, useRef, useState } from 'react'
import { useEchoStore } from '../shell/store'
import { spectralSignature, signatureDistance } from '../shell/viz'
import type { RiskLevel } from '../types/hud'

/**
 * Pantalla 4 — Laboratorio de enrolamiento de sonidos.
 *
 * Asistente de tres tomas. Las tres no son un capricho: una sola grabación no
 * permite saber si la firma espectral es estable o fue casualidad. Al comparar
 * las tomas entre sí se obtiene una medida de consistencia que se le enseña al
 * usuario antes de dejarle guardar.
 */

const STORE_KEY = 'echovision.customSounds.v1'
const TAKES = 3

interface CustomSound {
  id: string
  label: string
  category: string
  risk: RiskLevel
  /** Media de las tres tomas. */
  signature: number[]
  /** 0..1; por debajo de ~0.6 las tomas no se parecen entre sí. */
  consistency: number
  peakDb: number
  createdAt: number
}

interface Take {
  signature: Float32Array
  peakDb: number
}

function loadSounds(): CustomSound[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as CustomSound[]) : []
  } catch {
    return []
  }
}

export function SoundStudio() {
  const { engine, isRunning, telemetry } = useEchoStore()
  const [sounds, setSounds] = useState<CustomSound[]>(loadSounds)
  const [takes, setTakes] = useState<Take[]>([])
  const [armed, setArmed] = useState(false)
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('Hogar')
  const [risk, setRisk] = useState<RiskLevel>('ADVISORY')
  const [message, setMessage] = useState<string | null>(null)

  const armedRef = useRef(armed)
  armedRef.current = armed

  // Al armar la grabación se escucha la siguiente instantánea de onset. Así el
  // usuario no tiene que acertar con el momento: basta con hacer sonar la cosa.
  useEffect(() => {
    const off = engine.onSnapshot((snap) => {
      if (!armedRef.current) return
      setArmed(false)
      const sig = spectralSignature(snap.pcm, snap.sampleRate)
      setTakes((prev) => [...prev, { signature: sig, peakDb: snap.peakDb }].slice(0, TAKES))
      setMessage(null)
    })
    return off
  }, [engine])

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(sounds))
    } catch {
      /* cuota llena: el enrolamiento sigue disponible en memoria */
    }
  }, [sounds])

  const consistency = useCallback((list: Take[]): number => {
    if (list.length < 2) return 0
    let sum = 0
    let pairs = 0
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        sum += signatureDistance(list[i].signature, list[j].signature)
        pairs++
      }
    }
    return pairs ? Math.max(0, 1 - sum / pairs) : 0
  }, [])

  const save = () => {
    if (takes.length < TAKES || !label.trim()) return
    const bands = takes[0].signature.length
    const avg = new Array<number>(bands).fill(0)
    for (const t of takes) for (let i = 0; i < bands; i++) avg[i] += t.signature[i] / takes.length

    const sound: CustomSound = {
      id: `cs_${Date.now().toString(36)}`,
      label: label.trim(),
      category,
      risk,
      signature: avg.map((v) => Math.round(v * 1000) / 1000),
      consistency: Math.round(consistency(takes) * 100) / 100,
      peakDb: Math.round((takes.reduce((s, t) => s + t.peakDb, 0) / takes.length) * 10) / 10,
      createdAt: Date.now(),
    }
    setSounds((prev) => [sound, ...prev])
    setTakes([])
    setLabel('')
    setMessage(`«${sound.label}» enrolado con ${Math.round(sound.consistency * 100)}% de consistencia.`)
  }

  const cons = consistency(takes)
  const canSave = takes.length === TAKES && label.trim().length > 0

  return (
    <div className="evx-studio">
      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>ASISTENTE DE ENROLAMIENTO</h2>
          <span className="evx-muted">
            {takes.length}/{TAKES} tomas
          </span>
        </header>

        {!isRunning ? (
          <p className="evx-warn-box">
            La captura está detenida. Arráncala en la barra superior: el estudio graba a partir de
            los eventos que detecta el motor de audio.
          </p>
        ) : null}

        <ol className="evx-takes">
          {Array.from({ length: TAKES }, (_, i) => {
            const take = takes[i]
            const isNext = i === takes.length
            return (
              <li key={i} className={take ? 'is-done' : isNext && armed ? 'is-armed' : ''}>
                <span className="evx-take-no">{i + 1}</span>
                {take ? (
                  <>
                    <SignatureBars values={Array.from(take.signature)} />
                    <span className="evx-take-db">{take.peakDb.toFixed(1)} dB</span>
                  </>
                ) : (
                  <span className="evx-muted">
                    {isNext && armed
                      ? 'Escuchando… haz sonar el timbre ahora'
                      : 'Pendiente de grabar'}
                  </span>
                )}
              </li>
            )
          })}
        </ol>

        <div className="evx-studio-actions">
          <button
            type="button"
            className={`evx-primary-btn ${armed ? 'is-armed' : ''}`}
            onClick={() => setArmed((a) => !a)}
            disabled={!isRunning || takes.length >= TAKES}
          >
            {armed ? 'ESCUCHANDO… (cancelar)' : 'GRABAR TOMA'}
          </button>
          {takes.length > 0 ? (
            <button type="button" className="evx-ghost-btn" onClick={() => setTakes([])}>
              Reiniciar tomas
            </button>
          ) : null}
        </div>

        {takes.length >= 2 ? (
          <div className={`evx-consistency ${cons < 0.6 ? 'is-low' : ''}`}>
            <span>Consistencia entre tomas</span>
            <span className="evx-bar">
              <i style={{ width: `${Math.round(cons * 100)}%` }} />
            </span>
            <strong>{Math.round(cons * 100)}%</strong>
            {cons < 0.6 ? (
              <p className="evx-muted">
                Las tomas no se parecen lo suficiente. Suele significar que se coló ruido de fondo o
                que se grabó un sonido distinto. Repetirlas dará un reconocimiento más fiable.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="evx-form">
          <label>
            <span>Etiqueta</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Timbre de mi casa"
              maxLength={40}
            />
          </label>
          <label>
            <span>Categoría</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>Hogar</option>
              <option>Seguridad</option>
              <option>Personas</option>
              <option>Vehículos</option>
              <option>Electrodomésticos</option>
            </select>
          </label>
          <label>
            <span>Prioridad</span>
            <select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)}>
              <option value="NORMAL">Normal</option>
              <option value="ADVISORY">Aviso</option>
              <option value="CRITICAL">Crítico</option>
            </select>
          </label>
          <button type="button" className="evx-primary-btn" onClick={save} disabled={!canSave}>
            GUARDAR SONIDO
          </button>
        </div>

        {message ? <p className="evx-ok-box">{message}</p> : null}
      </section>

      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>SONIDOS ENROLADOS</h2>
          <span className="evx-count">{sounds.length}</span>
        </header>

        {sounds.length === 0 ? (
          <p className="evx-muted">
            Aún no hay sonidos propios. Los modelos generales no conocen tu timbre ni tu lavadora;
            enrolarlos es lo que hace que el sistema reconozca tu casa y no una casa genérica.
          </p>
        ) : (
          <ul className="evx-sound-list">
            {sounds.map((s) => (
              <li key={s.id}>
                <div className="evx-sound-head">
                  <strong>{s.label}</strong>
                  <span className={`evx-pill risk-${s.risk.toLowerCase()}`}>{s.risk}</span>
                  <span className="evx-muted">{s.category}</span>
                  <button
                    type="button"
                    className="evx-ghost-btn"
                    onClick={() => setSounds((prev) => prev.filter((x) => x.id !== s.id))}
                    aria-label={`Eliminar ${s.label}`}
                  >
                    ×
                  </button>
                </div>
                <SignatureBars values={s.signature} />
                <div className="evx-sound-meta">
                  <span>Pico medio {s.peakDb.toFixed(1)} dB</span>
                  <span>Consistencia {Math.round(s.consistency * 100)}%</span>
                  <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {telemetry && sounds.length > 0 ? (
          <p className="evx-muted evx-note">
            Los sonidos se guardan en este navegador. Para que el reconocimiento funcione en todos
            tus dispositivos hace falta subirlos a <code>custom_sound_signatures</code>, la tabla
            que ya existe en el backend.
          </p>
        ) : null}
      </section>
    </div>
  )
}

/** Huella espectral: 24 bandas en escala mel, de graves a agudos. */
function SignatureBars({ values }: { values: number[] }) {
  return (
    <span className="evx-signature" aria-label="Firma espectral">
      {values.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(4, Math.round(v * 100))}%` }} />
      ))}
    </span>
  )
}
