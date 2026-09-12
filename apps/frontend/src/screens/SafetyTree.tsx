import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEchoStore } from '../shell/store'
import { SyncBadge } from '../shell/SyncBadge'
import {
  currentUserId,
  deleteContact,
  dispatchEmergency,
  listContacts,
  listDispatchLogs,
  saveContact,
  type DispatchOutcome,
  type SyncState,
} from '../shell/backend'
import { createPortal } from 'react-dom'
import type { RiskLevel } from '../types/hud'

/**
 * Pantalla 5 — Árbol de escalamiento y protocolo de emergencia.
 *
 * El despacho llama DE VERDAD a la Edge Function `notify-emergency` y luego
 * informa de lo que ocurrió realmente, que no siempre es lo que parece:
 *
 *   SENT          la función usó Resend o un webhook: salió algo al mundo.
 *   LOGGED_ONLY   respondió éxito, pero sin RESEND_API_KEY ni EMERGENCY_WEBHOOK_URL
 *                 solo hizo un console.log y escribió la auditoría. NADIE recibió nada.
 *   NOT_DEPLOYED  la función no existe en el proyecto (404).
 *   NEEDS_LOGIN   la función necesita un user_id para buscar los contactos.
 *   NO_CONTACTS   respondió bien, pero no hay a quién avisar.
 *
 * La distinción SENT / LOGGED_ONLY es el motivo de que este archivo exista tal
 * cual: la propia Edge Function devuelve `success: true` en ambos casos. Mostrar
 * "enviado" cuando no salió ningún correo, en un producto de accesibilidad para
 * personas sordas, es el fallo más grave que podría cometer esta pantalla.
 */

const RULES_KEY = 'jacobs-issue.safetyRules.v1'
const CONTACTS_KEY = 'jacobs-issue.safetyContacts.v1'
const DISPATCH_KEY = 'jacobs-issue.safetyDispatch.v1'

interface Rule {
  id: string
  enabled: boolean
  /** Se dispara con este riesgo o superior. */
  minRisk: RiskLevel
  /** Nivel mínimo en dB estimados. */
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
  eventId?: string
  id: string
  at: number
  ruleId: string
  risk: RiskLevel
  decibels: number
  label: string
  acknowledged: boolean
  /** Qué ocurrió de verdad al intentar avisar. */
  outcome: DispatchOutcome
  detail: string
  recipients: string[]
  actions: string[]
}

const OUTCOME_LABEL: Record<DispatchOutcome, string> = {
  SENT: 'ACEPTADO POR RESEND',
  LOGGED_ONLY: 'REGISTRADO SIN ENVÍO',
  NOT_DEPLOYED: 'NO DESPACHADO',
  NEEDS_LOGIN: 'SIN SESIÓN',
  NO_CONTACTS: 'SIN CONTACTOS',
  FAILED: 'FALLO',
}

const RISK_ORDER: Record<RiskLevel, number> = { NORMAL: 0, ADVISORY: 1, CRITICAL: 2 }

