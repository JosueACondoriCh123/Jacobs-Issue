import { useEffect, useState } from 'react'
import { navigate, type Route } from './router'

export interface NavItem {
  route: Route
  glyph: string
  title: string
  subtitle: string
}

/** El orden y los glifos vienen de la especificación de navegación del equipo. */
export const NAV_ITEMS: NavItem[] = [
  { route: '/hud', glyph: '⊙', title: 'TACTICAL HUD', subtitle: 'Vista operativa 360°' },
  { route: '/forensics', glyph: '☷', title: 'INCIDENT LOGS', subtitle: 'Caja negra y espectro' },
  { route: '/mesh', glyph: '☩', title: 'SENSOR MESH', subtitle: 'Nodos y zonas' },
  { route: '/studio', glyph: '🎛', title: 'SOUND STUDIO', subtitle: 'Entrenador de sonidos' },
  { route: '/safety', glyph: '⚠', title: 'SAFETY TREE', subtitle: 'Contactos y escalado' },
  { route: '/dosimetry', glyph: '📊', title: 'DOSIMETRY', subtitle: 'Salud auditiva OMS' },
]

const COLLAPSE_KEY = 'echovision.sidebarCollapsed'

export interface SidebarProps {
  active: Route
  /** Riesgo vigente: tiñe el indicador del HUD sin tener que entrar a mirarlo. */
  risk: 'NORMAL' | 'ADVISORY' | 'CRITICAL'
  connection: string
  /** Eventos sin revisar, mostrados como contador sobre INCIDENT LOGS. */
  unreviewed: number
}

export function Sidebar({ active, risk, connection, unreviewed }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* modo privado: la preferencia simplemente no persiste */
    }
  }, [collapsed])

  // Atajo de teclado: en una demo en vivo, moverse con el ratón por seis pantallas
  // es lento y se nota. Alt+1..6 salta directo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const idx = Number(e.key) - 1
      if (idx >= 0 && idx < NAV_ITEMS.length) {
        e.preventDefault()
        navigate(NAV_ITEMS[idx].route)
      }
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setCollapsed((c) => !c)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <nav
      className={`evx-sidebar ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Navegación principal de EchoVision OS"
    >
      <div className="evx-sidebar-head">
        <span className="evx-logo" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="evx-wordmark">
          <strong>ECHOVISION</strong>
          <small>OS</small>
        </span>
        <button
          type="button"
          className="evx-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
          title={collapsed ? 'Expandir (Alt+B)' : 'Colapsar (Alt+B)'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <ul className="evx-nav">
        {NAV_ITEMS.map((item, i) => {
          const isActive = item.route === active
          const badge = item.route === '/forensics' && unreviewed > 0 ? unreviewed : 0
          return (
            <li key={item.route}>
              <button
                type="button"
                className={`evx-nav-item ${isActive ? 'is-active' : ''}`}
                onClick={() => navigate(item.route)}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? `${item.title} (Alt+${i + 1})` : undefined}
              >
                <span className="evx-glyph" aria-hidden="true">
                  {item.glyph}
                </span>
                <span className="evx-nav-text">
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                {item.route === '/hud' ? (
                  <span className={`evx-risk-dot risk-${risk.toLowerCase()}`} aria-hidden="true" />
                ) : null}
                {badge ? (
                  <span className="evx-badge" aria-label={`${badge} eventos sin revisar`}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
                <span className="evx-key" aria-hidden="true">
                  {i + 1}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="evx-sidebar-foot">
        <div className="evx-link-state">
          <span className={`evx-link-dot state-${connection.toLowerCase()}`} aria-hidden="true" />
          <span className="evx-nav-text">
            <strong>{connection}</strong>
            <small>CH / HUD-TELEMETRY</small>
          </span>
        </div>
        <p className="evx-hint">Alt+1…6 para saltar · Alt+B para colapsar</p>
      </div>
    </nav>
  )
}
