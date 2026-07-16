# CLAUDE.md — Convenciones para Claude Code

Lee `docs/00-master-prd.md` y `docs/07-sprints.md` antes de empezar. Ejecuta los sprints en
orden y no avances sin cumplir el criterio de aceptación de cada uno.

## Stack
Next.js 14 (App Router) · TypeScript estricto · Tailwind · Supabase (Postgres + Storage + Auth) ·
OpenAI Responses API + file_search · **Callbell y Kapso** (WhatsApp).

## Principios
- **Webhook sin cola async:** ingesta síncrona (guarda inbound + marca "último mensaje") →
  responde 200 → **respuesta con debounce en background** (`waitUntil`). Ver ADR-0012/0013.
- **Debounce:** se espera `REPLY_DEBOUNCE_MS` (default 12s) y solo responde la tarea del
  ÚLTIMO mensaje, juntando los mensajes seguidos en una sola llamada. Nada de servicios extra.
- **Supabase = fuente de verdad** del historial. `previous_response_id` es conveniencia, no estado canónico.
- **Un cerebro, dos transportes:** el envío pasa SIEMPRE por el puerto `MessagingProvider`
  (`lib/messaging/`); `agents.provider` elige Callbell o Kapso. Nunca llames al sender de un
  proveedor desde el flujo: usa `providerForAgent(agent)`. Ver ADR-0056.
- **Gate anti-alucinación siempre:** ningún `#ID` se envía si el SKU no existe en `products`.
- **Tags nunca son visibles al cliente:** se quitan del texto antes de enviar.
- **Service role solo en server.** Nunca exponer `SUPABASE_SERVICE_ROLE_KEY` al cliente.
- **Teléfonos** en E.164 sin `+` (`573XXXXXXXXX`).
- **Idempotencia** por `callbell_message_uuid`.

## Flujo por mensaje (ingesta + debounce)
Es una **IA simple**: **una sola llamada** a Responses por (ráfaga de) mensajes. No hay loop
de tools (`file_search` es hosted: OpenAI busca y responde en esa misma llamada). En
`lib/agent/processMessage.ts`: **ingesta** (`ingestInboundMessage`, síncrona: guarda inbound,
marca `last_inbound_message_uuid`) → 200 → **respuesta** en background
(`runDebouncedReply` vía `waitUntil`): espera el debounce, y si sigue siendo el último
mensaje, junta los pendientes y **genera** (1× `responses.create`) → **prepara** (quitar tags
+ gate: `#ID` debe existir en `products`) → **envía** (texto + imágenes por Callbell) →
**guarda/loguea** en `messages` y `events_log`.

## Estructura objetivo
```
app/
  api/webhooks/callbell/route.ts   # valida + procesa inline + 200
  api/webhooks/kapso/route.ts      # ídem para Kapso → MISMO ingest + debounce
  (dashboard)/...
lib/
  supabase/        # clientes browser + server(service-role)
  openai/          # responses + vector store + carga catálogo
  messaging/       # PUERTO (MessagingProvider) + adaptadores + media/phone comunes
  callbell/        # sender (sendText, sendImage), tipos webhook
  kapso/           # sender (forma de Meta), webhook v2, firma, plantillas, routing
  agent/           # processMessage (flujo inline) + parser de tags + gate
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

## Registro y documentación (OBLIGATORIO — ver docs/08)
Mantén el rastro como parte del trabajo, no como un extra:
- **Commits**: usa Conventional Commits (`feat(scope): ...`, `fix`, `docs`, `chore`, `refactor`, `test`).
- **CHANGELOG.md**: agrega lo que construyes bajo `## [Unreleased]` mientras trabajas.
- **ADR**: por cualquier decisión con trade-off (librería, patrón, modelo, esquema), crea
  `docs/decisions/NNNN-titulo.md` desde `0000-template.md`. Los ADR son inmutables.
- **Sprint log**: al cerrar un sprint, escribe `docs/sprint-log/sprint-NN.md` desde `_template.md`.

### Definition of Done de un sprint (no avanzar sin esto)
1. Cumple el criterio de aceptación de `docs/07-sprints.md`.
2. `CHANGELOG.md` actualizado y versión movida de `[Unreleased]` a `[0.X.0] - fecha — Sprint N`.
3. `docs/sprint-log/sprint-NN.md` escrito.
4. ADR(s) creado(s) si hubo decisiones no triviales.
5. Commits en Conventional Commits y push hecho.
