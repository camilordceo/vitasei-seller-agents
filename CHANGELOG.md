# Changelog

Todos los cambios notables de este proyecto se documentan aquí.
Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) · Versionado: [SemVer](https://semver.org/lang/es/).

## [Unreleased]

> Sprints 0–5 entregados a nivel de **código y verificación local** (typecheck + tests +
> build). El cierre formal (mover a versión) queda pendiente del aprovisionamiento de
> servicios externos: pings OK a Supabase/OpenAI/Callbell (S0), mensaje real de WhatsApp
> (S1), carga de un catálogo de prueba (S2), una respuesta generada contra OpenAI (S3),
> un envío real por Callbell con gate de `#ID` (S4) y una compra completa con orden +
> handoff (S5). Ver `docs/sprint-log/sprint-00.md` … `sprint-05.md`.

### Added
- **Scaffold Next.js 14 + TypeScript estricto + Tailwind** (App Router): `app/layout.tsx`,
  `app/page.tsx`, `app/globals.css`, configs (`tsconfig`, `next.config.mjs`, `tailwind`,
  `postcss`, `.eslintrc`). Dependencias reales en `package.json`.
- **Clientes Supabase**: `lib/supabase/server.ts` (service-role, solo server) y
  `lib/supabase/browser.ts` (anon). Tipos de DB a mano en `lib/supabase/types.ts`.
- **Acceso a env centralizado** (`lib/env.ts`) con getters lazy (build-safe) y separación
  server-only. `.env.local` creado a partir de `.env.example`.
- **Inngest**: cliente con schema de eventos (`lib/inngest/client.ts`) y endpoint
  `app/api/inngest/route.ts`.
- **Webhook** `POST /api/webhooks/callbell`: valida secret (opcional en dev), responde
  `200 {"status":"ok"}`, filtra `message_created` inbound, normaliza teléfono (E.164 sin
  `+`) y encola `whatsapp/message.received`. Helpers en `lib/callbell/types.ts`.
- **Inngest function `processMessage`** (inicio del loop SENSE+LOG): idempotencia por
  `callbell_message_uuid`, get-or-create de contacto y conversación, `last_inbound_at`,
  persistencia del inbound y `events_log.webhook_received` con payload crudo.
- **Health check** `GET /api/health`: verifica conectividad a Supabase, OpenAI y Callbell
  (soporta la aceptación del Sprint 0).
- **Migración** `0002_storage_product_images.sql`: bucket público `product-images`.
- **ADRs** 0005 (validación/parsing del webhook), 0006 (idempotencia), 0007 (concurrencia
  por teléfono).
- **Infra (S0)**: repo en GitHub `camilordceo/vitasei-seller-agents` (rama por defecto
  `main`); proyecto Vercel `ai-seller-vitasei` (team `rentmies`) enlazado con preset Next.js
  e integración Git conectada. Falta el primer deploy (depende de las env vars).
- **Carga de catálogo (S2)**: `POST /api/catalog/load` (route protegida por
  `CATALOG_ADMIN_SECRET` opcional). Pipeline: documento markdown por producto → vector store
  OpenAI (`uploadAndPoll`, espera `completed`, guarda `vector_store_file_id`); imagen → bucket
  `product-images` (re-hospedaje best-effort desde URL/base64); upsert por `sku` en `products`;
  persistencia de `vector_store_id` en `agent_config` activo; trazabilidad en `catalog_imports`.
  - `lib/openai/`: `client.ts` (cliente lazy), `catalog.ts` (lógica **pura**: validación
    SKU↔catálogo, generación de documento, rutas de imagen), `vectorStore.ts` y
    `catalogLoader.ts` (orquestación). `lib/supabase/storage.ts` (subida a Storage).
- **Tests**: Vitest (`vitest.config.ts`, scripts `test`/`test:watch`). 11 tests de la lógica
  pura de catálogo en `lib/openai/catalog.test.ts`.
- **ADRs** 0008 (Vitest como framework de tests) y 0009 (carga de catálogo: route + archivo
  por producto).
- **Generación de respuesta (S3)**: `processMessage` ahora genera la respuesta con **una sola**
  llamada `responses.create` (`lib/openai/responses.ts`, `file_search` + `agent_config` activo),
  parsea los tags (`lib/agent/tags.ts`: `#ID:`, `#addi`, `#compra-contra-entrega`,
  `#orden-lista`, `#humano`) y guarda el outbound (`cleanText` + tags) encadenando
  `openai_previous_response_id`. No genera si la conversación no está `active` o no hay
  `agent_config`. El envío por Callbell + gate de `#ID` es el S4. 7 tests del parser.
- **ADR 0010**: generación de un solo paso (sin loop de tools).
- **Envío por Callbell + gate (S4)**: sender `lib/callbell/sender.ts` (`sendText`, `sendImage`
  sobre `POST /v1/messages/send`, guarda `callbell_message_uuid`). Gate puro
  `lib/agent/gate.ts`: descarta `#ID` cuyo SKU no exista en `products` (log `gate_blocked`) y
  valida la ventana de 24h (`out_of_window`). `processMessage` (S4): lookup de SKUs en
  `products`, envía `cleanText` y, por cada `#ID` válido, la imagen; persiste mensajes
  `image` y loguea `text_sent`/`image_sent`/`image_missing`. Cada envío va en su propio
  step de Inngest (memoizado → no reenvía en reintentos). 7 tests del gate.
- **Flujos de compra + handoff (S5)**: en `processMessage`, `#addi`/`#compra-contra-entrega`
  fijan `fulfillment_method` (y `#addi` envía `ADDI_LINK` si está); `#orden-lista` extrae la
  orden con una **completion estructurada** (`lib/openai/extractOrder.ts`, `chat.completions`
  + `json_schema`) desde el transcript y crea `orders` + `order_items`; `#orden-lista`/`#humano`
  hacen **handoff** (send con `team_uuid` + `bot_end`, `status = handed_off`, `assigned_team_uuid`).
  Lógica pura de orden en `lib/agent/order.ts` (transcript, total, normalización) con 7 tests.
  Sender extendido con `SendOptions` (`teamUuid`/`botStatus`). Nueva env opcional `ADDI_LINK`.
- **ADR 0011**: extracción de la orden con completion estructurada (solo al cerrar, no por mensaje).
- **Framing simplificado**: se elimina el lenguaje de "loop de razonamiento". Es una IA simple
  de **una llamada** por mensaje (`file_search` es hosted). Ajustados `CLAUDE.md`,
  `docs/01-arquitectura.md` y `docs/07-sprints.md` (Sprint 3 → "Generación de respuesta").

### Notes
- Instalación en Windows con `npm install --ignore-scripts` por un postinstall transitivo
  (`protobufjs`) que falla al lanzar `node` vía `cmd.exe` desde Git Bash. El dev server y
  el build se corren desde PowerShell. Detalle en `docs/sprint-log/sprint-01.md`.

## [0.1.0] - 2026-06-29 — Diseño y scaffold
### Added
- Scaffold del repo, `README`, `CLAUDE.md`.
- PRDs en `/docs` (00–07): master, arquitectura, schema, agente+tags, Callbell, OpenAI, dashboard, sprints.
- Migración inicial de Supabase `0001_init.sql`.
- Framework de registro: ADRs (0001–0004), plantilla de sprint log, este changelog.
