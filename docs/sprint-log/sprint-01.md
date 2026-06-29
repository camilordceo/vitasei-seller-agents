# Sprint 01 — Base Next.js + Supabase + webhook

- **Fecha / sesión:** 2026-06-28
- **Estado:** En progreso — código completo y verificado local; aceptación end-to-end
  pendiente de credenciales + webhook público

## Objetivo
Scaffold Next.js 14 + TS + Tailwind; clientes Supabase (browser + server/service-role);
migración aplicada + bucket `product-images`; Inngest (cliente + `/api/inngest`); webhook
`POST /api/webhooks/callbell` que valida secret, responde `200 {"status":"ok"}`, filtra
`message_created` inbound, normaliza teléfono y encola `whatsapp/message.received`;
idempotencia por `callbell_message_uuid`.
**Aceptación:** un mensaje real de WhatsApp llega al webhook, se encola en Inngest y se ve
un registro en `events_log` (`webhook_received`); contact + conversation se crean/actualizan.

## Qué se hizo
- **Scaffold** Next.js 14 (App Router) + TypeScript estricto + Tailwind. Build verde.
- **Clientes Supabase**: `lib/supabase/server.ts` (service-role, `import "server-only"`) y
  `lib/supabase/browser.ts` (anon). `lib/supabase/types.ts` con el `Database` a mano
  (incluye `Relationships: []` por tabla, requerido por postgrest-js).
- **`lib/env.ts`**: getters lazy (no leen env en import → build-safe), secretos server-only.
- **Inngest**: `lib/inngest/client.ts` (schema del evento `whatsapp/message.received`) y
  `app/api/inngest/route.ts` (`serve`).
- **Webhook** `app/api/webhooks/callbell/route.ts`: secret opcional en dev, `200 ok`
  siempre, filtra inbound, normaliza teléfono, encola. Helpers puros en
  `lib/callbell/types.ts` (`normalizePhone`, `isOutbound`, `isInboundMessageEvent`).
- **`inngest/functions/processMessage.ts`**: idempotencia por uuid → get-or-create
  contacto → get-or-create conversación (+ `last_inbound_at`) → guardar inbound →
  `events_log.webhook_received` (con payload crudo). Concurrency `limit:1` por teléfono.
- **Migración** `0002_storage_product_images.sql` (bucket público `product-images`).

## Criterio de aceptación
- [x] **Scaffold levanta y compila** — `npm run build` verde (type-check incluido);
  `npm run dev` arriba; rutas `/api/*` como dinámicas.
- [x] **Webhook responde 200 y filtra** — `GET` → 200 `{"status":"ok"}`; `POST` de evento
  no-inbound → 200 `{"status":"ok"}` sin encolar (verificado en dev).
- [x] **Lógica de parsing/normalización** — 15/15 tests unitarios de
  `normalizePhone`/`isOutbound`/`isInboundMessageEvent` (vía `node --experimental-strip-types`).
- [ ] **Mensaje real → encolado → `events_log.webhook_received`; contact+conversation
  creados** — pendiente: requiere `.env.local` con Supabase + Inngest, el Inngest dev
  server (`npx inngest-cli dev`) o deploy, y el webhook público apuntado en Callbell.
  Listo para ejecutarse en cuanto estén las credenciales.
- [ ] **Migración aplicada + bucket creado** — pendiente: aplicar `0001` y `0002` en el
  proyecto Supabase (`supabase db push` o SQL Editor).

## Desviaciones del PRD
- **Persistencia del inbound adelantada de S3 a S1** para anclar idempotencia con el
  `unique` de `messages.callbell_message_uuid`. Ver [ADR-0006](../decisions/0006-idempotencia-callbell-message-uuid.md).
- **Concurrencia keyed por teléfono** (no por `conversation_id`, que no existe al
  encolar). Ver [ADR-0007](../decisions/0007-concurrencia-loop-por-telefono.md).
- **Instalación en Windows**: `npm install --ignore-scripts` por el postinstall de
  `protobufjs` (lanza `node` vía `cmd.exe` desde Git Bash y no lo encuentra). Build y dev
  se corren desde **PowerShell** (donde `node` sí está en el PATH de procesos hijo).

## Decisiones nuevas
- [ADR-0005](../decisions/0005-validacion-y-parsing-webhook-callbell.md) — validación y
  parsing defensivo del webhook (+ log del payload crudo).
- [ADR-0006](../decisions/0006-idempotencia-callbell-message-uuid.md) — idempotencia.
- [ADR-0007](../decisions/0007-concurrencia-loop-por-telefono.md) — concurrencia por teléfono.

## Pendientes / deuda técnica
- Confirmar el **shape real** del payload de Callbell con el primer mensaje (el parser es
  defensivo a propósito; `events_log` guarda el body crudo para esto).
- Endurecer la **firma del webhook** (S7).
- Considerar `unique(phone)` en `contacts` (hoy get-or-create seguro por concurrency:1).
- Migrar la clave de concurrencia a `conversation_id`/`contact_uuid` si un contacto llega
  a tener varias conversaciones activas.
- Debounce de mensajes consecutivos (S3+).

## Archivos principales
- `app/api/webhooks/callbell/route.ts`, `app/api/inngest/route.ts`, `app/api/health/route.ts`
- `inngest/functions/processMessage.ts`
- `lib/inngest/client.ts`, `lib/callbell/types.ts`, `lib/env.ts`
- `lib/supabase/{server,browser,types}.ts`
- `supabase/migrations/0002_storage_product_images.sql`
- Scaffold: `app/{layout,page}.tsx`, `app/globals.css`, `package.json`, `tsconfig.json`,
  `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`, `.gitignore`
