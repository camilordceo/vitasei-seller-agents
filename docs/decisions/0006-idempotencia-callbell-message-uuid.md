# ADR-0006: Idempotencia por `callbell_message_uuid` y persistencia del inbound en S1

- **Estado:** Aceptada
- **Fecha:** 2026-06-28
- **Sprint:** 1

## Contexto
Callbell puede reintentar webhooks y el cliente puede generar eventos casi simultáneos.
El loop (Inngest) no debe procesar dos veces el mismo mensaje. El schema ya provee una
restricción `unique` en `messages.callbell_message_uuid`. La pregunta: ¿dónde y cómo
anclamos la idempotencia en el Sprint 1, si "guardar el mensaje inbound" formalmente
pertenece al SENSE del Sprint 3?

## Decisión
- **Clave de idempotencia = `callbell_message_uuid`.** En `processMessage`, antes de
  trabajar, se consulta si ya existe un `messages` con ese uuid; si existe → se omite
  (`skipped: duplicate`).
- **Se adelanta la persistencia del mensaje inbound a S1** (parte del SENSE de S3). El
  insert del inbound con su `callbell_message_uuid` respalda la idempotencia vía la
  restricción `unique`, además de dejar el historial listo. El REASON/PROPOSE de S3 se
  construye encima sin retrabajo.
- El webhook ya descarta eventos sin `uuid` o sin teléfono (no procesables de forma
  idempotente) respondiendo `200 ok`.

## Consecuencias
- Reprocesos de webhook no duplican contactos, conversaciones ni respuestas.
- La conversación queda con el historial inbound desde el Sprint 1 (útil para depurar).
- La verificación previa (`select` por uuid) + `concurrency:1` por teléfono (ver
  [ADR-0007](0007-concurrencia-loop-por-telefono.md)) evita la carrera entre dos eventos
  del mismo contacto.
- **Desviación menor del plan:** "guardar mensaje inbound" figuraba en S3; se adelantó a
  S1 por idempotencia. Registrado en `docs/sprint-log/sprint-01.md`.

## Alternativas consideradas
- **Idempotencia en `events_log`** (marcar el uuid ahí y consultarlo): descartada — el
  `unique` de `messages` ya existe y es la fuente natural; duplicar el mecanismo en
  `events_log` agrega complejidad sin ganancia.
- **No persistir inbound hasta S3:** obligaría a un mecanismo de idempotencia temporal
  (p.ej. tabla aparte) que luego se botaría. Más trabajo, menos limpio.
