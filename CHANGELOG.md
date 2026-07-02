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

### Changed
- **Dashboard más robusto**: el detalle de conversación muestra los **tags** que emitió la IA
  (`#ID...`, `#compra-contra-entrega`, etc.) como chips bajo cada mensaje; conversaciones
  borradas muestran una página amigable "ya no existe" (`not-found`) en vez de error; las
  conversaciones sin contacto se listan como "Sin contacto" en vez de en blanco.
  (`lib/dashboard/queries.ts`, `app/dashboard/conversations/[id]/page.tsx`,
  `app/dashboard/conversations/[id]/not-found.tsx`, `app/dashboard/ui.tsx`).
- **Imagen + texto en el MISMO mensaje**: cuando el agente recomienda un producto, el texto
  viaja como *caption* de la imagen en una sola llamada a Callbell (`sendImage` con `content.text`),
  en vez de un mensaje de texto + otro de imagen. Si hay varios `#ID`, la primera imagen lleva
  el texto y las demás van aparte; si el texto excede el límite de caption (~1024) o no hay
  imagen, van por separado. `sendImage` acepta `metadata`. (`lib/agent/processMessage.ts`,
  `lib/callbell/sender.ts`).
- **Formato de `#ID` a inline (ver `docs/09`, ADR-0014)**: el agente escribe el `#ID` del
  catálogo **inline** (`#ID7948237144230`) en vez de `#ID:SKU` en línea propia. `parseReply`
  (`lib/agent/tags.ts`) lo extrae con `/#ID\d+/g`, usa el **token completo como `sku`** y lo
  quita del texto que ve el cliente. El SKU real del catálogo de Vitasei es el valor de la
  columna `ID` del CSV. Prompt actualizado en `supabase/migrations/0005_update_agent_prompt.sql`
  (v2). Tests reescritos en `lib/agent/tags.test.ts`. Docs 03/04 actualizadas.

### Added
- **Reactivaciones por plantilla — 7 y 15 días (ver `docs/14`, ADR-0021)**: feature de crecimiento
  **apagable desde el dashboard** (OFF por defecto, aún sin aprobación). Cuando llega un cliente por
  primera vez (conversación nueva) y el feature está encendido, se **programan** dos envíos de
  **plantilla** de WhatsApp (día 7 y día 15) para reactivar a quien no compró, a bajo costo
  (≈ US$0,015 c/u). El cron existente (`/api/cron/retargets`, cada 5 min) también procesa las
  reactivaciones vencidas y envía la plantilla por **Callbell** (`sendTemplate` con `template_uuid`
  + `optin_contact`, único envío permitido fuera de la ventana de 24h). Se **cancelan si la persona
  compra** (se crea una orden); al enviar también se saltan si no hay plantilla, si el cliente
  escribió hace < 24h o si venció hace > 3 días. **Config editable desde el dashboard** (tabla
  `app_settings`, fila única): interruptor ON/OFF + **UUID de plantilla** día 7/15 (Server Action
  `updateReactivationSettings`). **Contabilización de costos**: `cost_usd` por envío + total en el
  dashboard (sección **Retargets → Reactivaciones**: interruptor, métricas por estado, costo y
  lista). Nueva migración **`0008_reactivations.sql`** (`app_settings` + `reactivations`, reusa el
  enum `retarget_status`). Lógica pura `reactivationPlan.ts` (`planReactivations`/
  `evaluateReactivation`, 7 tests); IO en `reactivation.ts` (schedule/cancel/`runDueReactivations`).
  Enganches en `processMessage.ts` (agenda al primer contacto; cancela al crear orden). Nuevas env
  opcionales `REACTIVATION_STAGE1_MS`/`REACTIVATION_STAGE2_MS` (solo delays; el ON/OFF y los UUID van
  en DB). **Requiere en Supabase** aplicar la migración; **en Callbell** crear/aprobar la(s)
  plantilla(s) y pegar su UUID en el dashboard.
