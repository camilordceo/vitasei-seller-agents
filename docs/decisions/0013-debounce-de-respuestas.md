# ADR-0013: Debounce de respuestas (agrupar mensajes seguidos) con waitUntil

- **Estado:** Aceptada
- **Fecha:** 2026-07-01
- **Sprint:** post-S5 (refactor de simplicidad)

## Contexto
En WhatsApp los clientes suelen mandar **varios mensajitos seguidos** ("hola",
"quiero una silla", "para mi oficina"). Responder a cada uno por separado da mala UX
(el bot contesta 3 veces), gasta 3 llamadas a OpenAI y abre la puerta a respuestas
pisadas. Al quitar Inngest (ADR-0012) también se perdió la serialización por teléfono.

El dueño ya usaba en Bubble un patrón de **debounce**: al llegar un mensaje se programaba
la respuesta ~20s después; si llegaba otro, se re-programaba; y la respuesta contestaba a
todos los mensajes del último minuto. Queríamos el mismo comportamiento **sin reintroducir
un servicio externo**.

## Decisión
Debounce implementado con la primitiva nativa de Vercel **`waitUntil`** (`@vercel/functions`),
sin cola ni cron:

1. **Ingesta síncrona** (dentro del request): guardar el inbound y marcar la conversación
   con `last_inbound_message_uuid = <este uuid>` (el "quién gana"). Responder 200.
2. **Respuesta en background** (`waitUntil(runDebouncedReply)`): esperar `REPLY_DEBOUNCE_MS`
   (default 12s, configurable por env) y comprobar si este mensaje **sigue siendo el
   último** (`last_inbound_message_uuid === miUuid`).
   - Si llegó otro después → apagarse (esa tarea responderá por el lote).
   - Si sigue siendo el último → juntar todos los inbound sin responder (posteriores a la
     última respuesta) en un solo turno y generar **una** respuesta (Responses +
     `previous_response_id` para el contexto previo).

## Consecuencias
- **Resuelve la serialización:** solo la tarea del último mensaje responde → nunca se pisan
  ni se duplican respuestas. Reemplaza la necesidad del lock por teléfono de ADR-0007.
- **Mejor UX y más barato:** una sola respuesta y una sola llamada a OpenAI para una ráfaga
  de mensajes; el modelo ve todo junto.
- **Latencia por diseño:** la respuesta sale ~`REPLY_DEBOUNCE_MS` después del último
  mensaje. Es intencional; se ajusta por env.
- **La función queda viva durante la ventana** (Fluid Compute mantiene la instancia con
  `waitUntil`). Un sleep es CPU casi ociosa → costo mínimo al volumen actual. `maxDuration`
  del webhook = 60s (cubre ventana + generación).
- **Doble-respuesta improbable:** si un mensaje llega justo cuando el ganador ya empezó a
  generar, no entra en ese lote; su propia tarea responderá como follow-up (encadenado con
  `previous_response_id`). Aceptable.
- **Si la instancia muere en la ventana** (deploy/crash), esa respuesta se pierde; el
  siguiente mensaje re-dispara. Caso raro.
- Nueva columna `conversations.last_inbound_message_uuid` (migración `0004`) y env
  `REPLY_DEBOUNCE_MS`.

## Alternativas consideradas
- **Vercel Cron + cola "due" en la DB:** funciona sin servicios externos, pero la
  granularidad del cron (≥1 min) agrega latencia y una pieza más. `waitUntil` da timing
  fino sin cron.
- **Vercel Queues / QStash / Inngest:** reintroducen infraestructura que justo quisimos
  quitar (ADR-0012).
- **Lock por teléfono (sin debounce):** serializa pero NO agrupa: seguiría respondiendo a
  cada mensajito por separado. El debounce cubre ambos objetivos.
