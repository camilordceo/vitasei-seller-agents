# Sprint 03 — Generación de respuesta (Responses + tags)

- **Fecha / sesión:** 2026-06-30
- **Estado:** En progreso — código y verificación local listos; aceptación bloqueada por credenciales

## Objetivo
Por cada mensaje del cliente: generar la respuesta con **una sola** llamada a Responses
(`file_search` + system prompt de `agent_config`), parsear los tags y guardar el outbound
(`cleanText` + tags) encadenando `openai_previous_response_id`. Sin enviar a Callbell (S4).
**Aceptación:** mensaje del cliente → respuesta generada en una llamada y parseada; `cleanText`
y tags quedan en `messages` (outbound).

## Qué se hizo
- **Parser de tags** (`lib/agent/tags.ts`, puro): por línea reconoce `#ID:<sku>`, `#addi`,
  `#compra-contra-entrega`, `#orden-lista`, `#humano`; devuelve `skus` (dedup), flags, `raw`
  y `cleanText` (texto sin las líneas de tags, colapsando blancos). 7 tests.
- **Generación** (`lib/openai/responses.ts`): `generateReply` = **una** `responses.create`
  con `instructions` (system prompt), `input` (turno actual), `previous_response_id`, y
  `tools: [file_search]` si hay `vector_store_id`. Devuelve `{ responseId, text }`
  (`output_text`).
- **`processMessage` (S3)**: tras guardar el inbound → cargar estado de conversación +
  `agent_config` activo; si la conversación no está `active` o no hay config, no genera (log
  `reply_skipped`). Si genera: parsea, guarda el outbound (`messages`), actualiza
  `openai_previous_response_id` y loguea `reply_generated` con `skus`/tags.

## Criterio de aceptación
- [x] **Verificación local** — `npm run typecheck` ✓, `npm test` (18/18, 7 del parser) ✓,
  `npm run build` ✓.
- [ ] **Respuesta generada y parseada en `messages`** — pendiente: requiere `OPENAI_API_KEY`,
  Supabase aprovisionado y un `agent_config` activo (system prompt + `vector_store_id` del S2).
  Validación: mandar un inbound → aparece un `messages` outbound con `content` = `cleanText`,
  `tags` con los emitidos, `openai_response_id` seteado, y un `events_log.reply_generated`.

> La lógica de parseo (lo que el cliente NO debe ver) queda verificada con Vitest; la llamada
> a Responses se valida end-to-end cuando haya credenciales + `agent_config`.

## Desviaciones del PRD
- **Framing simplificado** (a pedido del dueño): se quita el lenguaje de "loop de razonamiento".
  Es una IA simple de **una llamada** por mensaje. Renombrados `CLAUDE.md`, `docs/01` y el
  título del Sprint 3 en `docs/07`. Ver ADR-0010.
- `input` usa solo el turno actual + `previous_response_id` (encadenado). El fallback de
  reconstruir historial desde Supabase queda para hardening (S7).

## Decisiones nuevas
- [ADR-0010](../decisions/0010-generacion-de-un-solo-paso-sin-loop-de-tools.md) — generación
  de un solo paso (sin loop de tools).

## Pendientes / deuda técnica
- Aceptación end-to-end con credenciales + `agent_config` activo (seed del system prompt v1).
- Fallback de `input` con últimos N mensajes si no hay `previous_response_id` (S7).
- Debounce opcional de mensajes consecutivos (doc 01 §5) — backlog.

## Archivos principales
- `lib/agent/tags.ts`, `lib/agent/tags.test.ts`
- `lib/openai/responses.ts`
- `inngest/functions/processMessage.ts`
- `CLAUDE.md`, `docs/01-arquitectura.md`, `docs/07-sprints.md` (framing)
- `docs/decisions/0010-*.md`
