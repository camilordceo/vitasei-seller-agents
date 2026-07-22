# 0073 — Techo de tiempo del webhook de mensajes y prueba de envío de video

- Estado: aceptada
- Fecha: 2026-07-22

## Contexto

En Vitasei USA el video por palabra clave dejó de salir. No había error, ni evento
`keyword_video_failed`, ni nada en `events_log`: simplemente no pasaba.

La medición de las conversaciones de USA del día lo explicó. El video es el **último**
paso del flujo de respuesta, y el webhook de Callbell corría con `maxDuration = 60`:

| webhook → último evento | último evento        | ¿salió el video? |
| ----------------------- | -------------------- | ---------------- |
| 22.5 s                  | `keyword_video_sent` | sí               |
| 59.5 s                  | `keyword_video_sent` | sí, raspando     |
| 56.2 s                  | `image_sent`         | **no**           |
| 56.7 s                  | `image_sent`         | **no**           |

Las respuestas de USA se acercan al minuto (debounce de 12s + generación + envío de la
imagen del producto), así que la invocación moría justo entre la imagen y el video. Como el
proceso se mata desde afuera, no queda ni excepción que loguear: el síntoma es el silencio.

El diagnóstico costó porque además **probar un video era imposible**: había que esperar a
que un cliente real escribiera la palabra clave, y en la conversación de prueba del operador
el video ya se había enviado una vez, así que la idempotencia por id (ADR-0038) lo bloqueaba
para siempre aunque se cambiara la URL.

## Decisión

1. **`maxDuration = 300`** en los webhooks de mensajes (Callbell y Kapso), en vez de 60.
   Vercel permite 300s en todos los planes; el 200 al proveedor sigue saliendo de
   inmediato, esto solo le da aire al trabajo en background (`waitUntil`).
2. **Botón "Probar"** en `/dashboard/videos`: envía el video elegido a un número, ya mismo,
   por el proveedor del mercado del video (`sendTestVideo`). No toca la conversación ni el
   marcador de "ya se envió" — es una prueba, no una interacción con el cliente. Queda
   registrado como `video_test_sent`.

## Consecuencias

- El video deja de depender de que la respuesta quepa en un minuto.
- 300s es un techo, no una espera: una respuesta rápida sigue terminando en 20s.
- Cambiar la URL de un video y verificarla pasa de "esperar a que un cliente escriba" a un
  clic. **No** cambia la regla de una-vez-por-conversación: el cliente que ya vio el video
  viejo no recibe el nuevo, y eso sigue siendo lo correcto para el cliente.

## Alternativas consideradas

- **Mandar el video antes de la respuesta.** Lo salvaría del recorte, pero el video sin el
  mensaje que lo presenta se ve como spam. El orden actual es el correcto.
- **Bajar el debounce para ganar 12s.** Ataca el síntoma y empeora el agrupamiento de
  mensajes seguidos, que es justo lo que el debounce existe para resolver (ADR-0013).
- **Idempotencia por URL en vez de por id de video.** Editar la URL volvería a enviar el
  video a quien ya lo vio. Se descartó: el botón de prueba resuelve la necesidad real del
  operador sin re-enviarle nada al cliente.
