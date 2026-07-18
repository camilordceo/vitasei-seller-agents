# ADR-0064: El tipo de mensaje se infiere del adjunto, no del webhook

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** —(corrección en producción)

## Contexto

Audios e imágenes que mandaba el cliente **nunca se procesaban**. El bot no escuchaba
las notas de voz ni veía las fotos, en silencio y sin ningún error en `events_log`.

La causa se encontró comparando el código contra los payloads reales guardados en
`events_log.type = 'webhook_received'`:

**Callbell no manda `type` en el evento `message_created`.** Las claves reales del
payload son `to, from, text, uuid, status, channel, contact, createdAt`, más
`attachments` cuando hay adjunto. El campo `type` no aparece nunca. La documentación
sugería lo contrario y el código lo leía directo (`payload.type ?? null`).

El efecto medido sobre 30 días de tráfico: **998 de 1000 mensajes inbound quedaron
guardados como `type = 'other'`** (solo 2 como `text`). Para los mensajes de texto no
se nota, porque `gatherPendingContent` empuja el `content` igual. Para los que traen
adjunto sí: la rama `other` **solo lee `content` y descarta `media_url`**, así que el
audio se guardaba en la base y jamás llegaba a Whisper ni a la visión. Consistente con
esto, en 30 días no hay un solo evento `audio_transcribed`, `image_received` ni
`image_fetch_failed`: esas ramas nunca se ejecutaron.

Dato útil: la URL del adjunto sí trae la extensión en el path
(`/uploads/<uuid>.mp3?X-Amz-Expires=600&…`, S3 prefirmado a 10 minutos).

Kapso no está afectado: su `message.type` sí llega (`"text"` en los 2 mensajes que
existen). Pero nunca ha recibido media, así que su ruta está sin estrenar.

## Decisión

**El tipo de un mensaje se deriva del adjunto cuando el proveedor no lo declara.**

1. `getMessageType(payload)` (Callbell): usa `payload.type` si viene —si Callbell lo
   agrega algún día, manda— y si no, lo infiere de la extensión del primer adjunto con
   `kindFromUrl`. Sin adjunto es `text`.
2. `kindFromUrl(url)` (`lib/messaging/media.ts`): clasificación pura por extensión,
   reusando las tablas que ya existían. No descarga nada.
3. Red de seguridad en `gatherPendingContent` (`effectiveType`): si una fila quedó como
   `other` **y tiene `media_url`**, se reclasifica por la extensión. Corrige solo hacia
   arriba: un `type` útil nunca se pisa.

Los puntos 1 y 2 arreglan la raíz y salen solos: el mensaje entra ya con el tipo
correcto. El punto 3 es defensa en profundidad y **queda pendiente de commitear** —
vive en `lib/agent/processMessage.ts`, que ahora mismo tiene entrelazada la feature de
llamadas de voz sin cerrar; sale con esa rama.

## Consecuencias

- El bot vuelve a escuchar audios y ver imágenes en Callbell.
- Los mensajes de texto pasan a guardarse como `text` en vez de `other`, así que la
  columna `messages.type` por fin sirve para analítica. Las filas históricas quedan mal
  clasificadas: no se hace backfill porque sus URLs prefirmadas ya expiraron.
- La deriva de un proveedor deja de ser silenciosa: aunque mañana Callbell o Kapso
  manden un `type` desconocido (`voice`, `ptt`, `sticker`), el adjunto se sigue
  procesando por su extensión.
- Queda atado a que la URL traiga extensión reconocible. Si un proveedor sirve adjuntos
  sin extensión, ese mensaje cae en `other` y se pierde igual que antes.
- **Restricción heredada:** las URLs de Callbell son S3 prefirmadas a **600 s**. El
  debounce (12 s) entra de sobra, pero cualquier reproceso posterior a 10 minutos
  encuentra un 403. Por eso la transcripción se persiste en `messages.content`: el
  reintento manual no vuelve a depender de la URL.

## Alternativas consideradas

- **Clasificar por el `content-type` real de la descarga.** Es lo más robusto, pero
  obliga a bajar el adjunto antes de saber si vale la pena y complica la rama `other`
  (que hoy también cubre texto mal tipado). La extensión ya resuelve el caso real.
- **Tratar todo mensaje con `attachments` como imagen.** Falso: el 100% del media real
  observado son notas de voz `.mp3`.
- **Pedirle a Callbell que agregue `type`.** No está bajo nuestro control y el bot está
  roto hoy. `getMessageType` ya deja el campo con prioridad para cuando exista.
