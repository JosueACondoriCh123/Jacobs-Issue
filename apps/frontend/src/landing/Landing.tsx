import { navigate } from '../shell/router'
import { PixelCorner } from './PixelCorner'
import './landing.css'

/**
 * Landing pública de Jacobs Issue.
 *
 * La ESTRUCTURA viene de hacktoberfest.com: bandas apiladas, titulares enormes
 * en Barlow Semi Condensed con interlineado comprimido, botones de esquina viva,
 * rejilla de cifras con divisiones duras, acordeón de preguntas y motivos de
 * píxeles en las esquinas.
 *
 * El COLOR es el del propio proyecto (Cyber-OLED: #050608, #00F0FF, #00FF88,
 * #FF1E56), de modo que la página se lee como la portada del mismo sistema que
 * el HUD y no como una web ajena colocada delante.
 *
 * Sobre el contenido: todas las cifras que aparecen son verificables en el
 * propio código (60 FPS del HUD, 0,96 s de ventana del clasificador, ±90° de
 * rango angular). No hay métricas de adopción ni testimonios porque esto es un
 * prototipo de hackathon y presentarlo como producto asentado sería mentir a
 * quien llega por primera vez.
 */
export function Landing() {
  const enter = (route: Parameters<typeof navigate>[0]) => (e: React.MouseEvent) => {
    e.preventDefault()
    navigate(route)
  }

  return (
    <div className="hf">
      <div className="hf-topbar">
        Proyecto presentado a Frontier Cascadia · Track <strong>AI for Good</strong>
      </div>

      <nav className="hf-nav">
        <a className="hf-logo" href="#/" onClick={enter('/')}>
          <span className="hf-logo-bars" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          JACOBS ISSUE<sup>26</sup>
        </a>
        <div className="hf-nav-links">
          <a href="#problema">El problema</a>
          <a href="#como">Cómo funciona</a>
          <a href="#pantallas">Pantallas</a>
          <a href="#faq">Preguntas</a>
          <a className="hf-btn" href="#/login" onClick={enter('/login')}>
            Entrar
          </a>
        </div>
      </nav>

      {/* ------------------------------------------------------------ hero */}
      <header className="hf-hero">
        <PixelCorner side="left" />
        <PixelCorner side="right" />

        <div className="hf-narrow hf-center">
          <span className="hf-rainbow" aria-hidden="true">
            <i style={{ background: '#00f0ff' }} />
            <i style={{ background: '#00ff88' }} />
            <i style={{ background: '#ffb020' }} />
            <i style={{ background: '#ff1e56' }} />
          </span>

          <p className="hf-eyebrow">360° · Tiempo real · Para personas sordas</p>

          <h1 className="hf-display hf-h1">
            El sonido tiene
            <br />
            <span className="hf-accent">dirección.</span> Ahora
            <br />
            también tiene forma.
          </h1>

          <p className="hf-lead">
            Jacobs Issue traduce lo que ocurre a tu alrededor en vectores visuales: de dónde viene un
            sonido, con cuánta fuerza y si deberías preocuparte. Sin depender de oírlo.
          </p>

          <div className="hf-hero-actions">
            <a className="hf-btn" href="#/signup" onClick={enter('/signup')}>
              Crear una cuenta
            </a>
            <a className="hf-btn hf-btn-ghost" href="#/hud" onClick={enter('/hud')}>
              Ver el HUD en marcha
            </a>
          </div>

          <p className="hf-lead" style={{ fontSize: '0.85rem', marginTop: '1.5rem', opacity: 0.8 }}>
            Funciona sin cuenta: el HUD y la caja negra arrancan con solo dar permiso al micrófono.
          </p>
        </div>
      </header>

      {/* ------------------------------------------------------ cifras ---- */}
      <div className="hf-band-blue">
        <div className="hf-stats">
          <div className="hf-stat">
            <strong>360°</strong>
            <span>de cobertura acústica alrededor del usuario</span>
          </div>
          <div className="hf-stat">
            <strong>±90°</strong>
            <span>de precisión direccional real con dos micrófonos</span>
          </div>
          <div className="hf-stat">
            <strong>0,96 s</strong>
            <span>de ventana para clasificar cada sonido</span>
          </div>
          <div className="hf-stat">
            <strong>6</strong>
            <span>pantallas: HUD, forense, malla, estudio, alertas y dosimetría</span>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------- el problema */}
      <section className="hf-band hf-band-cream" id="problema">
        <div className="hf-narrow">
          <p className="hf-eyebrow hf-coral-text">El problema</p>
          <h2 className="hf-display hf-h2">
            Una bicicleta que se acerca por detrás no avisa dos veces.
          </h2>
          <p style={{ marginTop: '1.5rem' }}>
            Quien no oye no pierde solo el sonido: pierde la <strong>posición</strong> de lo que
            ocurre. Un claxon, una alarma de incendio, alguien que llama desde la cocina. La
            información existe, llega al cuerpo como vibración en el aire, pero no se convierte en
            nada utilizable.
          </p>
          <p>
            Los subtítulos automáticos resolvieron el habla. Nadie resolvió el{' '}
            <em>resto del mundo sonoro</em>: el que avisa de un peligro, el que dice que algo se está
            quemando, el que indica que hay alguien detrás de ti.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------- cómo funciona */}
      <section className="hf-band hf-band-green" id="como">
        <div className="hf-wrap">
          <p className="hf-eyebrow">Cómo funciona</p>
          <h2 className="hf-display hf-h2">
            Tres pasos entre el aire
            <br />
            y <span className="hf-accent">tu campo de visión.</span>
          </h2>

          <div className="hf-grid">
            <article className="hf-card">
              <span className="hf-card-num">01</span>
              <h3 className="hf-display hf-h3">Escuchar en estéreo</h3>
              <p>
                El micrófono se abre sin cancelación de eco ni control automático de ganancia: ambos
                destruirían la medición de nivel y la diferencia de fase entre canales, que es justo
                de donde sale la dirección.
              </p>
            </article>

            <article className="hf-card">
              <span className="hf-card-num">02</span>
              <h3 className="hf-display hf-h3">Situar la fuente</h3>
              <p>
                La correlación cruzada GCC-PHAT mide el retardo con el que el sonido llega a cada
                micrófono. Ese retardo, de microsegundos, determina el ángulo. Si el equipo solo tiene
                un canal, el sistema lo dice en vez de inventarse una dirección.
              </p>
            </article>

            <article className="hf-card">
              <span className="hf-card-num">03</span>
              <h3 className="hf-display hf-h3">Nombrar y avisar</h3>
              <p>
                El clasificador etiqueta el sonido y el HUD lo dibuja como un vector con color de
                riesgo. Si es crítico y no lo reconoces a tiempo, el árbol de escalamiento avisa a tus
                contactos de confianza.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- pantallas */}
      <section className="hf-band hf-band-cream" id="pantallas">
        <div className="hf-wrap">
          <p className="hf-eyebrow hf-coral-text">La suite</p>
          <h2 className="hf-display hf-h2">Seis pantallas, un solo sistema.</h2>

          <div className="hf-screens">
            {[
              ['⊙', 'Tactical HUD', 'Radar de 360° en tiempo real, con perfiles de zona para casa, calle u oficina.'],
              ['☷', 'Incident Logs', 'Caja negra acústica: forma de onda y espectrograma reales de cada evento.'],
              ['☩', 'Sensor Mesh', 'Varios dispositivos cubriendo habitaciones distintas, con pulso de vida.'],
              ['🎛', 'Sound Studio', 'Enrola tu timbre, tu lavadora, tu alarma. Los modelos generales no los conocen.'],
              ['⚠', 'Safety Tree', 'Reglas de escalamiento y contactos para emergencias desatendidas.'],
              ['📊', 'Dosimetry', 'Exposición acumulada según el criterio NIOSH/OMS para cuidar la audición residual.'],
            ].map(([glyph, title, desc]) => (
              <div className="hf-screen-row" key={title}>
                <span className="hf-screen-glyph" aria-hidden="true">
                  {glyph}
                </span>
                <div>
                  <h3 className="hf-display hf-h3">{title}</h3>
                  <p>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- accesibilidad */}
      <section className="hf-band hf-band-coral">
        <div className="hf-narrow">
          <p className="hf-eyebrow">Un compromiso</p>
          <h2 className="hf-display hf-h2">Preferimos decir «no lo sé» a inventarlo.</h2>
          <p style={{ marginTop: '1.5rem' }}>
            Cuando el micrófono es mono, no hay dirección posible: el sistema lo marca con confianza
            cero en lugar de dibujar una flecha convincente. Cuando el nivel en decibelios no está
            calibrado contra un sonómetro, se etiqueta como <strong>estimado</strong>. Cuando una
            alerta se registra pero no llega a salir ningún correo, el historial lo dice.
          </p>
          <p>
            En una herramienta de la que alguien puede depender para saber si hay peligro detrás,
            una certeza falsa es peor que una duda declarada.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------------------- FAQ */}
      <section className="hf-band hf-band-cream" id="faq">
        <div className="hf-narrow">
          <p className="hf-eyebrow hf-coral-text">Preguntas</p>
          <h2 className="hf-display hf-h2">Todo lo demás, respondido.</h2>

          <div className="hf-faq">
            <details>
              <summary>¿Necesito hardware especial?</summary>
              <p>
                No. Funciona con el micrófono de un portátil o un móvil desde el navegador. Si el
                equipo entrega dos canales, obtienes dirección real; si solo da uno, obtienes nivel y
                detección de eventos, y la interfaz te avisa de que la dirección no es fiable.
              </p>
            </details>
            <details>
              <summary>¿Por qué solo −90° a +90° y no los 360° completos?</summary>
              <p>
                Es una limitación física, no del software: dos micrófonos no pueden distinguir si un
                sonido viene de delante o de detrás, porque ambos casos producen el mismo retardo
                entre canales. Resolverlo exige un tercer micrófono. Preferimos reportar el rango
                honesto antes que rellenar la mitad trasera con suposiciones.
              </p>
            </details>
            <details>
              <summary>¿Se envía mi audio a algún servidor?</summary>
              <p>
                No. El análisis ocurre por completo en tu navegador, en el hilo de audio. Lo que viaja
                es telemetría: un ángulo, un nivel en decibelios y una etiqueta. El audio del evento se
                guarda solo en memoria para que puedas revisarlo en la caja negra.
              </p>
            </details>
            <details>
              <summary>¿Los decibelios son una medida real?</summary>
              <p>
                Son una <strong>estimación</strong>. La API de audio del navegador solo entrega nivel
                relativo a fondo de escala; convertirlo a decibelios absolutos exige calibrar contra un
                sonómetro de referencia, algo que puedes hacer desde la propia aplicación. La
                ponderación A sí es real y está verificada contra la tabla de la norma IEC 61672.
              </p>
            </details>
            <details>
              <summary>¿Hace falta cuenta para probarlo?</summary>
              <p>
                No para lo esencial: el HUD, la detección de eventos, la caja negra y la dosimetría
                funcionan como invitado. La cuenta hace falta para que tus sonidos enrolados y tus
                contactos de emergencia te sigan entre dispositivos.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- cierre */}
      <section className="hf-band hf-band-deep hf-center">
        <div className="hf-narrow">
          <h2 className="hf-display hf-h2">
            Ver el sonido.
            <br />
            <span className="hf-accent-green">Recuperar el espacio.</span>
          </h2>
          <div className="hf-hero-actions">
            <a className="hf-btn" href="#/signup" onClick={enter('/signup')}>
              Crear una cuenta
            </a>
            <a className="hf-btn hf-btn-ghost" href="#/hud" onClick={enter('/hud')}>
              Entrar como invitado
            </a>
          </div>
        </div>
      </section>

      <footer className="hf-footer">
        <div className="hf-footer-inner">
          <span>Jacobs Issue · PhonoSpatial HUD · Frontier Cascadia 2026</span>
          <span>
            <a href="#/login" onClick={enter('/login')} style={{ color: 'inherit' }}>
              Iniciar sesión
            </a>
          </span>
        </div>
      </footer>
    </div>
  )
}
