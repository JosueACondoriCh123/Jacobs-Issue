# Dev 2 — Frontend Audio DSP & Sensor Client

Captura de micrófono, DSP en tiempo real (nivel, dirección, eventos) y publicación de
telemetría en el canal `hud-telemetry`. Todo el código de Dev 2 vive en
`src/audio/**` y en `test-audio.html`; no se ha tocado ningún archivo de Dev 1.

## Banco de pruebas

```bash
pnpm dev
```

Abrir **http://localhost:5173/test-audio.html**.

> El botón **«Simular sin micrófono»** genera telemetría sintética sin pedir permisos.
> Si en la sede falla el micrófono o hay demasiado ruido, la demo sigue en pie.

## Para Dev 1 (HUD)

```ts
import { AudioCaptureEngine, TelemetryPublisher } from './audio'

const engine = new AudioCaptureEngine()
const publisher = new TelemetryPublisher()   // mock o supabase, según el entorno

await publisher.connect()
await engine.start()
engine.onTelemetry((t) => publisher.publish(t))
engine.onStatusChange((s) => console.log(s.warnings))
```

Para recibir en otra pestaña sin backend (transporte `mock`):

```ts
import { subscribeMockTelemetry } from './audio'
subscribeMockTelemetry((payload) => accept(normalizeTelemetry(payload, 'broadcast')))
```

## Para Dev 4 (clasificador YAMNet)

```ts
engine.onFrame(({ pcm, sampleRate }) => classify(pcm))
```

Entrega exactamente lo que YAMNet espera: **15360 muestras (0,96 s) a 16 kHz, mono,
float32 en [-1, 1]**, con 50 % de solape (una ventana nueva cada 0,48 s). El diezmado
48→16 kHz lleva un FIR antialias; medido, rechaza 15 kHz en **−89 dB**.

La suscripción es la que activa el trabajo: mientras nadie escuche, no se diezma nada.

## Para Dev 3 (backend)

`NoiseFloorTracker.toCalibrationBaseline()` produce el payload exacto de
`POST /api/v1/calibration/baseline` (`ambient_average_db`, `peak_transient_db`,
`environment_type`).

## Variables de entorno

`.env.local` (ya creado, ignorado por git):

```
VITE_SUPABASE_URL=https://bbaznvpitxauwggzrsgq.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_TELEMETRY_TRANSPORT=supabase   # mock | supabase
```

Si `VITE_TELEMETRY_TRANSPORT` no se define, se usa Supabase cuando hay credenciales y
`mock` en caso contrario. El selector de la página de pruebas arranca mostrando lo que
el entorno va a hacer de verdad, para que nadie crea que está en mock mientras publica
en el canal real.

### Estado del canal real: verificado

Probado contra el proyecto de Supabase con dos clientes independientes (emisor y
receptor, como serán la página de Dev 2 y el HUD de Dev 1):

| Métrica | Resultado |
|---|---|
| Entrega | **82 publicados → 82 recibidos (100 %)** |
| Onsets | **2 emitidos → 2 recibidos** (ninguno descartado) |
| Latencia por los servidores de Supabase | **~123 ms** de media |
| Autenticación | **no hace falta**: publica con la clave publishable, sin sesión |

Dos consecuencias prácticas:

- El canal broadcast **no exige login hoy**. Si Dev 3 endurece Realtime con RLS más
  adelante, habrá que iniciar sesión con Google antes de publicar y esto dejará de
  funcionar sin avisar. Conviene confirmarlo antes de la demo.
- Con `mock` la latencia es ~0 ms (mismo equipo) y con Supabase ~123 ms. Sigue muy por
  debajo del tiempo de reacción humano (~200 ms), pero el HUD se siente distinto: no
  confundir una cosa con la otra al ensayar.

---

## Contrato de telemetría: `intensity` va en DECIBELIOS

Esto merece un aviso explícito porque es la trampa más fácil de la integración.

El documento de arquitectura sugiere `intensity` como valor normalizado 0..1. **El HUD
no lo usa así**: lo trata como decibelios. Se comprueba en tres puntos independientes
del código de Dev 1:

