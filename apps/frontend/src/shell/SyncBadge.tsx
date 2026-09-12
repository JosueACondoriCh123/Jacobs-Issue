import type { SyncState } from './backend'

/**
 * Indicador honesto de dónde vive un dato.
 *
 * Se muestra siempre, también cuando todo va bien: si solo apareciera en caso de
 * fallo, el usuario no tendría forma de saber que "guardado" significaba "en
 * este navegador y en ningún sitio más".
 */
export function SyncBadge({ state, reason }: { state: SyncState; reason?: string }) {
  const label =
    state === 'synced' ? 'SINCRONIZADO' : state === 'error' ? 'ERROR DE SINCRONÍA' : 'SOLO LOCAL'

  return (
    <span className={`evx-sync evx-sync-${state}`} title={reason ?? label}>
      <i aria-hidden="true" />
      {label}
    </span>
  )
}