- **Envío manual de mensajes + chat con scroll (ver `docs/13`, ADR-0020)**: el detalle de
  conversación deja de ser una página infinita — el hilo pasa a un panel de **altura fija con
  scroll propio** (`ChatPanel`, client component) con **auto-scroll** al último mensaje. Abajo, un
  **compositor** para enviarle un mensaje libre al cliente por WhatsApp con un botón **Enviar**
  (Enter envía · Shift+Enter salto de línea), usando la API de **Callbell** (`sendText`). Mutación
  vía Server Action **`sendManualMessage`** (service-role, protegida por el Basic Auth): guarda el
  outbound marcado `tags:["manual"]` (se distingue del bot con una etiqueta **Manual** en la
  burbuja) y loguea `manual_message_sent`. Avisa si pasaron **+24 h** del último inbound (WhatsApp
  puede exigir plantilla) pero intenta el envío igual; los errores de Callbell se muestran en la UI.
  El mensaje manual **no** entra al contexto de la IA (`previous_response_id`). Sin cambios en
  Supabase ni envs nuevas (usa `CALLBELL_API_KEY`). Archivos: `app/dashboard/conversations/[id]/ChatPanel.tsx`,
  `app/dashboard/conversations/[id]/page.tsx`, `app/dashboard/actions.ts` (`sendManualMessage`).
- **Órdenes editables + reportes de ventas (ver `docs/12`, ADR-0019)**: continuación del Dashboard
  (Sprint 6). Nueva sección **Órdenes** (`/dashboard/orders`, nav) con lista filtrable por estado
  (todas/pendientes/con logística/confirmadas/canceladas: contacto, estado, método, ítems, ciudad,
  fecha y total) y **detalle editable** (`/dashboard/orders/[id]`): un editor de guardado único
  (`OrderEditor`, client component) corrige estado, método, datos de envío, **ítems**
  (agregar/quitar/editar nombre/SKU/cantidad/precio) y total (manual o "recalcular desde los
  ítems"). Mutación vía Server Action **`saveOrder`** (service-role, protegida por el Basic Auth;
  reemplaza los ítems delete+insert; loguea `order_edited`; revalida rutas). Nueva sección
  **Reportes** (`/dashboard/reports`, nav) con lógica pura **`summarizeOrders`**
  (`lib/dashboard/report.ts`): ventas **confirmadas** (`confirmed`), **generadas** (todo
  menos canceladas), **pipeline** (`pending_handoff`+`handed_off`) y canceladas; cortes por estado,
  método, ventanas (hoy/7/30 días) y por día (últimos 14, zona `America/Bogota`); botón **copiar
  resumen** para el equipo. **Conversión** (`summarizeConversion`/`getConversionReport`): tabla por
  periodo (hoy/7/30 días/total) y gráfico por día de **conversaciones vs. transacciones** y
  **% de conversión** (conversaciones con orden no cancelada ÷ conversaciones). Se corrige `getKpis`
  para **excluir canceladas** de "Ventas generadas". Lógica pura con 15 tests.
  El detalle de conversación enlaza a la orden. **Reutiliza** `orders`/`order_items` (sin migración;
  el service-role omite RLS → nada que aplicar en Supabase). Archivos: `lib/dashboard/report.ts`
  (+test), `lib/dashboard/queries.ts` (`getOrders`/`getOrder`/`getSalesReport`), `lib/dashboard/format.ts`
  (`formatDate`/`formatDayKeyShort`), `app/dashboard/actions.ts` (`saveOrder`),
  `app/dashboard/orders/*` (lista, detalle, `OrderEditor`, `types`, `not-found`),
  `app/dashboard/reports/*` (página + `CopySummaryButton`), `app/dashboard/ui.tsx`
  (`OrderStatusPill`/`OrderList`), `app/dashboard/layout.tsx` (nav),
  `app/dashboard/conversations/[id]/page.tsx` (enlace a la orden).
