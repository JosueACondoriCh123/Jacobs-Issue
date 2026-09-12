import ReactDOM from 'react-dom/client'
// Unico cambio de Dev 2 fuera de su territorio: el shell del OS sustituye al
// montaje directo del HUD. `App.tsx` sigue intacto y se renderiza dentro del
// shell como la pantalla /hud.
import AppShell from './shell/AppShell'
import './styles.css'

/*
 * StrictMode desactivado a proposito, y conviene saber por que antes de volver
 * a activarlo.
 *
 * En desarrollo, StrictMode monta cada efecto dos veces para destapar efectos no
 * idempotentes. `useHudTelemetry` (Dev 1) no lo es: en el segundo montaje vuelve
 * a llamar a `.on(...)` sobre el canal 'hud-telemetry', que `supabase-js` cachea
 * por topic y ya esta suscrito, y lanza «cannot add postgres_changes callbacks
 * after subscribe()». Eso tumbaba la pantalla del HUD.
 *
 * El fallo estaba latente: mientras no hubo credenciales de Supabase, el hook
 * tomaba la rama simulada y nunca tocaba un canal. Al configurar `.env.local`
 * pasa por la rama real y aparece.
 *
 * Esto es un parche de demo, no la solucion. Lo correcto es que el hook limpie
 * su canal de forma idempotente; mientras tanto el ErrorBoundary de cada
 * pantalla cubre el resto de casos. En produccion StrictMode no duplica efectos,
 * asi que `pnpm build` no estaba afectado.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(<AppShell />)
