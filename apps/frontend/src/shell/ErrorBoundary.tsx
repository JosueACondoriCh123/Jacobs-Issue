import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Aísla el fallo de una pantalla al área de esa pantalla.
 *
 * Sin esto, una excepción en cualquier vista desmonta todo el árbol de React y
 * deja la aplicación en blanco: el peor momento posible para que ocurra es
 * delante del jurado. Con el límite, la barra lateral sobrevive y se puede
 * seguir navegando a las demás pantallas.
 */
interface Props {
  children: ReactNode
  screen: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[EchoVision] fallo en la pantalla ${this.props.screen}`, error, info)
  }

  componentDidUpdate(prev: Props) {
    // Al cambiar de pantalla se reintenta: un fallo puntual no debe dejar la
    // vista inutilizable para el resto de la sesión.
    if (prev.screen !== this.props.screen && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="evx-panel evx-crash">
        <h2>ESTA PANTALLA HA FALLADO</h2>
        <p className="evx-muted">
          El resto del sistema sigue operativo: la captura de audio no se ha interrumpido y puedes
          navegar a las demás vistas desde la barra lateral.
        </p>
        <pre className="evx-crash-msg">{this.state.error.message}</pre>
        <button
          type="button"
          className="evx-primary-btn"
          onClick={() => this.setState({ error: null })}
        >
          REINTENTAR
        </button>
      </div>
    )
  }
}
