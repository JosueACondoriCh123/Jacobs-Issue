import { useEffect, useMemo, useState } from 'react'
import { useEchoStore } from '../shell/store'
import type { RiskLevel } from '../types/hud'

/**
 * Pantalla 5 — Árbol de escalamiento y protocolo de emergencia.
 *
 * Qué hace de verdad y qué no, dicho sin ambigüedad porque aquí la diferencia
 * importa: las reglas se evalúan en vivo contra la telemetría real y el temporizador
 * de reconocimiento corre de verdad. El despacho final (correo, webhook) lo ejecuta
 * la Edge Function del backend; mientras no esté enlazada, cada disparo queda en el
 * historial marcado como SIMULADO. Una pantalla de emergencias que aparente haber
 * enviado un aviso que nunca salió sería peligrosa.
 */

const RULES_KEY = 'echovision.safetyRules.v1'
const CONTACTS_KEY = 'echovision.safetyContacts.v1'
const DISPATCH_KEY = 'echovision.safetyDispatch.v1'

interface Rule {
  id: string
  enabled: boolean
  /** Se dispara con este riesgo o superior. */
  minRisk: RiskLevel
  /** Nivel mínimo en dB(A). */
  minDb: number
  /** Segundos que se espera a que el usuario reconozca antes de escalar. */
  graceSeconds: number
  actions: { email: boolean; webhook: boolean; strobe: boolean }
}

interface Contact {
  id: string
  name: string
  email: string
  relation: string
  verified: boolean
}

interface Dispatch {
  id: string
  at: number
  ruleId: string
  risk: RiskLevel
  decibels: number
  label: string
  acknowledged: boolean
  simulated: boolean
  actions: string[]
}

const RISK_ORDER: Record<RiskLevel, number> = { NORMAL: 0, ADVISORY: 1, CRITICAL: 2 }

