/**
 * Motivo de píxeles en escalera de las esquinas, tomado de hacktoberfest.com.
 *
 * Puramente decorativo: va oculto a los lectores de pantalla. El patrón es una
 * diagonal descendente de bloques coral y crema que se va deshilachando, lo que
 * da la sensación de señal que se desvanece — apropiado para este producto.
 */

/** 1 = cian, 2 = verde, 3 = rojo, 0 = vacío. Cinco columnas, siete filas. */
const PATTERN: number[][] = [
  [1, 1, 1, 0, 0],
  [1, 1, 1, 2, 0],
  [1, 1, 0, 2, 2],
  [3, 0, 0, 2, 2],
  [1, 0, 0, 0, 2],
  [0, 0, 0, 0, 2],
  [0, 0, 0, 0, 0],
]

const FILL: Record<number, string> = {
  1: '#00f0ff',
  2: '#00ff88',
  3: '#ff1e56',
}

/**
 * Los bloques se van apagando hacia el interior: el que está en la esquina
 * brilla y el último es casi invisible. Refuerza la idea de señal que se
 * desvanece con la distancia, que es literalmente de lo que va el producto.
 */
function fade(row: number, col: number): number {
  const d = row + col
  return Math.max(0.12, 1 - d * 0.13)
}

export function PixelCorner({ side }: { side: 'left' | 'right' }) {
  return (
    <span className={`hf-pixels hf-pixels-${side}`} aria-hidden="true">
      {PATTERN.flatMap((row, r) =>
        row.map((cell, c) => (
          <i
            key={`${r}-${c}`}
            style={
              cell
                ? {
                    background: FILL[cell],
                    opacity: fade(r, c),
                    boxShadow: `0 0 12px ${FILL[cell]}`,
                  }
                : undefined
            }
          />
        )),
      )}
    </span>
  )
}
