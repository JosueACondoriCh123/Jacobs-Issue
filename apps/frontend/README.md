# EchoVision HUD - Dev 1

Frontend aislado para las responsabilidades de Dev 1:

- Motor HUD visual de 360 grados en Canvas 2D.
- Profundidad ambiental y retícula espacial con Three.js.
- Interfaz Google OAuth mediante `@supabase/supabase-js`.
- Suscripción al canal Broadcast `hud-telemetry` y a inserciones de `acoustic_event_logs`.
- `mockTelemetryEmitter.ts` como entorno de prueba independiente.
- Mini HUD flotante con medidor de decibelios y estados Tranquilo, Normal, Atención y Peligro.

No incluye captura Web Audio, publicación del sensor, backend, RLS, Edge Functions ni el modelo YAMNet.

## Ejecutar

```bash
pnpm install
pnpm dev
```

La aplicación principal opera en modo `LIVE ONLY`: sin variables de entorno muestra un estado de conexión fallida y no genera eventos simulados. Para usar Supabase:

```bash
copy .env.example .env.local
```

Completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Usa exclusivamente una publishable key de navegador; nunca expongas `service_role` o una secret key.

El receptor escucha primero `broadcast:telemetry` como ruta de baja latencia y también `INSERT` de `acoustic_event_logs` como respaldo. Si ambas rutas entregan el mismo `id`, el evento se renderiza una sola vez. Incluye `emitted_at` o `commit_timestamp` en el payload para mostrar la latencia extremo a extremo.

El botón `MINI HUD` abre una ventana Document Picture-in-Picture siempre visible en navegadores compatibles. Requiere HTTPS en producción y una acción directa del usuario. Si el navegador no soporta la API, se muestra la misma vista compacta dentro de la aplicación.

En Supabase configura Google OAuth, agrega la URL local a las Redirect URLs y habilita Realtime para `public.acoustic_event_logs` si Dev 3 decide usar Postgres Changes. El cliente también escucha eventos Broadcast con esta forma:

```ts
channel.send({
  type: 'broadcast',
  event: 'telemetry',
  payload: {
    id: 'same-uuid-used-in-acoustic-event-logs',
    azimuth: 120,
    intensity: 82.5,
    label: 'Sirena',
    risk: 'CRITICAL',
    confidence: 0.94,
    captured_at: '2026-09-12T19:40:00.000Z',
    emitted_at: '2026-09-12T19:40:00.018Z',
  },
})
```

`id` debe coincidir con el registro persistido para que la llegada posterior por Postgres Changes sea descartada como duplicada. Los relojes del emisor y del navegador deben estar sincronizados para que la medición extremo a extremo sea fiable.

## Validar

```bash
pnpm test
pnpm build
```
