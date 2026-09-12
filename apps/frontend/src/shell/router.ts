import { useEffect, useState } from 'react'

/**
 * Router por hash, sin dependencias.
 *
 * Por qué no `react-router`: instalarlo tocaría `package.json` y `pnpm-lock.yaml`,
 * que son archivos compartidos y ahora mismo hay tres agentes escribiendo en este
 * árbol a la vez. Un conflicto en el lockfile a mitad de hackathon cuesta más que
 * las cincuenta líneas que ocupa esto. Para seis rutas estáticas sobra, y además
 * el hash funciona al abrir el `dist/` como archivo, sin configurar el servidor.
 */

export const ROUTES = [
  '/hud',
  '/forensics',
  '/mesh',
  '/studio',
  '/safety',
  '/dosimetry',
] as const

export type Route = (typeof ROUTES)[number]

export const DEFAULT_ROUTE: Route = '/hud'

/**
 * La especificación nombra la pantalla de dosimetría como `/dosimetry` en un sitio
 * y como `/analytics` en la barra lateral. Se acepta la segunda como alias para que
 * ningún enlace del equipo quede roto.
 */
const ALIASES: Record<string, Route> = {
  '/analytics': '/dosimetry',
  '/dosimetria': '/dosimetry',
  '/': DEFAULT_ROUTE,
  '': DEFAULT_ROUTE,
}

export function normalizeRoute(raw: string): Route {
  const clean = raw.replace(/^#/, '').split('?')[0]
  if (ROUTES.includes(clean as Route)) return clean as Route
  return ALIASES[clean] ?? DEFAULT_ROUTE
}

export function currentRoute(): Route {
  return normalizeRoute(window.location.hash)
}

export function navigate(route: Route): void {
  if (window.location.hash !== '#' + route) {
    window.location.hash = route
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute)

  useEffect(() => {
    const onChange = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onChange)
    // Si se entra sin hash, se fija el por defecto para que la URL sea compartible.
    if (!window.location.hash) navigate(DEFAULT_ROUTE)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}
