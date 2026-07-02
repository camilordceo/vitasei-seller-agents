# ADR-0022: Comprensión de audio e imágenes (multimodal)

- **Estado:** Aceptada
- **Fecha:** 2026-07-02
- **Sprint:** post-6 (feature)

## Contexto

Callbell entrega los adjuntos del cliente (imagen, audio, video, documento) en
`message_created` dentro de `payload.attachments` (`string[]`). El flujo solo leía
`payload.text`, así que un mensaje **solo-media** (una nota de voz, un comprobante de pago) se
descartaba: `gatherPendingInput` juntaba únicamente texto y `input.length === 0` cortaba la
respuesta. El negocio necesita que el bot **entienda** esos mensajes (caso estrella:
captura de comprobante de pago).

Disyuntivas:
1. ¿Transcribir el audio o mandar el audio crudo al modelo? El modelo de texto (`agent_config`)
   no acepta audio; solo modelos de audio dedicados. La transcripción con Whisper es simple,
   barata y deja el texto visible en el dashboard.
2. ¿Imagen por **URL** de Callbell o **descargada** (base64)? La URL evita la descarga pero
   depende de que sea pública/estable para OpenAI; una falla es silenciosa (el modelo "no ve").
3. ¿Un segundo modelo de visión o el mismo del `agent_config`? La familia GPT-5.x ya soporta
   `input_image` en Responses.

## Decisión

- **Audio → transcripción como pre-proceso.** Se descarga el adjunto y se transcribe con
  `audio.transcriptions.create` (`OPENAI_TRANSCRIBE_MODEL`, default `whisper-1`, `language: es`).
  El texto se guarda en `messages.content` del audio (visible en el dashboard, reutilizable por
  `extractOrder`, idempotente ante reintentos) y entra al turno como si fuera texto del cliente.
- **Imagen → visión en la MISMA llamada de Responses.** Se descarga el adjunto y se pasa como
  `input_image` con **data URL base64** (no la URL de Callbell), en la única llamada de
  razonamiento del turno. Sin descripción persistida.
- **Mismo modelo** del `agent_config` para visión (sin modelo aparte).
- Se mantiene el principio de **IA simple**: una sola llamada de razonamiento por ráfaga; la
  transcripción es pre-proceso (como `extractOrder`), no un loop de tools.
- **Kill switch** `MEDIA_UNDERSTANDING_ENABLED` (default ON) y guarda de tamaño `MEDIA_MAX_BYTES`.

## Consecuencias

- El bot responde a mensajes solo-media (antes los ignoraba).
- +1 llamada a OpenAI **solo** cuando hay audio (transcripción). La imagen NO agrega llamadas
  (va dentro del turno), pero sí tokens de visión.
- Latencia extra en la fase background (descarga + Whisper), dentro del `maxDuration` de 60s.
- Depende de que las URLs de `attachments` sean descargables desde el server (best-effort con
  reintento autenticado si el host es de Callbell). Un fallo no rompe el turno: se responde con
  una nota y se loguea.
- El prompt se ajusta (migración `0009`) para el caso de comprobantes de pago (el bot **no**
  confirma el cobro; eso es de logística).

## Alternativas consideradas

- **Mandar la URL de Callbell a OpenAI (visión por URL):** menos código, pero falla en silencio
  si la URL no es pública/estable. Descartada por robustez (es un feature de dinero/pagos).
- **Modelo de audio (audio-in) en vez de Whisper:** amarraría el `agent_config` a un modelo
  multimodal de audio y perdería el transcript visible. Descartada.
- **Loop de tools / segundo agente que "describe" la imagen:** rompe el principio de una sola
  llamada y suma latencia/costo sin beneficio. Descartada.
- **Procesar video/PDF ahora:** fuera de alcance v1; se responde pidiendo texto.
