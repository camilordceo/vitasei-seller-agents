# Sprint 05 — Flujos de compra + handoff

- **Fecha / sesión:** 2026-07-01
- **Estado:** En progreso — código y verificación local listos; aceptación bloqueada por credenciales

## Objetivo
`#addi` (link + `fulfillment_method = addi`); `#compra-contra-entrega` (método cod);
`#orden-lista` (crear `orders` + `order_items` con envío e ítems); handoff (`team_uuid` +
`bot_end`, `status = handed_off`); `#humano` (handoff inmediato sin orden).
**Aceptación:** una compra completa (contra entrega y Addi) crea la orden correcta, reasigna a
logística, apaga el bot y el agente deja de responder.

## Qué se hizo
- **Extracción de orden** (`lib/openai/extractOrder.ts`): completion **aparte** con
  `response_format: json_schema` (strict) — SOLO al cerrar. Devuelve `items[]`, `shipping`,
  `fulfillment_method`, `notes`, `total`; lo ausente va `null` (no inventa). Ver ADR-0011.
- **Lógica pura de orden** (`lib/agent/order.ts`): `buildTranscript`, `computeOrderTotal`,
  `normalizeQty`, `resolveFulfillmentMethod`, `normalizeOrderItem`. 7 tests.
- **Sender** extendido (`SendOptions` con `teamUuid` + `botStatus`) para el handoff en el
  mismo envío (reasigna + `bot_end`).
- **`processMessage` (S5)**:
  - `#addi`/`#compra-contra-entrega` → `fulfillment_method` en la conversación; `#addi` envía
    `ADDI_LINK` si está configurado (v1 sin API Addi).
  - `#orden-lista` → arma el transcript desde `messages`, extrae la orden, crea `orders`
    (`pending_handoff`) + `order_items`, loguea `order_created`.
  - `#orden-lista`/`#humano` → texto con `team_uuid` + `bot_end`; `conversations.status =
    handed_off` + `assigned_team_uuid`; `orders.status = handed_off`; log `handoff`. En handoff
    no se envían imágenes (la conversación se cierra).

## Criterio de aceptación
- [x] **Verificación local** — `npm run typecheck` ✓, `npm test` (32/32; 7 de orden) ✓,
  `npm run build` ✓.
- [ ] **Compra contra entrega → orden + handoff** — pendiente: requiere OpenAI + Callbell +
  Supabase. Validación: conversación COD completa → `orders` con método `cod`, ítems y envío;
  `conversations.status = handed_off`; el bot deja de responder (`bot_end`).
- [ ] **Compra Addi → orden + handoff** — pendiente: ídem con `#addi` (método `addi`, link
  enviado si `ADDI_LINK`).
- [ ] **`#humano` → handoff inmediato sin orden** — pendiente de credenciales.

> La lógica pura (transcript, total, método, normalización de ítems) queda verificada con
> Vitest; el pipeline completo (extracción + envíos + reasignación) se valida end-to-end con
> credenciales y un `agent_config` activo.

## Desviaciones del PRD
- Datos de la orden: se obtienen con una **completion estructurada** (opción elegida por el
  dueño), no de un tag. Es la única llamada extra y solo al cerrar. Ver ADR-0011.
- En handoff se omite el envío de imágenes `#ID` (la conversación se está cerrando).

## Decisiones nuevas
- [ADR-0011](../decisions/0011-extraccion-de-orden-con-completion-estructurada.md) — extracción
  de la orden con completion estructurada.

## Pendientes / deuda técnica
- Aceptación end-to-end (COD, Addi, `#humano`) con credenciales.
- `order_items.product_id` queda `null`; se podría resolver por `sku` contra `products`.
- Nota interna opcional en Callbell con el resumen de la orden (doc 04 §4.3) — no implementada.
- Acotar/segmentar transcript si la conversación es muy larga (hoy 40 mensajes).

## Archivos principales
- `lib/openai/extractOrder.ts`
- `lib/agent/order.ts`, `lib/agent/order.test.ts`
- `lib/callbell/sender.ts` (`SendOptions`), `lib/env.ts` (`ADDI_LINK`)
- `inngest/functions/processMessage.ts`
- `docs/decisions/0011-*.md`, `.env.example` / `.env.local`
