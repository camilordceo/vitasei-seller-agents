# ADR-0057: Aprovechar la transcripción de audio de Kapso en la ingesta

- **Estado:** Aceptada
- **Fecha:** 2026-07-16
- **Sprint:** post-v1 (multi-proveedor)

## Contexto

Desde ADR-0022 el bot entiende notas de voz: `gatherPendingContent` ve un mensaje de tipo
`audio` sin `content`, descarga el adjunto y lo transcribe con Whisper (`transcribeAudioUrl`),
persiste el texto en `messages.content` y lo cuenta en el "Costo IA" del dashboard.

El webhook de Kapso **ya trae la nota de voz transcrita** en `message.kapso.transcript.text`
(su plataforma la transcribe automáticamente). Pagar Whisper por un texto que ya nos regalan
—y agregarle latencia a la respuesta— no tiene sentido.

## Decisión

En el webhook de Kapso, la transcripción se guarda como el **`content` del mensaje** en la
ingesta:

```ts
const text = getTranscript(event) ?? getText(event);
```

No se toca el cerebro. `gatherPendingContent` ya solo transcribe **si el `content` está
vacío** (`if (!transcript && m.media_url && mediaOn)`), así que un audio de Kapso llega con
texto y la rama de Whisper sencillamente no se ejecuta. Whisper queda como **respaldo
automático**: si Kapso no mandó transcripción, el flujo de siempre la genera (para eso el
adaptador de Kapso también expone su credencial de media).

## Consecuencias

- Los agentes de Kapso no pagan Whisper por las notas de voz, y responden un poco antes (una
  descarga y una llamada a OpenAI menos por audio).
- **El "Costo IA" del dashboard no registra esos audios**, porque no hay evento
  `audio_transcribed` (que es de donde sale el costo, ADR-0022). Es correcto —el costo real es
  cero para nosotros— pero el cuadro "audio" del reporte quedará en 0 para las líneas de
  Kapso. No se inventó un costo ficticio.
- La calidad de la transcripción pasa a depender de Kapso y no de nuestro `language: "es"`
  fijo (que estaba ajustado para el acento colombiano). Si se detecta peor calidad, el
  interruptor es de una línea: dejar de leer `transcript` en el webhook y Whisper vuelve a
  encargarse.
- Los dos proveedores siguen compartiendo el MISMO código de transcripción; no hay una rama
  "si es Kapso" dentro del cerebro.

## Alternativas consideradas

- **Ignorar la transcripción de Kapso y transcribir siempre con Whisper:** uniforme entre
  proveedores y con el costo medido igual, pero se paga por algo ya hecho y se suma latencia
  a cada nota de voz.
- **Guardar la transcripción en un campo aparte** (no en `content`): obligaría a que el
  cerebro sepa de proveedores y a tocar `gatherPendingContent`. La gracia de meterlo en
  `content` es que el mecanismo de idempotencia que ya existía ("si hay texto, no transcribas")
  hace el trabajo solo.
- **Registrar un `audio_transcribed` con `costUsd: 0`** para que el reporte lo cuente: sería
  un evento que miente sobre su origen (no lo transcribimos nosotros). Se prefirió que el
  reporte muestre la verdad.