const DEFAULT_RULES: Rule[] = [
  {
    id: 'r1',
    enabled: true,
    minRisk: 'CRITICAL',
    minDb: 85,
    graceSeconds: 15,
    actions: { email: true, webhook: true, strobe: true },
  },
]

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function SafetyTree() {
  const { telemetry, events } = useEchoStore()
  const [rules, setRules] = useState<Rule[]>(() => load(RULES_KEY, DEFAULT_RULES))
  const [contacts, setContacts] = useState<Contact[]>(() => load<Contact[]>(CONTACTS_KEY, []))
  const [dispatches, setDispatches] = useState<Dispatch[]>(() => load<Dispatch[]>(DISPATCH_KEY, []))

  /** Cuenta atrás en curso: el usuario aún puede reconocer y evitar el escalado. */
  const [pending, setPending] = useState<{ rule: Rule; event: (typeof events)[0]; until: number } | null>(
    null,
  )
  const [tick, setTick] = useState(Date.now())

  useEffect(() => {
    try {
      localStorage.setItem(RULES_KEY, JSON.stringify(rules))
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts))
      localStorage.setItem(DISPATCH_KEY, JSON.stringify(dispatches.slice(0, 50)))
    } catch {
      /* sin almacenamiento */
    }
  }, [rules, contacts, dispatches])

  // Evalúa el evento más reciente contra las reglas activas.
  const latest = events[0]
  useEffect(() => {
    if (!latest || pending) return
    const match = rules.find(
      (r) =>
        r.enabled &&
        RISK_ORDER[latest.risk] >= RISK_ORDER[r.minRisk] &&
        latest.decibels >= r.minDb,
    )
    if (!match) return
    // Evita re-disparar por un evento ya despachado tras recargar la página.
    if (dispatches.some((d) => Math.abs(d.at - latest.at) < 1000)) return
    setPending({ rule: match, event: latest, until: Date.now() + match.graceSeconds * 1000 })
  }, [latest, rules, pending, dispatches])

  useEffect(() => {
    if (!pending) return
    const t = window.setInterval(() => setTick(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [pending])

  // Vencida la cuenta atrás sin reconocimiento, se escala.
  useEffect(() => {
    if (!pending || tick < pending.until) return
    const actions: string[] = []
    if (pending.rule.actions.email) {
      actions.push(
        contacts.length
          ? `Correo a ${contacts.length} contacto(s)`
          : 'Correo (sin contactos configurados)',
      )
    }
    if (pending.rule.actions.webhook) actions.push('Webhook domótica')
    if (pending.rule.actions.strobe) actions.push('Estroboscopio perimetral')

    setDispatches((prev) => [
      {
        id: `d_${Date.now().toString(36)}`,
        at: Date.now(),
        ruleId: pending.rule.id,
        risk: pending.event.risk,
        decibels: pending.event.decibels,
        label: pending.event.label,
        acknowledged: false,
        simulated: true,
        actions,
      },
      ...prev,
    ])
    setPending(null)
  }, [tick, pending, contacts])

  const acknowledge = () => {
    if (!pending) return
    setDispatches((prev) => [
      {
        id: `d_${Date.now().toString(36)}`,
        at: Date.now(),
        ruleId: pending.rule.id,
        risk: pending.event.risk,
        decibels: pending.event.decibels,
        label: pending.event.label,
        acknowledged: true,
        simulated: true,
        actions: ['Reconocido por el usuario: escalado cancelado'],
      },
      ...prev,
    ])
    setPending(null)
  }

  const remaining = pending ? Math.max(0, Math.ceil((pending.until - tick) / 1000)) : 0

  return (
    <div className="evx-safety">
      {pending ? (
        <div className="evx-escalation-alert" role="alert">
          <div>
            <strong>ESCALADO EN {remaining} s</strong>
            <span>
              {pending.event.label} · {pending.event.decibels.toFixed(1)} dB(A) ·{' '}
              {pending.event.risk}
            </span>
          </div>
          <button type="button" className="evx-primary-btn" onClick={acknowledge}>
            RECONOZCO LA ALERTA
          </button>
        </div>
      ) : null}

      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>REGLAS DE ESCALAMIENTO</h2>
          <button
            type="button"
            className="evx-ghost-btn"
            onClick={() =>
              setRules((prev) => [
                ...prev,
                {
                  id: `r${Date.now().toString(36)}`,
                  enabled: true,
                  minRisk: 'ADVISORY',
                  minDb: 75,
                  graceSeconds: 20,
                  actions: { email: true, webhook: false, strobe: true },
                },
              ])
            }
          >
            + Regla
          </button>
        </header>

        <ul className="evx-rule-list">
          {rules.map((r) => (
            <li key={r.id} className={r.enabled ? '' : 'is-off'}>
              <div className="evx-rule-head">
                <label className="evx-toggle">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)),
                      )
                    }
                  />
                  <i aria-hidden="true" />
                </label>
                <span className="evx-rule-sentence">
                  Si se detecta{' '}
                  <select
                    value={r.minRisk}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((x) =>
                          x.id === r.id ? { ...x, minRisk: e.target.value as RiskLevel } : x,
                        ),
                      )
                    }
                  >
                    <option value="ADVISORY">un aviso</option>
                    <option value="CRITICAL">una alerta crítica</option>
                  </select>{' '}
                  de al menos{' '}
                  <input
                    type="number"
                    value={r.minDb}
                    min={40}
                    max={120}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((x) =>
                          x.id === r.id ? { ...x, minDb: Number(e.target.value) } : x,
                        ),
                      )
                    }
                  />{' '}
                  dB y no se reconoce en{' '}
                  <input
                    type="number"
                    value={r.graceSeconds}
                    min={5}
                    max={120}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((x) =>
                          x.id === r.id ? { ...x, graceSeconds: Number(e.target.value) } : x,
                        ),
                      )
                    }
                  />{' '}
                  s, entonces:
                </span>
                <button
                  type="button"
                  className="evx-ghost-btn"
                  onClick={() => setRules((prev) => prev.filter((x) => x.id !== r.id))}
                  aria-label="Eliminar regla"
                >
                  ×
                </button>
              </div>
              <div className="evx-rule-actions">
                {(['email', 'webhook', 'strobe'] as const).map((a) => (
                  <label key={a} className="evx-check">
                    <input
                      type="checkbox"
                      checked={r.actions[a]}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev.map((x) =>
                            x.id === r.id
                              ? { ...x, actions: { ...x.actions, [a]: e.target.checked } }
                              : x,
                          ),
                        )
                      }
                    />
                    <span>
                      {a === 'email'
                        ? 'Correo con geolocalización'
                        : a === 'webhook'
                          ? 'Webhook domótica (Hue)'
                          : 'Estroboscopio perimetral'}
                    </span>
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>CONTACTOS DE CONFIANZA</h2>
          <span className="evx-count">{contacts.length}</span>
        </header>
        <ContactForm onAdd={(c) => setContacts((prev) => [...prev, c])} />
        {contacts.length === 0 ? (
          <p className="evx-muted">
            Sin contactos. Una regla de correo sin destinatarios se dispara igual, pero no avisa a
            nadie.
          </p>
        ) : (
          <ul className="evx-contact-list">
            {contacts.map((c) => (
              <li key={c.id}>
                <span className="evx-contact-name">
                  <strong>{c.name}</strong>
                  <small>{c.relation}</small>
                </span>
                <span className="evx-contact-mail">{c.email}</span>
                <span className={`evx-pill ${c.verified ? 'risk-normal' : 'risk-advisory'}`}>
                  {c.verified ? 'VERIFICADO' : 'SIN VERIFICAR'}
                </span>
                <button
                  type="button"
                  className="evx-ghost-btn"
                  onClick={() => setContacts((prev) => prev.filter((x) => x.id !== c.id))}
                  aria-label={`Eliminar ${c.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="evx-panel">
        <header className="evx-panel-head">
          <h2>HISTORIAL AUDITABLE</h2>
          <span className="evx-count">{dispatches.length}</span>
        </header>
        {dispatches.length === 0 ? (
          <p className="evx-muted">
            Sin despachos registrados. {telemetry ? 'Las reglas están vigilando.' : 'Inicia la captura para activar la vigilancia.'}
          </p>
        ) : (
          <ul className="evx-dispatch-list">
            {dispatches.map((d) => (
              <li key={d.id}>
                <span className="evx-ev-time">{new Date(d.at).toLocaleString()}</span>
                <span className={`evx-pill risk-${d.risk.toLowerCase()}`}>{d.risk}</span>
                <span className="evx-ev-label">
                  {d.label} · {d.decibels.toFixed(1)} dB
                </span>
                <span className="evx-dispatch-actions">{d.actions.join(' · ')}</span>
                {d.acknowledged ? (
                  <span className="evx-pill risk-normal">RECONOCIDO</span>
                ) : (
                  <span className="evx-pill evx-sim">SIMULADO</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="evx-muted evx-note">
          Los despachos se marcan como <strong>SIMULADO</strong> porque el envío real lo ejecuta la
          Edge Function <code>notify-emergency</code> del backend. Hasta que esté enlazada, aquí se
          registra la decisión pero no sale ningún correo. No conviene enseñar esta pantalla en la
          demo diciendo que ya avisa a nadie.
        </p>
      </section>
    </div>
  )
}

function ContactForm({ onAdd }: { onAdd: (c: Contact) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [relation, setRelation] = useState('Familiar')

  const valid = useMemo(() => name.trim().length > 1 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), [
    name,
    email,
  ])

  return (
    <div className="evx-form evx-contact-form">
      <label>
        <span>Nombre</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Condori" />
      </label>
      <label>
        <span>Correo</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ana@ejemplo.com"
          type="email"
        />
      </label>
      <label>
        <span>Relación</span>
        <select value={relation} onChange={(e) => setRelation(e.target.value)}>
          <option>Familiar</option>
          <option>Vecino</option>
          <option>Cuidador</option>
          <option>Emergencias</option>
        </select>
      </label>
      <button
        type="button"
        className="evx-primary-btn"
        disabled={!valid}
        onClick={() => {
          onAdd({
            id: `c_${Date.now().toString(36)}`,
            name: name.trim(),
            email: email.trim(),
            relation,
            verified: false,
          })
          setName('')
          setEmail('')
        }}
      >
        AÑADIR
      </button>
    </div>
  )
}