const DEFAULT_RULES: Rule[] = [
  {
    id: 'r1',
    enabled: true,
    minRisk: 'CRITICAL',
    minDb: 0,
    graceSeconds: 15,
    actions: { email: true, webhook: false, strobe: false },
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
  const { telemetry, events, auth } = useEchoStore()
  const handled = useRef(new Set<string>())
  const [rules, setRules] = useState<Rule[]>(() => load(RULES_KEY, DEFAULT_RULES))
  const [contacts, setContacts] = useState<Contact[]>(() => load<Contact[]>(CONTACTS_KEY, []))
  const [dispatches, setDispatches] = useState<Dispatch[]>(() => load<Dispatch[]>(DISPATCH_KEY, []))

  /** Cuenta atrás en curso: el usuario aún puede reconocer y evitar el escalado. */
  const [pending, setPending] = useState<{ rule: Rule; event: (typeof events)[0]; until: number } | null>(
    null,
  )
  const [tick, setTick] = useState(Date.now())
  const [authed, setAuthed] = useState(false)
  const [contactSync, setContactSync] = useState<{ state: SyncState; reason?: string }>({
    state: 'local',
  })
  const [dispatching, setDispatching] = useState(false)

  const refresh = useCallback(async () => {
    const uid = await currentUserId()
    setAuthed(Boolean(uid))

    const cs = await listContacts()
    setContactSync({ state: cs.state, reason: cs.reason })
    if (cs.state === 'synced') {
      setContacts(
        cs.data.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          relation: c.relationship ?? c.relation ?? 'Contacto',
          verified: Boolean(c.verified),
        })),
      )
    }

    // El historial auditable REAL vive en notification_dispatch_logs y lo escribe
    // la Edge Function; el local solo cubre lo que ocurrio sin backend.
    const logs = await listDispatchLogs()
    if (logs.state === 'synced' && logs.data.length > 0) {
      setDispatches((prev) => {
        const remote: Dispatch[] = logs.data.map((l) => ({
          id: l.id,
          eventId: l.event_id,
          at: l.sent_at ? new Date(l.sent_at).getTime() : 0,
          ruleId: 'remoto',
          risk: 'CRITICAL',
          decibels: 0,
          label: 'Despacho registrado en backend',
          acknowledged: false,
          outcome:
            l.status === 'FAILED'
              ? 'FAILED'
              : l.status === 'SENT' && l.dispatch_type === 'RESEND'
                ? 'SENT'
                : 'LOGGED_ONLY',
          detail: l.error_message ?? `dispatch_type=${l.dispatch_type}`,
          recipients: [l.recipient],
          actions: [l.dispatch_type],
        }))
        const ids = new Set(remote.map((r) => r.id))
        return [...remote, ...prev.filter((d) => !ids.has(d.id))].slice(0, 60)
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, auth.user?.id])

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
  const latest = events.find(e => e.persistence === 'SAVED' && (e.confidence ?? 0) > 0.80 && e.risk === 'CRITICAL' && !e.reviewed)
  useEffect(() => {
    if (!latest || pending || dispatching || Date.now() - latest.at > 30000 || handled.current.has(latest.id)) return
    const match = rules.find(
      (r) =>
        r.enabled &&
        RISK_ORDER[latest.risk] >= RISK_ORDER[r.minRisk] &&
        latest.decibels >= r.minDb,
    )
    if (!match) return
    // Evita re-disparar por un evento ya despachado tras recargar la página.
    if (dispatches.some((d) => d.eventId === latest.id)) return
    handled.current.add(latest.id)
    setTick(Date.now())
    setPending({ rule: match, event: latest, until: Date.now() + match.graceSeconds * 1000 })
  }, [latest, rules, pending, dispatches, dispatching])

  useEffect(() => {
    if (!pending) return
    const t = window.setInterval(() => setTick(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [pending])

  // Vencida la cuenta atrás sin reconocimiento, se escala DE VERDAD.
  useEffect(() => {
    if (!pending || tick < pending.until || dispatching) return
    const p = pending
    setDispatching(true)
    setPending(null)

    void (async () => {
      const actions: string[] = []
      if (p.rule.actions.email) actions.push('Correo via notify-emergency')
      if (p.rule.actions.webhook) actions.push('Webhook no conectado: no ejecutado')
      if (p.rule.actions.strobe) actions.push('Estroboscopio no conectado: no ejecutado')

      // Llamada real a la Edge Function. El informe dice lo que pasó de verdad,
      // incluido el caso en que el backend responde éxito sin enviar nada.
      const report = p.rule.actions.email
        ? await dispatchEmergency({ event_id: p.event.id })
        : {
            outcome: 'LOGGED_ONLY' as DispatchOutcome,
            detail: 'La regla no incluye correo: solo acciones locales.',
            recipients: [],
            types: [],
          }

      setDispatches((prev) => [
        {
          id: `d_${Date.now().toString(36)}`,
          at: Date.now(),
          eventId: p.event.id,
          ruleId: p.rule.id,
          risk: p.event.risk,
          decibels: p.event.decibels,
          label: p.event.label,
          acknowledged: false,
          outcome: report.outcome,
          detail: report.detail,
          recipients: report.recipients,
          actions,
        },
        ...prev,
      ])
      setDispatching(false)
    })()
  }, [tick, pending, dispatching])

  const acknowledge = () => {
    if (!pending) return
    setDispatches((prev) => [
      {
        id: `d_${Date.now().toString(36)}`,
        at: Date.now(),
        eventId: pending.event.id,
        ruleId: pending.rule.id,
        risk: pending.event.risk,
        decibels: pending.event.decibels,
        label: pending.event.label,
        acknowledged: true,
        outcome: 'NO_CONTACTS',
        detail: 'El usuario reconoció la alerta antes de que venciera el plazo.',
        recipients: [],
        actions: ['Reconocido por el usuario: escalado cancelado'],
      },
      ...prev,
    ])
    setPending(null)
  }

  const remaining = pending ? Math.max(0, Math.ceil((pending.until - tick) / 1000)) : 0

  return (
    <div className="evx-safety">
      {pending ? createPortal(
        <div className="evx-escalation-alert" role="alert">
          <div>
            <strong>ESCALADO EN {remaining} s</strong>
            <span>
              {pending.event.label} · {pending.event.decibels.toFixed(1)} dB estimados ·{' '}
              {pending.event.risk}
            </span>
          </div>
          <button type="button" className="evx-primary-btn" onClick={acknowledge}>
            RECONOZCO LA ALERTA
          </button>
        </div>, document.body
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
          <div className="evx-panel-actions">
            <SyncBadge state={contactSync.state} reason={contactSync.reason} />
            <span className="evx-count">{contacts.length}</span>
          </div>
        </header>

        {!authed ? (
          <p className="evx-login-box">
            <strong>Sin sesión iniciada.</strong> Los contactos quedan en este navegador y{' '}
            <strong>la Edge Function no podrá leerlos</strong>: busca por <code>user_id</code> en
            <code> emergency_contacts</code>. Sin sesión, un escalado real no avisaría a nadie.
          </p>
        ) : null}

        <ContactForm
          onAdd={async (c) => {
            const res = await saveContact({ name: c.name, email: c.email, relation: c.relation })
            setContactSync({ state: res.state, reason: res.reason })
            setContacts((prev) => [...prev, { ...c, id: res.data?.id ?? c.id }])
          }}
        />
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
                  onClick={() => {
                    void (async () => {
                      if (authed && !(await deleteContact(c.id))) {setContactSync({state:'error',reason:'No se confirmó la eliminación del contacto.'});return}
                      setContacts(prev => prev.filter(x => x.id !== c.id))
                    })()
                  }}
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
                  {d.label}
                  {d.decibels ? ` · ${d.decibels.toFixed(1)} dB` : ''}
                </span>
                <span className="evx-dispatch-actions" title={d.detail}>
                  {d.recipients.length > 0 ? d.recipients.join(', ') : d.actions.join(' · ')}
                </span>
                {d.acknowledged ? (
                  <span className="evx-pill risk-normal">RECONOCIDO</span>
                ) : (
                  <span className={`evx-outcome evx-outcome-${d.outcome}`} title={d.detail}>
                    {OUTCOME_LABEL[d.outcome]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="evx-outcome-legend">
          <p className="evx-muted evx-note">
            Cada despacho dice lo que ocurrió <strong>de verdad</strong>, no lo que se intentó:
          </p>
          <ul className="evx-legend-list">
            <li>
              <span className="evx-outcome evx-outcome-SENT">ACEPTADO POR RESEND</span> el proveedor
              aceptó el correo. La entrega al buzón todavía no está confirmada.
            </li>
            <li>
              <span className="evx-outcome evx-outcome-LOGGED_ONLY">REGISTRADO SIN ENVÍO</span> el
              solo hay un registro local o legado: no confirma ningún envío.
            </li>
            <li>
              <span className="evx-outcome evx-outcome-NOT_DEPLOYED">NO DESPACHADO</span>{' '}
              <code>notify-emergency</code> no está desplegada en el proyecto.
            </li>
            <li>
              <span className="evx-outcome evx-outcome-NEEDS_LOGIN">SIN SESIÓN</span> falta el
              <code> user_id</code> con el que la función busca los contactos.
            </li>
          </ul>
          <p className="evx-muted evx-note">
            La aceptación de Resend no garantiza entrega. Valida el correo en un buzón autorizado.
          </p>
        </div>
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