- **Modo manual — pausar la IA en una conversación (ver `docs/11`, ADR-0018)**: un agente
  humano puede tomar una conversación desde el tablero (botón **Pasar a manual** / **Reactivar
  IA** en el detalle + píldora **Manual** en detalle y listas). Con la IA en pausa
  (`conversations.ai_paused`, migración `0007_conversation_manual.sql`) el bot **no responde**
  (`runDebouncedReply` salta y loguea `reply_skipped` reason `manual-mode`) y **no agenda ni
  envía retargets** (se cancelan los pendientes; `evaluateRetarget` revalida con `aiPaused`),
  pero **los mensajes del cliente se siguen guardando y viendo** (la ingesta no depende del
  estado). Mutación vía Server Action `setConversationManual` (service-role, protegida por el
  Basic Auth del dashboard; revalida rutas). Flag ortogonal a `status`; no toca el handoff
  automático ni requiere env nuevas. Eventos `manual_on`/`manual_off`. Archivos:
  `app/dashboard/actions.ts`, `app/dashboard/ui.tsx` (`ManualPill`/`ManualToggle`),
  `app/dashboard/conversations/[id]/page.tsx`, `lib/agent/processMessage.ts`,
  `lib/agent/retargetPlan.ts`, `lib/agent/retarget.ts`, `lib/dashboard/queries.ts`.
- **Retargeting — seguimientos automáticos 1h/8h (ver `docs/10`, ADR-0017)**: cuando el bot
  responde y el cliente deja de responder, se agendan dos seguimientos (~1h y ~8h). Un
  **Vercel Cron** (`vercel.json` → `/api/cron/retargets`, cada 5 min) toma los vencidos y, si
  la conversación sigue activa y el cliente no respondió, **genera un mensaje dinámico** con
  Responses encadenando `previous_response_id` (contexto completo) más una **instrucción interna
  de seguimiento que NO revela que es automático**. Reusa el pipeline: parser de tags, gate
  anti-alucinación de `#ID` y envío por Callbell (texto + imágenes). Guardas anti-obsolescencia:
  ancla en `last_inbound_at`, claim atómico (`scheduled → processing`) e índice único parcial de
  "vivos". Kill switch y delays por env (`RETARGET_ENABLED`, `RETARGET_STAGE1_MS`,
  `RETARGET_STAGE2_MS`, `CRON_SECRET`). Nueva tabla `retargets` + enum `retarget_status`
  (`supabase/migrations/0006_retargets.sql`). Lógica pura testeada en `lib/agent/retargetPlan.ts`
  (`planRetargets`/`evaluateRetarget`/`buildRetargetInstruction`); IO en `lib/agent/retarget.ts`.
  Enganches en `lib/agent/processMessage.ts` (agenda tras responder sin handoff; cancela al
  recibir inbound). Sin servicios extra (consistente con ADR-0012). Eventos `retarget_sent`/
  `retarget_skipped`/`retarget_cancelled`/`retarget_error`.
- **Dashboard — sección Retargets** (`/dashboard/retargets`, nav): barra de conteos por estado
  (programados/enviados/cancelados/saltados/fallidos) + lista de seguimientos recientes con
  píldora de estado y etapa (~1h/~8h), enlazando a la conversación. Consultas
  `getRetargetStats`/`getRecentRetargets` (`lib/dashboard/queries.ts`), componentes
  `RetargetStatsBar`/`RetargetList`/`RetargetStatusPill`/`StagePill` (`app/dashboard/ui.tsx`).
- **Ajustes v1.1 — datos reales (ver `docs/09`)**:
  - **Filtro por número de la IA** en el webhook: la cuenta de Callbell tiene varios números y
    un solo webhook; solo se procesan los inbound al número de la IA
    (`AGENT_WHATSAPP_NUMBER=573332877350`), por número destino o, si no viene, por
    `channel_uuid`. `classifyInbox`/`getDestinationNumber`/`getChannelUuid` en
    `lib/callbell/types.ts`; logs `inbox_rejected`/`inbox_indeterminate`. Nueva env
    `AGENT_WHATSAPP_NUMBER`. Tests en `lib/callbell/types.test.ts`. **ADR-0015**.
  - **Carga del catálogo real desde CSV**: `scripts/import-catalog-csv.mjs`
    (`npm run import:catalog`, sin dependencias) mapea `vitasei-productos-actualizado.csv`
    (16 productos) → `products` y hace POST a `/api/catalog/load` (reusa el pipeline S2:
    vector store + imagen a Storage + upsert por `sku`). Modo `--dry` para previsualizar.
    **ADR-0016**.
