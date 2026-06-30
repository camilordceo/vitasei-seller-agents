# CLAUDE.md — Convenciones para Claude Code

Lee `docs/00-master-prd.md` y `docs/07-sprints.md` antes de empezar. Ejecuta los sprints en
orden y no avances sin cumplir el criterio de aceptación de cada uno.

## Stack
Next.js 14 (App Router) · TypeScript estricto · Tailwind · Supabase (Postgres + Storage + Auth) ·
Inngest (cola async) · OpenAI Responses API + file_search · Callbell (WhatsApp).

## Principios
- **Webhook responde rápido** (200 `{"status":"ok"}`) y delega a Inngest. Nada de LLM inline.
- **Supabase = fuente de verdad** del historial. `previous_response_id` es conveniencia, no estado canónico.
- **Gate anti-alucinación siempre:** ningún `#ID` se envía si el SKU no existe en `products`.
- **Tags nunca son visibles al cliente:** se quitan del texto antes de enviar.
- **Service role solo en server.** Nunca exponer `SUPABASE_SERVICE_ROLE_KEY` al cliente.
- **Teléfonos** en E.164 sin `+` (`573XXXXXXXXX`).
- **Idempotencia** por `callbell_message_uuid`.

## Flujo por mensaje (Inngest)
Es una **IA simple**: **una sola llamada** a Responses por mensaje. No hay loop de tools ni
razonamiento iterativo (`file_search` es hosted: OpenAI busca y responde en esa misma llamada).
Por cada inbound:
**generar** (1× `responses.create`) → **preparar** (quitar tags del texto + gate: validar que
cada `#ID` exista en `products`) → **enviar** (texto + imágenes válidas por Callbell) →
**guardar/loguear** en `messages` y `events_log`.

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
  agent/           # parser de tags + gate (#ID existe en products)
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
