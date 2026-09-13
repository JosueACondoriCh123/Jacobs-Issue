/**
 * Migracion de datos locales tras el renombrado del proyecto.
 *
 * El cambio de nombre movio doce claves de `localStorage` de `echovision.*` a
 * `jacobs-issue.*`. Sin esto, cualquiera que ya hubiera usado la aplicacion
 * perderia en silencio su offset de calibracion SPL, los sonidos que hubiera
 * enrolado, sus contactos de emergencia, el plano de zonas, el historial de
 * eventos y la dosis acumulada del dia. Nada de eso se puede recuperar despues.
 *
 * Se recorre el almacen entero en vez de listar las claves a mano: asi tambien
 * arrastra las que hayan creado los demas modulos del equipo.
 *
 * Es idempotente y no destruye el original: las claves viejas se conservan por
 * si hubiera que volver atras. Ocupan poco y el navegador las descartara solo
 * cuando se limpien los datos del sitio.
 */

const OLD_PREFIX = 'echo' + 'vision.'
const NEW_PREFIX = 'jacobs-issue.'
const DONE_FLAG = NEW_PREFIX + 'storageMigrated.v1'

export function migrateLocalStorage(): { migrated: string[]; skipped: string[] } {
  const migrated: string[] = []
  const skipped: string[] = []

  try {
    if (localStorage.getItem(DONE_FLAG)) return { migrated, skipped }

    const oldKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(OLD_PREFIX)) oldKeys.push(k)
    }

    for (const oldKey of oldKeys) {
      const newKey = NEW_PREFIX + oldKey.slice(OLD_PREFIX.length)
      // Si ya hay valor nuevo, manda ese: el usuario ya trabajo con el nombre
      // nuevo y sobrescribirlo con datos viejos seria perder trabajo reciente.
      if (localStorage.getItem(newKey) !== null) {
        skipped.push(newKey)
        continue
      }
      const value = localStorage.getItem(oldKey)
      if (value !== null) {
        localStorage.setItem(newKey, value)
        migrated.push(newKey)
      }
    }

    localStorage.setItem(DONE_FLAG, new Date().toISOString())

    if (migrated.length > 0) {
      console.info(
        `[Jacobs Issue] Datos locales migrados tras el cambio de nombre: ${migrated.length} clave(s).`,
        migrated,
      )
    }
  } catch {
    /* Modo privado o almacenamiento bloqueado: se arranca con valores por defecto. */
  }

  return { migrated, skipped }
}