- **Dashboard v1 (Sprint 6, parcial)**: panel interno server-rendered en `/dashboard`
  (lee con el cliente service-role; nunca expone la llave). Vistas: **Resumen** con KPIs
  (ventas generadas = suma de `orders.total`, transacciones = # órdenes, y **costo de tokens
  estimado** — placeholder de precio, tokens reales) + lista de conversaciones recientes;
  **detalle de conversación** con hilo de mensajes estilo WhatsApp + panel de contacto/orden.
  Sección dedicada **Conversaciones** (`/dashboard/conversations`, lista completa) con enlace
  en el nav, además del resumen. `lib/dashboard/queries.ts` (consultas) y `format.ts` (formateo es-CO/COP). Estados
  `loading`/`error`, reglas Pro Max (contraste, focus rings, touch targets, skeletons).
  Gate de acceso con **Basic Auth** (`middleware.ts`, `DASHBOARD_USER`/`DASHBOARD_PASSWORD`);
  Supabase Auth queda para más adelante. Pendiente de S6: órdenes, productos, métricas,
  realtime.
- **Captura de uso de tokens**: `generateReply` devuelve `usage` (input/output/total) y se
  loguea en `events_log.reply_generated` — alimenta el KPI de costo del dashboard.
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
- **Migración** `0003_seed_agent_config.sql`: siembra el `agent_config` activo con el system
  prompt v1 (docs/03 §5). Sin esta fila el bot no genera respuesta. `vector_store_id` queda
  NULL a propósito: lo rellena el cargador de catálogo. Idempotente. Aplicar **antes** de cargar
  el catálogo.
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

### Changed
- **Debounce de respuestas (agrupar mensajes seguidos).** El webhook hace ingesta síncrona
  y agenda la respuesta en background con `waitUntil` (`@vercel/functions`): espera
  `REPLY_DEBOUNCE_MS` (default 12s) y solo responde la tarea del ÚLTIMO mensaje, juntando los
  inbound pendientes en una sola llamada a Responses. Resuelve la serialización sin lock y
  mejora la UX (no contesta a cada mensajito). `processInboundMessage` se divide en
  `ingestInboundMessage` (fase 1) + `runDebouncedReply`/`generateAndSend` (fase 2). Nueva
  columna `conversations.last_inbound_message_uuid` (migración `0004`) y env
  `REPLY_DEBOUNCE_MS`. Ver **ADR-0013**.
- **Refactor a procesamiento inline (fuera Inngest).** El webhook
  `POST /api/webhooks/callbell` ahora procesa el mensaje **dentro del request**
  (`lib/agent/processMessage.ts`: `processInboundMessage`) y responde 200 — sin cola async.
  Se conserva íntegra la lógica de S1/S3/S4/S5 (idempotencia, generar, gate, envío, orden,
  handoff); solo se elimina el envoltorio `step.run` y el `inngest.send`. El vector store
  del catálogo se toma de `agent_config.vector_store_id` o, si no está, de
  `OPENAI_VECTOR_STORE_ID` (store creado y administrado directo en OpenAI). Ver **ADR-0012**.
- **Migración `0003`**: comentario actualizado — `vector_store_id` viene de env, no del loader.

### Removed
- **Inngest** como dependencia y servicio: se borran `lib/inngest/client.ts`,
  `app/api/inngest/route.ts` e `inngest/functions/processMessage.ts`; se quita `inngest` de
  `package.json` y las envs `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY`. Servicios externos:
  Supabase + OpenAI + Callbell. **ADR-0007** queda reemplazado por **ADR-0012** (sin la cola
  no hay serialización por teléfono; deuda conocida documentada).

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