| Dónde | Qué demuestra |
|---|---|
| `lib/telemetry.ts` → `mapAcousticEvent` | mapea `decibels` → `intensity` |
| `lib/telemetry.ts` → `normalizeTelemetry` | recorta `intensity` a `0..120` |
| `services/mockTelemetryEmitter.ts` | genera `intensity` desde `minDb`/`maxDb` |

Enviar un 0..1 haría que el HUD dibujara nivel prácticamente cero, **sin ningún error
visible**. Por eso el publicador envía `intensity` en dB(A), y además `decibels` con el
mismo valor para que la semántica quede explícita en el cable.

Si el equipo prefiere normalizar a 0..1, hay que cambiarlo **en los dos lados a la vez**.

## Azimut

GCC-PHAT produce −90..+90 y el publicador lo mapea a **0..360** (0 = frente,
90 = derecha, 270 = izquierda), que es la convención del HUD.

La mitad trasera queda siempre vacía, y no es un descuido: **dos micrófonos no pueden
distinguir delante de detrás**. Un sonido a +30° y otro a 150° producen el mismo retardo
inter-aural. Conviene decirlo en la demo antes de que lo pregunte el jurado.

## Cuándo NO hay dirección real

`spatialConfidence: 0` significa que no hay información espacial utilizable. Ocurre si el
dispositivo entrega un solo canal, si los dos canales son idénticos (un micrófono mono
que el navegador duplica) o si el derecho está mudo.

En ese caso se sigue enviando un ángulo estable para que el HUD tenga algo que dibujar,
pero **el HUD debe atenuarlo o marcarlo**, no presentarlo como un hecho. Un sistema de
accesibilidad que inventa direcciones con confianza alta es peor que uno que admite no
saber.

La detección se hace sobre las muestras, no sobre lo que declare el navegador:
`track.getSettings().channelCount` puede faltar y `AudioNode.channelCount` es
configuración (vale 2 por defecto), no medición.

## dB SPL: estimado, no absoluto

La Web Audio API solo entrega nivel relativo a fondo de escala (dBFS). Se aplica
`dB_SPL ≈ dBFS + offset`, con el offset ajustable desde la página de pruebas contra un
sonómetro de referencia (se guarda en `localStorage`). La UI lo etiqueta siempre como
«estimado»; presentarlo como medición absoluta sería falso.

La ponderación A sí es real: cascada de biquads verificada contra la tabla de la
IEC 61672, dentro de ±1 dB entre 31,5 Hz y 8 kHz.

## Verificación

```bash
node src/audio/dsp/verify.mjs
```

43 comprobaciones sobre FFT, ponderación A, GCC-PHAT (recuperación de retardos conocidos
y convención de signo), niveles, suelo de ruido, detección de onsets y fallback mono. No
necesita micrófono ni navegador: valida los algoritmos sin depender de la acústica de la
sala, que es justo lo que no se puede dar por bueno en una sede de hackathon.

### Qué está verificado y qué no

Verificado en navegador real, inyectando un `MediaStream` sintético con retardo conocido
en lugar del micrófono, y publicando en el canal de Supabase de produccion:

- fuente estéreo con 12 muestras de retardo → azimut **−34,87°**, idéntico a la
  predicción offline;
- fuente mono → `spatialConfidence: 0` y aviso, sin inventar dirección;
- frames de 15360 muestras a 16 kHz;
- el payload llega íntegro al otro extremo, tanto por `BroadcastChannel` como por
  Supabase Realtime (100 % de entrega, onsets incluidos).

**Pendiente de validar por una persona**: la ruta de `getUserMedia` con un micrófono
físico. El panel de navegador usado durante el desarrollo bloquea el permiso, así que
queda por confirmar en Chrome real:

1. que `channelCount` real sea 2 y que AEC/NS/AGC aparezcan en `off`;
2. que al chasquear los dedos a izquierda y derecha la aguja se mueva a cada lado;
3. que una palmada genere **un** evento en el registro, no una ráfaga.

## Nota de construcción

`test-audio.html` está en la raíz de `apps/frontend`, así que funciona en `pnpm dev`
tal cual. Para que se incluya también en `pnpm build` hay que añadirlo como entrada en
`vite.config.ts`, que es archivo compartido y no se ha modificado:

```ts
build: { rollupOptions: { input: { main: 'index.html', testAudio: 'test-audio.html' } } }
```
