import { useCallback, useEffect, useRef, useState } from 'react'
import { useEchoStore } from '../shell/store'
import { spectralSignature, signatureDistance } from '../shell/viz'
import { SyncBadge } from '../shell/SyncBadge'
import {
  deleteCustomSound,
  listCustomSounds,
  saveCustomSound,
  currentUserId,
  type SyncState,
} from '../shell/backend'
import type { RiskLevel } from '../types/hud'

/**
 * Pantalla 4 — Laboratorio de enrolamiento de sonidos.
 *
 * Asistente de tres tomas. Las tres no son un capricho: una sola grabación no
 * permite saber si la firma espectral es estable o fue casualidad. Al comparar
 * las tomas entre sí se obtiene una medida de consistencia que se le enseña al
 * usuario antes de dejarle guardar.
 *
 * Persistencia: los sonidos van a `custom_sound_signatures` en Supabase, pero el
 * RLS de esa tabla exige `auth.uid() = user_id`, así que sin sesión iniciada no
 * hay escritura posible. En ese caso se guarda en este navegador y el indicador
 * lo dice: prometer un guardado en la nube que no ocurrió haría que el usuario
 * perdiera su trabajo al cambiar de dispositivo sin saber por qué.
 */

const STORE_KEY = 'jacobs-issue.customSounds.v1'
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
  /** true si la fila vive en Supabase y no solo en este navegador. */
  remote: boolean
}

interface Take {
  signature: Float32Array
  peakDb: number
}

/** Centroide espectral de la firma, en Hz. Es una columna de la tabla remota. */
function centroidFromSignature(sig: number[]): number {
  let num = 0
  let den = 0
  for (let i = 0; i < sig.length; i++) {
    // Las bandas son mel-lineales entre 60 Hz y 8 kHz (16 kHz de muestreo).
    const hz = 60 + ((8000 - 60) * (i + 0.5)) / sig.length
    num += hz * sig[i]
    den += sig[i]
  }
  return den > 0 ? Math.round(num / den) : 0
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
  const [sync, setSync] = useState<{ state: SyncState; reason?: string }>({ state: 'local' })
  const [authed, setAuthed] = useState(false)
  const [saving, setSaving] = useState(false)

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

  /**
   * Carga desde el backend. Los remotos sustituyen a los locales del mismo
   * nombre para no mostrar el mismo timbre dos veces tras iniciar sesion.
   */
  const refresh = useCallback(async () => {
    const uid = await currentUserId()
    setAuthed(Boolean(uid))
    const res = await listCustomSounds()
    setSync({ state: res.state, reason: res.reason })
    if (res.state !== 'synced') return

    const remote: CustomSound[] = res.data.map((r) => ({
      id: r.id,
      label: r.custom_label,
      category: 'Remoto',
      risk: r.risk_level,
      signature: Array.isArray(r.spectral_signature) ? r.spectral_signature : [],
      consistency: 1,
      peakDb: 0,
      createdAt: new Date(r.registered_at).getTime(),
      remote: true,
    }))
    setSounds((prev) => {
      const labels = new Set(remote.map((r) => r.label))
      return [...remote, ...prev.filter((p) => !p.remote && !labels.has(p.label))]
    })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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

  const save = async () => {
    if (takes.length < TAKES || !label.trim() || saving) return
    setSaving(true)
    const bands = takes[0].signature.length
    const avg = new Array<number>(bands).fill(0)
    for (const t of takes) for (let i = 0; i < bands; i++) avg[i] += t.signature[i] / takes.length
    const signature = avg.map((v) => Math.round(v * 1000) / 1000)
    const name = label.trim()
    const cons100 = Math.round(consistency(takes) * 100)

    // Se intenta SIEMPRE el guardado remoto; el resultado decide lo que se dice.
    const result = await saveCustomSound({
      label: name,
      signature,
      risk,
      centroidHz: centroidFromSignature(signature),
    })

    const sound: CustomSound = {
      id: result.data?.id ?? `cs_${Date.now().toString(36)}`,
      label: name,
      category,
      risk,
      signature,
      consistency: cons100 / 100,
      peakDb: Math.round((takes.reduce((s, t) => s + t.peakDb, 0) / takes.length) * 10) / 10,
      createdAt: Date.now(),
      remote: result.state === 'synced',
    }

    setSounds((prev) => [sound, ...prev])
    setSync({ state: result.state, reason: result.reason })
    setTakes([])
    setLabel('')
    setSaving(false)

    if (result.state === 'synced') {
      setMessage(`«${name}» guardado en custom_sound_signatures (${cons100}% de consistencia).`)
    } else if (result.state === 'error') {
      setMessage(`«${name}» quedó solo en este navegador. El backend rechazó la escritura: ${result.reason}`)
    } else {
      setMessage(`«${name}» guardado SOLO en este navegador (${cons100}% de consistencia). ${result.reason ?? ''}`)
    }
  }

  const remove = async (sound: CustomSound) => {
    if (sound.remote) await deleteCustomSound(sound.id)
    setSounds((prev) => prev.filter((x) => x.id !== sound.id))
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
          <button
            type="button"
            className="evx-primary-btn"
            onClick={() => void save()}
            disabled={!canSave || saving}
          >
            {saving ? 'GUARDANDO…' : 'GUARDAR SONIDO'}
          </button>
        </div>

        {message ? <p className="evx-ok-box">{message}</p> : null}
      </section>

      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>SONIDOS ENROLADOS</h2>
          <div className="evx-panel-actions">
            <SyncBadge state={sync.state} reason={sync.reason} />
            <span className="evx-count">{sounds.length}</span>
            <button type="button" className="evx-ghost-btn" onClick={() => void refresh()}>
              Refrescar
            </button>
          </div>
        </header>

        {!authed ? (
          <p className="evx-login-box">
            <strong>Sin sesión iniciada.</strong> Los sonidos se guardan solo en este navegador. La
            tabla <code>custom_sound_signatures</code> exige <code>auth.uid() = user_id</code>, así
            que hasta que inicies sesión con Google desde el HUD no se sincronizan ni estarán
            disponibles en tus otros dispositivos.
          </p>
        ) : null}

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
                  <SyncBadge
                    state={s.remote ? 'synced' : 'local'}
                    reason={s.remote ? 'Fila en custom_sound_signatures' : 'Solo en este navegador'}
                  />
                  <button
                    type="button"
                    className="evx-ghost-btn"
                    onClick={() => void remove(s)}
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

        {sounds.length > 0 ? (
          <p className="evx-muted evx-note">
            Cada fila indica dónde vive realmente. Las marcadas como sincronizadas están en
            <code> custom_sound_signatures</code> y te siguen entre dispositivos; las locales
            desaparecen si limpias los datos del navegador.
            {telemetry ? '' : ' Inicia la captura para enrolar sonidos nuevos.'}
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
