# ADR-0015: Filtro por número de la IA en el webhook (un webhook, varios números)

- **Estado:** Aceptada
- **Fecha:** 2026-07-01
- **Sprint:** post-S5 (ajustes v1.1 — ver docs/09)

## Contexto
La cuenta de Callbell tiene **varios números** y Callbell solo permite **un webhook**. Ese
único endpoint recibe inbound de **todos** los números. El agente solo debe responder a los
mensajes que llegan al **número de la IA (`573332877350`)**; los demás números los atienden
personas u otros flujos y el bot **no** debe meterse ahí.

El shape exacto del webhook `message_created` no está 100% confirmado (como el resto de la
integración, se valida contra un webhook real; por eso guardamos el body crudo).

## Decisión
Filtrar al inicio del webhook, antes de la ingesta (`app/api/webhooks/callbell/route.ts` +
`lib/callbell/types.ts` → `classifyInbox`):

1. **Por número destino** (`AGENT_WHATSAPP_NUMBER`) si el webhook trae el número de negocio
   (probamos varios campos candidatos: `to`, `channel.phoneNumber`, …).
2. **Fallback por `channel_uuid`** (`CALLBELL_WHATSAPP_CHANNEL_UUID` = canal del número de la
   IA) si no viene el número.
3. **`indeterminate`** si con este webhook no se puede leer ni número ni canal: se **procesa
   igual** (fail-open) y se registra `inbox_indeterminate` con el crudo para confirmar el
   campo y endurecer.

`reject` → 200 ok sin procesar (+ `inbox_rejected`). Sin `AGENT_WHATSAPP_NUMBER` ni
`CALLBELL_WHATSAPP_CHANNEL_UUID`, el filtro queda **off** (dev).

## Consecuencias
- El bot deja de responder en números que no son el suyo — requisito del negocio.
- Fail-open en el caso `indeterminate` evita un "bot muerto" si el campo del webhook difiere
  de lo esperado; el log del crudo permite confirmarlo en minutos y pasar a determinista.
  Con `CALLBELL_WHATSAPP_CHANNEL_UUID` seteado, `indeterminate` no debería darse.
- Dos variables de setup: `AGENT_WHATSAPP_NUMBER` (obligatoria en prod) y el
  `CALLBELL_WHATSAPP_CHANNEL_UUID` del número de la IA (recomendada para el fallback).
- Lógica pura y testeada (`lib/callbell/types.test.ts`).

## Alternativas consideradas
- **Fail-closed en `indeterminate`:** más estricto, pero si el campo esperado no existe,
  bloquea TODOS los mensajes (bot caído). Preferimos fail-open + log y endurecer tras
  confirmar el webhook real.
- **Solo por `channel_uuid`:** muy robusto, pero el negocio piensa en el número; el número es
  la config primaria y el canal el fallback. Combinamos ambos.
- **Un webhook por número:** Callbell no lo permite en esta cuenta.
