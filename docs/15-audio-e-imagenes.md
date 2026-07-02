# 15 — Comprensión de audio e imágenes (multimodal)

> El agente ahora **ve** las imágenes y **escucha** las notas de voz que manda el cliente, y
> usa ese contenido para responder. Caso estrella: el cliente manda la **captura del comprobante
> de pago** o una **foto/pantallazo de un producto** y el bot responde con base en eso.

## 1. Problema

Callbell entrega los adjuntos (imagen, audio, video, documento) en el webhook `message_created`
dentro de `payload.attachments` (**array de URLs**). Hasta ahora el flujo:

1. El webhook solo leía `payload.text` → los adjuntos se perdían.
2. `gatherPendingInput` juntaba únicamente el `content` de texto → un mensaje solo-media tenía
   `content` vacío y **se descartaba** (`input.length === 0` → el bot no respondía).
3. `generateReply` mandaba solo texto a Responses.

Resultado: si el cliente mandaba **solo** una nota de voz o **solo** una imagen (comprobante de
pago, foto de producto), el bot no respondía o respondía a ciegas.

## 2. Objetivo

- **Audio** → transcribir con OpenAI y usar el texto como si el cliente lo hubiera escrito.
- **Imagen** → pasarla como entrada de **visión** a la misma llamada de Responses (el modelo la ve).
- **Responder a mensajes solo-media** (con o sin texto adicional).
- Sin romper el principio de **IA simple**: una sola llamada de razonamiento por ráfaga. La
  transcripción es **pre-proceso** (como `extractOrder`), no un loop de tools. La imagen va
  **dentro** de esa única llamada como `input_image`.

## 3. De dónde sale el media (Callbell)

`message_created` (ver `docs/04`):

```json
{
  "event": "message_created",
  "payload": {
    "type": "image",              // text | image | audio | video | document
    "text": "opcional (caption)",
    "attachments": ["https://.../archivo.jpg"],
    "contact": { "phoneNumber": "+57...", "uuid": "..." },
    "uuid": "..."
  }
}
```

`attachments` es `string[]`. Tomamos la **primera** URL como `mediaUrl`. WhatsApp manda un
adjunto por mensaje; si llegaran varias, se toma la primera (el resto queda en el `raw` del
`events_log`).

## 4. Flujo nuevo (dónde encaja)

```
Webhook (síncrono, rápido)
  └─ ingesta: guarda inbound con type + media_url (attachments[0])   ← NUEVO: media_url
Respuesta con debounce (background, waitUntil)
  └─ gatherPendingContent (por cada inbound pendiente):
       audio    → si no hay transcript, descarga + transcribe (OpenAI) → guarda en messages.content
       image    → descarga + base64 (data URL) → entra como input_image
       texto    → tal cual
       video/doc→ nota "no puedo verlo, descríbelo" (fuera de alcance)
  └─ generateReply (1× Responses): input = texto (+ transcripts) + imágenes (visión)
  └─ resto igual: parse tags → gate #ID → envío por Callbell → orden/handoff
```

### Por qué descargar y no pasar la URL de Callbell a OpenAI

- **Audio:** `audio.transcriptions.create` **exige subir el archivo** (multipart), no acepta
  URL. Descargar es obligatorio.
- **Imagen:** se descarga y se manda como **data URL base64**. Así OpenAI ve la imagen sin
  depender de que la URL de Callbell sea pública/estable (evita fallos silenciosos de visión).
  Guarda de tamaño con `MEDIA_MAX_BYTES`.

## 5. Persistencia

- **Audio:** la transcripción se guarda en `messages.content` del propio mensaje de audio →
  (a) el **dashboard** muestra lo que dijo el cliente, (b) el **transcript de la orden**
  (`extractOrder`) lo incluye, (c) no se re-transcribe en reintentos.
- **Imagen inbound:** se guarda `media_url` (URL de Callbell) → el dashboard la **renderiza**
  (`<img>`); no se persiste una descripción (la visión ocurre en la llamada del turno).

## 6. Modelos

- **Transcripción:** `OPENAI_TRANSCRIBE_MODEL` (default `whisper-1`), `language: "es"`
  (español colombiano).
- **Visión:** el **mismo** modelo del `agent_config` (familia GPT-5.x soporta `input_image`).
  No se usa un modelo aparte.

## 7. Configuración (env)

| Var | Default | Para qué |
|-----|---------|----------|
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` | Modelo de transcripción de audio |
| `MEDIA_UNDERSTANDING_ENABLED` | `true` | Kill switch global (audio + visión) |
| `MEDIA_MAX_BYTES` | `20971520` (20 MB) | Límite de descarga de un adjunto |

Ninguna es obligatoria: con defaults el deploy funciona. Para apagar el feature:
`MEDIA_UNDERSTANDING_ENABLED=false`.

## 8. Prompt del agente (migración `0009`)

Se agrega una sección **IMÁGENES Y NOTAS DE VOZ** al `agent_config.system_prompt` activo:
- El agente **ve** imágenes y **escucha** notas de voz (transcritas).
- **Comprobante/captura de pago:** agradece y confirma que lo **recibió**; el equipo de
  logística **valida el pago** (el bot **no** confirma el cobro). Si el pedido está listo,
  cierra con `#orden-lista`.
- Foto/pantallazo de producto: úsala para entender qué quiere; precios/specs **solo** del
  catálogo.
- Si la imagen no es legible, pide que la reenvíe. No inventar lo que no se ve.

> **Paso manual:** aplicar `supabase/migrations/0009_update_agent_prompt_media.sql` en Supabase.

## 9. Fuera de alcance (v1)

- **Video** (extraer frames) y **documentos/PDF** (lectura): se responde con una nota pidiendo
  texto. Backlog.
- Responder **con** audio (TTS): el bot sigue respondiendo por texto/imagen.
- Describir/loguear automáticamente cada imagen inbound: la visión vive en la llamada del turno.

## 10. Casos de aceptación

- [ ] Nota de voz sola → el bot responde a lo que se dijo; el dashboard muestra la transcripción.
- [ ] Imagen de comprobante de pago → el bot agradece/confirma recibido (sin confirmar el cobro).
- [ ] Foto de producto + texto → el bot responde usando ambos.
- [ ] `MEDIA_UNDERSTANDING_ENABLED=false` → media se ignora sin romper el flujo de texto.
- [ ] Fallo de transcripción/descarga → el bot igual responde (nota) y loguea el error.
