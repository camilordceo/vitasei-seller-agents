# Sprint 04 — Envío por Callbell + gate (texto + imágenes #ID)

- **Fecha / sesión:** 2026-06-30
- **Estado:** En progreso — código y verificación local listos; aceptación bloqueada por credenciales

## Objetivo
Sender Callbell abstraído (`sendText`, `sendImage`, guardando `callbell_message_uuid`). Gate:
descartar `#ID` cuyo SKU no exista en `products` (log `gate_blocked`) y validar ventana 24h.
Por cada `#ID` válido → `sendImage(image_url, caption)`; enviar `cleanText` como texto.
Persistir en `messages` + `events_log`.
**Aceptación:** cliente pide un producto → recibe texto + imagen correcta; un `#ID` inventado
NO genera envío y queda logueado como `gate_blocked`.

## Qué se hizo
- **Sender** (`lib/callbell/sender.ts`): `sendText(to, text, metadata?)` y
  `sendImage(to, url, caption?)` sobre `POST /v1/messages/send`; devuelven `{ uuid, status }`.
  Usa `CALLBELL_WHATSAPP_CHANNEL_UUID` si está. Errores HTTP → throw (Inngest reintenta).
- **Gate** (`lib/agent/gate.ts`, puro): `applyGate(skus, knownSkus, lastInboundAt, now)` →
  `{ validSkus, blockedSkus, withinWindow }`; `isWithinWindow` (24h). 7 tests.
- **`processMessage` (S4)**: tras generar/parsear → lookup de los SKUs en `products` →
  `applyGate` (usa `event.ts` como `now`, estable en replays) → si hay `blockedSkus`, log
  `gate_blocked`; si fuera de ventana, log `out_of_window` y no envía. Dentro de ventana:
  envía `cleanText` (guarda el `uuid` en el mensaje outbound del S3, log `text_sent`) y por
  cada `#ID` válido con imagen envía la imagen, inserta el `messages` tipo `image` y loguea
  `image_sent` (o `image_missing` si el producto no tiene `image_url`).
- **Idempotencia de envíos**: cada `sendText`/`sendImage` va en su propio `step.run`
  (memoizado por Inngest) → un reintento posterior no reenvía al cliente.

## Criterio de aceptación
- [x] **Verificación local** — `npm run typecheck` ✓, `npm test` (25/25; 7 del gate) ✓,
  `npm run build` ✓.
- [ ] **Texto + imagen correcta en WhatsApp** — pendiente: requiere `CALLBELL_API_KEY` +
  `products` con `image_url` (S2) + OpenAI/Supabase. Validación: inbound pidiendo un producto
  → llegan texto e imagen; `messages` con `callbell_message_uuid`; `events_log.image_sent`.
- [ ] **`#ID` inventado → `gate_blocked` sin envío** — pendiente de credenciales. La lógica
  del gate ya está verificada con Vitest (`VITA-999` inexistente → `blockedSkus`).

> El gate (lo que evita mandar imágenes de SKUs inventados) está verificado con tests; el
> envío real se valida end-to-end con credenciales.

## Desviaciones del PRD
- El texto se envía como **un** mensaje y cada imagen como mensajes `image` separados (uno por
  `#ID`), consistente con el envío por `POST /v1/messages/send` de Callbell.
- `now` del gate usa `event.ts` (no `Date.now()`) por determinismo en los replays de Inngest.

## Decisiones nuevas
- Ninguna nueva: el gate implementa el principio anti-alucinación y [ADR-0002](../decisions/0002-id-sku-join-key.md)
  (SKU como join key). El handoff con `team_uuid` + `bot_status` es del Sprint 5.

## Pendientes / deuda técnica
- Aceptación end-to-end con credenciales (texto + imagen + `gate_blocked`).
- Confirmar el shape exacto de `content` para imagen en la versión de la API de Callbell
  (campo `url` vs `attachment`) contra un envío real (doc 04 §3).
- Manejo de errores/reintentos finos de Callbell (parcial: HTTP→throw) — S7.

## Archivos principales
- `lib/callbell/sender.ts`
- `lib/agent/gate.ts`, `lib/agent/gate.test.ts`
- `inngest/functions/processMessage.ts`
