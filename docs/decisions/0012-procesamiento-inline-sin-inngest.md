# ADR-0012: Procesamiento inline del webhook, sin cola async (fuera Inngest)

- **Estado:** Aceptada
- **Fecha:** 2026-07-01
- **Sprint:** post-S5 (refactor de simplicidad)

## Contexto
El diseño original (ver `01-arquitectura.md`, ADR-0007) metía una cola async (Inngest)
entre el webhook y el procesamiento: el webhook respondía `200` rápido y encolaba
`whatsapp/message.received`; una función Inngest corría el flujo con `step.run` y
`concurrency` por teléfono.

Pero el agente es una **IA simple: UNA sola llamada** a Responses por mensaje
(`file_search` es hosted, no hay loop de tools). Todo el trabajo por mensaje —generar +
enviar por Callbell— tarda **unos segundos**, y Callbell tolera esperas largas en el
webhook (health-checks a ~10 min). En ese escenario, una cola async es infraestructura
que no paga su costo: suma un servicio externo, claves (`INNGEST_EVENT_KEY`/
`INNGEST_SIGNING_KEY`), un endpoint `/api/inngest`, un paso de "sync app" en el deploy y
la ceremonia de `step.run`.

El dueño pidió explícitamente simplificar a un solo workflow y reducir servicios externos.

## Decisión
Eliminar Inngest. El webhook `POST /api/webhooks/callbell` procesa el mensaje **inline**
(dentro del request) llamando a `processInboundMessage` (`lib/agent/processMessage.ts`),
y luego responde `200 {"status":"ok"}`. La lógica de S1/S3/S4/S5 se conserva íntegra;
solo se quita el envoltorio `step.run` y el `inngest.send`.

El vector store del catálogo se toma de `agent_config.vector_store_id` o, si no está, de
la env `OPENAI_VECTOR_STORE_ID` (el store se crea y administra directo en OpenAI).

## Consecuencias
- **Menos servicios externos:** quedan Supabase + OpenAI + Callbell. Fuera Inngest, sus
  dos claves, `/api/inngest` y el paso de sync en el go-live.
- **Un error de OpenAI/Callbell ya no se reintenta solo.** La idempotencia
  (`callbell_message_uuid`, ADR-0006) evita reprocesar el MISMO mensaje, pero si la
  generación falla, ese turno se pierde (queda logueado como `process_error`). Aceptable
  en v1; si hace falta robustez, se puede añadir un retry inline acotado alrededor de la
  llamada a Responses sin reintroducir la cola.
- **Se pierde la serialización por teléfono** que daba `concurrency: 1` (ADR-0007). Dos
  mensajes DISTINTOS del mismo cliente en la misma ventana de segundos podrían solaparse
  (get-or-create de conversación y encadenado de `previous_response_id` en carrera).
  Es un caso de borde (cliente escribiendo dos veces mientras se genera). Deuda conocida:
  si aparece, se resuelve con un índice único parcial `conversations(contact_id) where
  status='active'` + upsert, o un lock por teléfono. **Supera a ADR-0007.**
- El webhook fija `maxDuration = 60`s (margen para la llamada a Responses).

## Alternativas consideradas
- **Responder 200 primero y procesar con `waitUntil`:** válido en Fluid Compute, pero
  añade complejidad sin beneficio real dado que Callbell tolera la espera. Se prefirió el
  flujo lineal (más fácil de leer y depurar).
- **Mantener Inngest:** da retries y serialización "gratis", pero es un servicio externo
  más para una IA de una sola llamada. No paga su costo en v1.
