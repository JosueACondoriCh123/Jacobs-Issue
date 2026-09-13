# Circuito real: estado y aceptación del MVP

La captura y YAMNet son locales. Las muestras continuas actualizan HUD/Mini HUD sin insertar cada nivel en base de datos. Una clasificación con confianza **mayor que 0,80** genera un UUID, se conserva localmente y se inserta en `acoustic_event_logs`. Solo tras confirmación se emite ese mismo UUID por Realtime. Broadcast y Postgres Changes se deduplican por ID. El antirrebote por etiqueta/riesgo es de 2,5 segundos.

La inferencia es asíncrona: una operación activa y únicamente el frame pendiente más reciente. El modelo utiliza ventanas de 0,96 segundos con salto de 0,48 segundos; **no se garantiza un circuito completo de 50 ms**. Un error del modelo no activa un heurístico en producción. La ausencia de muestras durante más de dos segundos significa “sin señal”, no silencio de la sala.

## Configuración

Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (o la clave anon pública legada), `VITE_TELEMETRY_TRANSPORT=supabase`. Nunca claves de servicio ni secretos Resend en `VITE_*`. Para canales privados, configurar las políticas Realtime y `VITE_SUPABASE_REALTIME_PRIVATE=true` según el entorno existente.

Servidor, proyecto correcto: `RESEND_API_KEY` y `RESEND_FROM_EMAIL`, con remitente/dominio validado por Resend. El usuario debe iniciar sesión y guardar contactos reales en Safety Tree. Los contactos locales no son destinatarios que pueda consultar el servidor.

Antes de desplegar `notify-emergency`, aplicar **solo la nueva migración `20260912000006_live_emergency_compat.sql`** a instalaciones que ya tienen 001–005. No volver a ejecutar 005: esa migración histórica contiene un `DROP TABLE`. La nueva migración conserva filas y columnas relacionales, restaura las columnas necesarias para eventos y añade una clave única de despacho y una función de reclamación solo para servidor. Corregir estos permisos de despacho es parte de la integración; no constituye una auditoría general de privacidad.

Desplegar ambos archivos de `apps/backend/supabase/functions/notify-emergency`. La petición es `{ event_id }`: el servidor valida el token del usuario, consulta el evento propio y sus contactos activos y adopta la cola existente. Los clientes no pueden escribir aceptación en la auditoría. Resend utiliza una clave estable por evento/contacto. `SENT` significa **aceptado por Resend**, no entregado al buzón. La clave del proveedor protege reintentos durante 24 horas; un envío cuyo resultado/auditoría sea incierto requiere revisión antes de un reintento posterior a ese plazo.

## Modelo reproducible

Los archivos oficiales convertidos están en `public/models/yamnet`: modelo Layers, pesos, mapa de 521 clases, licencia y procedencia. No se cargan desde TF Hub en producción.

Para regenerarlos: instalar en un entorno Python aislado `tensorflow==2.20.0`, `tf-keras==2.20.1`, `h5py==3.14.0` y ejecutar `python scripts/export_yamnet.py` desde el frontend. El script descarga los pesos y el código oficial, compara la red de parches contra la red completa oficial y genera una referencia con el audio grabado `speech_whistling2.wav`. La prueba de paridad comprueba características y todas las puntuaciones con tolerancia 0,001.

## Medidas y persistencia de la vista

Los valores son **dB estimados**. Ajustar el offset contra un sonómetro de referencia no convierte automáticamente el micrófono en un instrumento certificado. Aprender el ruido de fondo es distinto de calibrar físicamente el micrófono. En mono o sin confianza espacial suficiente, el ángulo legado es 0 neutro, marcado inválido y oculto; no se presenta dirección medida.

El proveedor global mantiene captura, modelo, Mini HUD y cuenta atrás al cambiar entre pantallas, incluida la landing. La alerta pendiente permite reconocer desde cualquier pantalla. Picture-in-Picture necesita que la pestaña original siga abierta. Si el navegador no lo admite, se ofrece una vista compacta **dentro de la página**, no una ventana siempre visible sobre otras apps.

## Verificación local

Desde `apps/frontend`: `pnpm exec tsc --noEmit`, `pnpm exec vitest run --pool=threads --maxWorkers=1`, `pnpm build`. El núcleo DSP tiene además `node src/audio/dsp/verify.mjs`. Los dobles de backend/micrófono utilizados en pruebas no son transportes de producción.

## Aceptación real pendiente

1. Confirmar el proyecto `bbaznvpitxauwggzrsgq`, migración 006, función desplegada, secretos de servidor y remitente validado.
2. Iniciar sesión, guardar un contacto/buzón de prueba expresamente autorizado y activar captura con un micrófono físico.
3. Hacer sonar una alarma física; comprobar identificación/confianza >80%, UUID único y “guardado” solo tras la respuesta de Supabase.
4. Cambiar de pantalla durante captura y durante la cuenta atrás; reconocer una alerta y comprobar que esa alerta no provoca correo. Repetir sin reconocimiento para probar escalado.
5. Recuperar el mismo evento del backend después de recargar, confirmar una aceptación real de Resend y verificar recepción en el buzón autorizado. La aceptación sin correo recibido no completa la aceptación del MVP.
6. Denegar permiso, desconectar el micrófono y bloquear red/modelo: no deben aparecer lecturas tranquilas ni guardados/envíos ficticios. Las barras deben quedar sin animación al perder señal.

No marcar el MVP terminado solo porque pasan pruebas y build. Sin conexión al proyecto correcto o configuración Resend, el despliegue y la alarma/correo físicos siguen pendientes.
