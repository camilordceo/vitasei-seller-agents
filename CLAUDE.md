# CLAUDE.md — Convenciones para Claude Code

Lee `docs/00-master-prd.md` y `docs/07-sprints.md` antes de empezar. Ejecuta los sprints en
orden y no avances sin cumplir el criterio de aceptación de cada uno.

## Stack
Next.js 14 (App Router) · TypeScript estricto · Tailwind · Supabase (Postgres + Storage + Auth) ·
Inngest (loop async) · OpenAI Responses API + file_search · Callbell (WhatsApp).

## Principios
- **Webhook responde rápido** (200 `{"status":"ok"}`) y delega a Inngest. Nada de LLM inline.
- **Supabase = fuente de verdad** del historial. `previous_response_id` es conveniencia, no estado canónico.
- **Gate anti-alucinación siempre:** ningún `#ID` se envía si el SKU no existe en `products`.
- **Tags nunca son visibles al cliente:** se quitan del texto antes de enviar.
- **Service role solo en server.** Nunca exponer `SUPABASE_SERVICE_ROLE_KEY` al cliente.
- **Teléfonos** en E.164 sin `+` (`573XXXXXXXXX`).
- **Idempotencia** por `callbell_message_uuid`.

## Patrón del loop (Inngest)
`SENSE → REASON → PROPOSE → GATE → ACT → LOG`. Cada paso loguea en `events_log`.

## Estructura objetivo
```
app/
  api/webhooks/callbell/route.ts
  api/inngest/route.ts
  (dashboard)/...
lib/
  supabase/        # clientes browser + server(service-role)
  openai/          # responses + vector store + carga catálogo
  callbell/        # sender (sendText, sendImage), tipos webhook
  agent/           # parser de tags, gate, loop steps
inngest/
  functions/processMessage.ts
supabase/migrations/0001_init.sql
docs/
```

## UI (cuando toque dashboard)
Usar reglas "Pro Max": contraste 4.5:1, touch targets 44px, focus rings, skeletons/loading,
mobile-first, sin emojis como íconos (SVG), 4/8px spacing, base 16px / line-height 1.5.
Styling neutral; tokens de marca Vitasei como placeholder (no usar marca Rentmies).

## No hacer en v1
Integración Addi API, templates fuera de 24h, multicanal, confirmación de venta/logística
(eso es de otro equipo). Ver backlog en `docs/07-sprints.md`.
