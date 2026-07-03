# ADR-0025: Resiliencia ante `previous_response_id` inválido (regenerar sin cadena)

- **Estado:** Aceptada
- **Fecha:** 2026-07-03
- **Sprint:** —  (fix operativo, migración de cuenta OpenAI)

## Contexto
Al migrar la `OPENAI_API_KEY` de la cuenta personal a la de la empresa, el bot dejó de
responder en **conversaciones ya abiertas**. Causa: encadenamos cada turno con
`conversations.openai_previous_response_id` (un `resp_...`). Esos IDs **pertenecen a la cuenta/
proyecto de OpenAI que los creó y no son portables**: con la key nueva, `responses.create`
falla con 404 ("Previous response … not found"). El error se tragaba en el `try/catch` de
`runDebouncedReply` (`process_error`), así que la conversación quedaba muda. Las conversaciones
nuevas (id en null) no se veían afectadas.

Ya teníamos el principio (CLAUDE.md, docs/05 §3): **Supabase es la fuente de verdad del
historial; `previous_response_id` es solo conveniencia.** Pero el código no lo honraba: si la
cadena fallaba, no había fallback.

## Decisión
`generateReply` detecta el fallo de `previous_response_id` no encontrado y **reintenta una vez
SIN encadenar** (`previous_response_id: undefined`). Devuelve `chainReset: true` para trazarlo.
El caller ya persiste el `response.id` nuevo en `openai_previous_response_id`, con lo que la
conversación **se auto-recupera desde el siguiente turno** (vuelve a encadenar, ya en la cuenta
nueva). Aplica al flujo normal y a los seguimientos (mismo `generateReply`).

Si el reintento sin cadena también falla, el error **se propaga** (era un problema real —modelo,
vector store, API key— no la cadena). Errores no-404 con cadena presente no se reintentan.

## Consecuencias
- **Bueno:** ninguna conversación se pierde al rotar de cuenta; cero cirugía de datos (no hay
  que borrar `openai_previous_response_id` a mano). Robusto también ante IDs expirados.
- **Malo:** el turno que "sana" la conversación pierde el contexto encadenado de OpenAI (va solo
  con el mensaje actual + system prompt). Aceptable: es un único turno por conversación y el
  prompt es fuerte. Si se quiere contexto pleno en ese turno, reconstruir historial desde
  `messages` (documentado en docs/05 §3) — queda para más adelante.
- **Costo:** en el turno que resetea se hacen 2 llamadas a OpenAI (la fallida + el reintento).
  Marginal (una vez por conversación migrada).

## Alternativas consideradas
- **Borrar `openai_previous_response_id` de todas las conversaciones activas por SQL:** arregla
  el momento pero es manual, no protege ante futuras rotaciones/expiraciones y también pierde el
  contexto de ese turno. Se puede usar como desbloqueo inmediato, pero el fix de código lo hace
  innecesario.
- **Reconstruir el historial desde Supabase en el reintento:** más fiel, pero más código/riesgo.
  Se deja como mejora futura sobre este mismo punto de fallback.
