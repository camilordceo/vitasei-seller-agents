# ADR-0007: Concurrencia del loop keyed por teléfono (proxy de conversation_id)

- **Estado:** Aceptada
- **Fecha:** 2026-06-28
- **Sprint:** 1

## Contexto
`01-arquitectura.md` pide `concurrency` por `conversation_id` en Inngest para que dos
mensajes seguidos del mismo cliente no generen respuestas pisadas. Problema: el
`conversation_id` interno **no existe al momento de encolar** el evento desde el webhook
—se resuelve recién dentro de la función, tras el upsert de contacto/conversación. La
clave de concurrencia de Inngest se evalúa sobre el `event.data`, no sobre estado
derivado dentro de la función.

## Decisión
Keyear la concurrencia por **`event.data.phone`** (teléfono normalizado E.164 sin `+`),
con `limit: 1`. El webhook normaliza el teléfono y lo incluye en el payload del evento.

En v1 un contacto tiene **una sola conversación activa**, por lo que "una a la vez por
teléfono" es equivalente a "una a la vez por conversación" para el objetivo de no pisar
respuestas. La verificación de idempotencia (ver
[ADR-0006](0006-idempotencia-callbell-message-uuid.md)) corre así sin carrera.

## Consecuencias
- Serializa el procesamiento por cliente sin necesidad de conocer el `conversation_id`
  antes de tiempo. El get-or-create de contacto/conversación es seguro (sin carrera).
- El teléfono normalizado pasa a ser parte del contrato del evento
  `whatsapp/message.received` (`lib/inngest/client.ts`).
- **Límite conocido:** si en el futuro un contacto pudiera tener varias conversaciones
  activas en paralelo, habría que migrar la clave a `conversation_id` (posible vía un
  paso previo que resuelva la conversación y reenvíe un evento, o keyear por
  `contact_uuid`). Documentado como deuda para cuando aplique.
- El debounce opcional (agrupar mensajes consecutivos) queda para S3+.

## Alternativas consideradas
- **Keyear por `conversation_id`:** imposible en el `send` del webhook (aún no existe).
- **Resolver la conversación en el webhook antes de encolar:** rompe el principio
  "webhook responde rápido, nada de trabajo pesado inline" (`CLAUDE.md`).
- **Sin límite de concurrencia:** arriesga respuestas pisadas y duplicados ante ráfagas.
