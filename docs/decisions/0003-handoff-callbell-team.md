# ADR-0003: Handoff a logística vía reasignación de equipo en Callbell

- **Estado:** Aceptada
- **Fecha:** 2026-06-29
- **Sprint:** diseño (pre-0)

## Contexto
Cuando la orden queda lista, otro equipo (logística) confirma la venta y la entrega. El agente
debe dejar de responder en esa conversación y pasarla a ese equipo.

## Decisión
En `#orden-lista`/`#humano`: `POST /messages/send` con `team_uuid` (equipo logística) +
`bot_status: bot_end` en un solo llamado. Marcar `conversations.status = handed_off`.

## Consecuencias
- Handoff sin construir infraestructura extra: Callbell ya reasigna y apaga el bot.
- El equipo de logística recibe la conversación en su bandeja de Callbell con el contexto completo.
- Requiere tener `CALLBELL_LOGISTICS_TEAM_UUID` configurado.

## Alternativas consideradas
- **Notificación externa (Slack/email) + bot sigue activo:** riesgo de que el agente siga
  respondiendo encima del humano. Descartado.
