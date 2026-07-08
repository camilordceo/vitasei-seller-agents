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
- **Videos por palabra clave · caption + edición** (`docs/20`, migración `0017_videos_caption.sql`):
  cada video ahora admite un **caption** opcional (ej. "Mira acá los beneficios del colágeno") que se
  envía como **mensaje de texto justo antes del video** (Callbell no admite caption incrustado en
  video, solo en imagen; best-effort). La sección **Videos** permite **editar** palabra, URL y caption
  con guardado (`updateVideo`). Las consultas son resilientes a la ventana de migración (si falta la
  columna `caption`, degradan sin romper). Requiere aplicar `0017_videos_caption.sql`.
  (`supabase/migrations/0017_videos_caption.sql`, `lib/agent/videos.ts`, `lib/dashboard/queries.ts`,
  `app/dashboard/actions.ts`, `app/dashboard/videos/VideosManager.tsx`, `lib/supabase/types.ts`).
- **Videos por palabra clave** (ADR-0038, `docs/20`): nueva sección **Videos** en el dashboard
  (`/dashboard/videos`) para configurar pares **palabra → video**. Cuando la **respuesta del bot**
  menciona una palabra (ej. "magnesio"), el backend envía el video correspondiente por Callbell
  **justo después** del mensaje, **una sola vez por conversación** (idempotente por `media_url`). El
  match es **case- y acento-insensible**, por **palabra completa** y **preserva la ñ** (lógica pura
  `lib/agent/videoMatch.ts`, 9 tests). Envío con `sendVideo` (`type: "document"` + `content.url`, como
  documenta Callbell para video; requiere WhatsApp Business API oficial). Best-effort: nunca rompe la
  respuesta; se traza con `keyword_video_sent`/`keyword_video_failed` (no altera el costo de IA).
  Requiere aplicar la migración `0016_videos.sql`. (`supabase/migrations/0016_videos.sql`,
  `lib/supabase/types.ts`, `lib/callbell/sender.ts`, `lib/agent/videoMatch.ts`, `lib/agent/videos.ts`,
  `lib/agent/processMessage.ts`, `lib/dashboard/queries.ts`, `app/dashboard/actions.ts`,
  `app/dashboard/videos/page.tsx`, `app/dashboard/videos/VideosManager.tsx`, `app/dashboard/layout.tsx`).
- **Carritos abandonados de Hotmart** (ADR-0035): nuevo webhook `POST /api/webhooks/hotmart` que
  recibe eventos de carrito abandonado (`PURCHASE_OUT_OF_SHOPPING_CART`) y **envía automáticamente
  una plantilla de WhatsApp** vía Callbell para recuperar la venta. El flujo: Hotmart detecta
  abandono → webhook extrae el teléfono del comprador (E.164 sin '+') → get-or-create de contacto
  y conversación (con `source: "hotmart"`) → envía la plantilla configurada → guarda el mensaje
  y abre la conversación para que el agente de IA continúe si el cliente responde. **Idempotente**
  por `hotmart_event_id` (no reprocesa ni reenvía). Nueva tabla `hotmart_events` (trazabilidad +
  dedup), nueva columna `conversations.source` (`whatsapp`/`hotmart`/`manual`/`other`). Envs:
  `HOTMART_WEBHOOK_SECRET` (validación), `HOTMART_ABANDONED_CART_TEMPLATE_UUID` (plantilla
  obligatoria), `HOTMART_AGENT_ID` (opcional, fallback al primer agente activo). Requiere aplicar
  la migración `0013_hotmart_events.sql` y **crear/aprobar la plantilla en Callbell/WhatsApp**.
  Eventos: `hotmart_webhook_received`, `hotmart_cart_abandoned`, `hotmart_template_sent`/`_failed`.
  (`app/api/webhooks/hotmart/route.ts`, `lib/hotmart/types.ts`, `lib/hotmart/processEvent.ts`,
  `lib/env.ts`, `lib/supabase/types.ts`, `docs/17-hotmart-carritos.md`).
- **Etiquetas de conversaciones** (ADR-0036): sistema de **labels personalizables** para clasificar
  conversaciones ("No interesado", "Sin presupuesto", "Llamar después", "Cliente VIP", etc.). Cada
  etiqueta tiene nombre y color (badge visual). Se gestionan desde el **detalle de conversación**:
  ver badges de etiquetas actuales, agregar desde dropdown, crear nuevas con selector de color, y
  quitar con un click. Nuevas tablas `labels` (catálogo con seed de etiquetas por defecto) y
  `conversation_labels` (relación N:M). Las etiquetas pueden ser **globales** (`agent_id = NULL`)
  o **por agente** (solo aparecen para conversaciones de ese agente). Server Actions:
  `getLabels`, `getConversationLabels`, `createLabel`, `addLabelToConversation`,
  `removeLabelFromConversation`, `deleteLabel`. Requiere aplicar la migración `0014_labels.sql`.
  Eventos: `label_created`, `label_added`, `label_removed`, `label_deleted`.
  (`supabase/migrations/0014_labels.sql`, `app/dashboard/actions.ts`,
  `app/dashboard/conversations/[id]/ConversationLabels.tsx`, `lib/dashboard/queries.ts`,
  `docs/18-etiquetas-conversaciones.md`).
- **Solicitudes de llamada por `#llamada`** (ADR-0034): nuevo tag de flujo. Cuando el agente lo
  emite, el backend crea una **solicitud de llamada** (`call_requests`, estados pendiente/llamada/
  descartada) y **avisa al dueño** por WhatsApp (`CALLS_NOTIFY_PHONE`, default `573103565492`, por el
  mismo Callbell del agente). Es **independiente**: no fuerza handoff ni apaga el bot; idempotente
  (una sola solicitud viva por conversación) y best-effort (nunca rompe la respuesta). Se registra con
  `call_requested` / `call_request_notification_sent` (no altera el costo de IA). Sección nueva
  **Llamadas** en el dashboard (`/dashboard/calls`) con filtros y acciones "Marcar llamado / Descartar
  / Reabrir". Requiere aplicar la migración `0012_call_requests.sql` y **añadir la instrucción del tag
  al prompt del agente** en el dashboard. (`supabase/migrations/0012_call_requests.sql`,
  `lib/agent/tags.ts`, `lib/agent/callRequest.ts`, `lib/agent/processMessage.ts`,
  `app/dashboard/calls/page.tsx`, `app/dashboard/ui.tsx`, `app/dashboard/actions.ts`,
  `lib/dashboard/queries.ts`).
- **Reorden de la página Retargets**: **Reactivaciones** (plantillas 7/15 días) pasa arriba y
  **Retargets** (seguimientos 1h/8h) abajo, con la lista de números contactados primero.
  (`app/dashboard/retargets/page.tsx`).
- **Horario por agente con franjas horarias por día** (ADR-0033): el horario pasa de una ventana
  diaria única + días completos a **rangos de horas por día de semana** (ej. lunes 20:00–23:00, o
  &ldquo;Todo el día&rdquo; los fines de semana) — para no perder ventas en noches y fines de
  semana. `AgentSchedule` es ahora `{ days, holidays }` (7 listas de franjas). Editor por día en el
  agente (`WeekScheduleEditor`) con &ldquo;+ Franja / Todo el día / Copiar a todos / Apagar&rdquo;.
  **Compatible hacia atrás**: `parseAgentSchedule` migra al vuelo los horarios legacy
  (`window` + `fullWeekdays`) sin tocar la base de datos. (`lib/agent/schedule.ts`,
  `app/dashboard/agents/WeekScheduleEditor.tsx`, `app/dashboard/agents/AgentEditor.tsx`,
  tests en `lib/agent/schedule.test.ts`).
- **Crear órdenes manualmente desde el dashboard** (`docs/12`, ADR-0032): botón **"Crear orden"**
  en el panel de una conversación (cuando no tiene orden — p. ej. el bot cerró sin `#orden-lista`)
  y botón **"Nueva orden"** en la sección Órdenes (para ventas que no pasaron por el bot o cargas
  históricas). Crean una orden en blanco y abren el editor existente para completar ítems/envío/
  total; quedan guardadas en Supabase y **cuentan en métricas** (KPIs y Reportes). `createOrderForConversation`
  es idempotente (no duplica); `createManualOrder` crea/reutiliza contacto + conversación manual que
  anclan la orden. Se registran con el evento `order_manual_created` (no altera el costo de IA).
  (`app/dashboard/actions.ts`, `app/dashboard/conversations/[id]/CreateOrderButton.tsx`,
  `app/dashboard/orders/NewOrderButton.tsx`).

### Fixed
- **Borrar un contacto/conversación fallaba si tenía un evento de Hotmart** (`ERROR 23503:
  violates foreign key constraint "hotmart_events_contact_id_fkey"`): la migración `0013` creó
  `hotmart_events` con FKs a `contacts`/`conversations` **sin** `on delete cascade`, a diferencia
  de todo el resto del esquema. Se corrige con la migración `0015_hotmart_events_cascade.sql`, que
  recrea las FKs con `on delete cascade` (contacto/conversación) y `on delete set null` (agente).
  Requiere **aplicar la migración** en Supabase. (`supabase/migrations/0015_hotmart_events_cascade.sql`).
- **Reportes · Conversión mostraba muchas menos conversaciones de las reales** (p. ej. **6 en vez de
  26** en un día): el embudo contaba las conversaciones por su `created_at`, pero la ingesta reutiliza
  **una sola conversación activa por (contacto, agente)** entre días, así que "Hoy" solo veía los
  **leads nuevos**, no las conversaciones **atendidas**. Ahora hoy/7/30 días y el gráfico por día
  cuentan conversaciones **activas** (con inbound del cliente en el periodo), **distintas**; las
  **transacciones** son las órdenes **no canceladas** por su `created_at` (misma base que "Órdenes
  generadas", para que ambos cuadros coincidan — antes una compra vieja aparecía "hoy" si el cliente
  volvía a escribir); "Total" sigue siendo histórico. Nueva función pura
  `summarizeConversationActivity` (reemplaza `summarizeConversion`). De paso, `getConversionReport` y
  `getSalesReport` ahora **paginan**
  (`fetchAllRows`, páginas de 1000) para no subcontar al pasar del tope de 1000 filas de PostgREST.
  Ver **ADR-0037** y `docs/19`. (`lib/dashboard/report.ts`, `lib/dashboard/queries.ts`,
  `lib/dashboard/report.test.ts`, `app/dashboard/reports/page.tsx`, `docs/12-ordenes-y-reportes.md`).
- **Retargets ("¿sigues ahí?") que podían dispararse tras una compra**: al crear la orden se
  cancelaban las reactivaciones (7/15d) pero **no** los seguimientos (1h/8h), y la creación
  **manual** de orden desde el dashboard tampoco los cancelaba. Ahora, defensa en dos capas
  (`ADR-0017`): (A) se cancelan los retargets al crear la orden — bot (`#orden-lista`/cierre
  inferido) y `createOrderForConversation` del dashboard; (B) **guarda de compra** en el worker
  del cron: antes de enviar, si la conversación tiene una orden **no cancelada**, el seguimiento
  se cancela (`reason: "purchased"`) — a prueba de fallos aunque algún camino olvide cancelar.
  (`lib/agent/processMessage.ts`, `lib/agent/retarget.ts`, `lib/agent/retargetPlan.ts`,
  `app/dashboard/actions.ts`, tests en `lib/agent/retarget.test.ts`).
- **Ventas que se cerraban sin crear orden ni avisar al dueño (el modelo olvidaba `#orden-lista`)**:
  la orden solo se creaba con el tag `#orden-lista`. En un caso real el bot cerró la venta (confirmó
  el pedido, agradeció la compra, tenía método + ítems + datos de envío) pero emitió
  `#compra-contra-entrega` en vez de `#orden-lista`, que solo fija el método → "Sin orden todavía" y
  sin aviso. Se agrega una **red de seguridad** en el backend: si el texto es un cierre confirmado
  (`isPurchaseConfirmation`) y el método ya está decidido, se **infiere** la orden y se avisa al dueño
  por el mismo camino, sin forzar handoff. La creación es **idempotente** (nunca duplica) y no agenda
  retargets si ya hay orden. Se traza con `order_inferred` y `order_created.inferred`. Requiere además
  endurecer el `system_prompt` en el dashboard. (`lib/agent/order.ts`, `lib/agent/processMessage.ts`,
  tests en `lib/agent/order.test.ts`, ADR-0031).
- **El bot no respondía a NINGUNA conversación con gpt-5-mini (`temperature` no soportado)**: los
  modelos GPT-5/o-series rechazan el parámetro `temperature` con un 400, así que cada respuesta se
  caía. Se deja de enviar `temperature` a OpenAI (`responses.create` y su plumbing); `extractOrder`
  nunca lo mandó. La columna/campo `temperature` del agente se conservan pero quedan sin uso.
  (`lib/openai/responses.ts`, `lib/agent/processMessage.ts`, `lib/agent/retarget.ts`, ADR-0026).
- **El bot dejaba de responder en conversaciones abiertas al migrar de cuenta OpenAI**: el
  encadenamiento por `previous_response_id` usaba IDs de la cuenta vieja (no portables), así que
  con la `OPENAI_API_KEY` nueva `responses.create` daba 404 y la respuesta se caía en silencio.
  Ahora `generateReply` **reintenta sin encadenar** cuando el id no existe (`chainReset`), el
  caller persiste el id nuevo y la conversación se auto-recupera desde el siguiente turno —sin
  perder clientes ni tocar la DB a mano—. Se traza con el evento `chain_reset`. (`lib/openai/
  responses.ts`, `lib/agent/processMessage.ts`, tests en `lib/openai/responses.test.ts`, ADR-0025).
- **file_search encontraba solo docs de producto (envíos quedaban fuera)**: la llamada fijaba
  `max_num_results: 5`, así que un archivo "aparte" en el vector store —p.ej. las **tarifas de
  envío**— podía no entrar al top-K frente a decenas de documentos de producto (en el playground,
  que usa 20, sí aparecía). Se sube el default a **20** (paridad con el playground) y se hace
  configurable con `FILE_SEARCH_MAX_RESULTS`. Aplica a la respuesta normal y a los seguimientos.
  (`lib/env.ts`, `lib/openai/responses.ts`, `lib/agent/processMessage.ts`, `lib/agent/retarget.ts`,
  ADR-0024).

### Added
- **Horario de encendido/apagado por agente**: cada agente puede programar cuándo responde la IA
  (p. ej. 8pm–8am todos los días, domingos completos, festivos), para cubrir con la IA las líneas y
  horas "muertas" sin humanos. Se evalúa **inline** con una función pura `isAgentActiveNow`
  (`lib/agent/schedule.ts`, client-safe) — sin cron que prenda/apague; `enabled` sigue siendo el
  master manual. Modelo unión (ventana diaria + días completos + festivos) en columnas nuevas de
  `agents` (`schedule_enabled`, `schedule_timezone`, `schedule` jsonb; migración 0011). Fuera de
  horario se **apaga todo**: no responde inbound (`reply_skipped {agent-inactive}`, el mensaje igual
  se guarda) y los seguimientos/reactivaciones se **aplazan** (`*_deferred`) hasta que el agente
  vuelva a estar activo. UI en el editor de agente (ventana, días, festivos con prefill Colombia 2026
  y preview "activo ahora"). Retrocompatible (`schedule_enabled=false` ⇒ siempre activo). Tests en
  `lib/agent/schedule.test.ts`. (`lib/agent/schedule.ts`, `lib/agent/processMessage.ts`,
  `lib/agent/retarget.ts`, `lib/agent/reactivation.ts`, `app/dashboard/agents/AgentEditor.tsx`, ADR-0029).
- **Reactivaciones (plantillas 7/15 días) por agente**: el ON/OFF y los UUID de plantilla dejan de ser
  globales (`app_settings`) y pasan a cada agente (columnas en `agents`, backfill en la migración 0011),
  porque una plantilla solo existe en la cuenta de Callbell de su agente — así cada marca/línea envía
  SU plantilla con SUS credenciales. En la página de Retargets se elige el agente con un **selector**.
  (`lib/agent/reactivation.ts`, `lib/agent/agents.ts`, `lib/dashboard/queries.ts`,
  `app/dashboard/actions.ts`, `app/dashboard/retargets/ReactivationSettings.tsx` + `page.tsx`, ADR-0030).
- **Retargets: la lista se muestra arriba** de la barra de estadísticas en la página de Retargets
  (reorden menor de UI). (`app/dashboard/retargets/page.tsx`).
- **Crear agente con vector store y catálogo "de una vez" desde el dashboard**: el editor de agente
  ahora provisiona el vector store y carga los productos (JSON) sin pasos manuales fuera de banda.
  Dos flujos: **"Crear vector store nuevo"** (crea el store por marca, sube cada producto como doc a
  OpenAI `file_search` **y** hace upsert en `products`, y guarda el `vector_store_id`) y **"Ya tengo
  vector store"** (pega el `vs_...` y carga los productos **solo a Supabase**, sin re-subir docs).
  Acepta el **export tipo Bubble** (`ID`/`Titulo`/`Precio`/`PrecioConDescuento`/…) además del formato
  canónico; el precio oficial usa `PrecioConDescuento` (el de lista y el % quedan en `metadata`).
  Reutiliza `runCatalogImport` (idempotente por `(agent_id, sku)`) con un nuevo modo
  `vectorStoreMode` (`sync` = comportamiento previo de la route/CSV, intacto). Nueva función pura
  `normalizeCatalogJson` (validación/preview también en el cliente), Server Action `loadAgentCatalog`
  (service-role, dentro del Basic Auth) y `getOrCreateVectorStore` nombra el store por marca.
  `maxDuration=300` en las páginas de agente para el polling del vector store. Sin migraciones ni
  envs nuevas. (`lib/openai/catalog.ts`, `lib/openai/catalogLoader.ts`, `lib/openai/vectorStore.ts`,
  `app/dashboard/actions.ts`, `app/dashboard/agents/AgentEditor.tsx`, `app/dashboard/agents/*/page.tsx`,
  tests en `lib/openai/catalog.test.ts`, ADR-0028).
- **Botón "Reintentar IA" en el detalle de conversación**: si un error transitorio (OpenAI/Callbell)
  dejó el mensaje del cliente sin contestar, el operador re-corre el **mismo** flujo automático con
  un clic. Nueva función `regenerateReply` (`lib/agent/processMessage.ts`) que reutiliza
  `gatherPendingContent` + `generateAndSend` sobre los inbound pendientes, **sin** el debounce ni la
  guarda de "quién gana", y **lanza** un motivo legible si no se puede (conversación inactiva, IA en
  pausa, sin nada pendiente). Server Action `retryReply` + client component `RetryButton`
  (estado "Reintentando…"/error inline), en el header junto a "Pasar a manual"; deshabilitado en
  pausa/handoff. Auditoría con el evento `retry_requested`. Sin migraciones ni envs nuevas.
  (`lib/agent/processMessage.ts`, `app/dashboard/actions.ts`,
  `app/dashboard/conversations/[id]/RetryButton.tsx`, `app/dashboard/conversations/[id]/page.tsx`,
  ADR-0027).
- **Aviso de venta al dueño por WhatsApp**: cuando el agente cierra una orden (`#orden-lista`),
  envía un WhatsApp a `SALES_NOTIFY_PHONE` (default `573103565492`) con el número del cliente y el
  resumen del pedido (método, total, productos con precio y datos de envío). Se envía por el mismo
  Callbell del agente que hizo la venta; best-effort (nunca rompe el flujo del pedido) y se registra
  en `events_log` (`sales_notification_sent`/`_failed`). El texto lo arma `buildSaleNotification`
  (puro, con test). OJO: es un mensaje libre → WhatsApp solo lo entrega dentro de la ventana de 24h
  del dueño; para entrega garantizada, migrar a una plantilla aprobada. (`lib/agent/order.ts`,
  `lib/agent/processMessage.ts`, `lib/env.ts`).
- **Reportes → "Costo IA" desglosado**: nueva sección con las TRES fuentes de costo del agente —
  **texto** (tokens del modelo), **imágenes** (visión, estimado) y **audio** (transcripción whisper,
  costo real por minuto) — más el **total** de todo el costo IA. El costo de audio se captura por
  duración (`verbose_json` de whisper) y se guarda en `audio_transcribed.payload.costUsd`; el de
  imágenes se estima repartiendo el costo de tokens (`EST_IMAGE_INPUT_TOKENS`/imagen) sin alterar el
  total. Precios centralizados en `lib/openai/pricing.ts`. (`lib/dashboard/queries.ts`,
  `app/dashboard/reports/page.tsx`, `lib/openai/transcribe.ts`, `lib/openai/pricing.ts`).

### Changed
- **Costo de tokens real y completo**: el KPI "Costo de tokens" del dashboard usa el pricing real
  de gpt-5-mini ($0.25/1M input, $2/1M output) en vez del placeholder anterior (2.5/10), y ahora
  suma **todas** las llamadas al modelo, no solo la respuesta normal: los seguimientos dinámicos
  con IA (`retarget_sent`, que ya guardaban `usage`) y la extracción de la orden al cerrar
  (`extractOrder` → `order_created.payload.usage`, antes no se contabilizaba). `getKpis` agrega el
  `usage` de los tres tipos de evento. Las reactivaciones no consumen tokens (plantilla de WhatsApp,
  costo fijo aparte). (`lib/dashboard/queries.ts`, `lib/openai/extractOrder.ts`,
  `lib/agent/processMessage.ts`, `app/dashboard/page.tsx`).
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
- **Filtros en la lista de Conversaciones**: la vista `/dashboard/conversations` ahora tiene
  tres grupos de filtros combinables (vía query params, del lado del servidor, siguiendo el
  patrón de Órdenes): **Fecha** por actividad reciente (Todo · 7 · 30 · 90 días, sobre
  `updated_at`), **Pedido** (Todas · Con pedido · Sin pedido) y **Estado** (Activas · Con
  logística · Cerradas), más un enlace "Limpiar filtros". Cada conversación con orden muestra
  un badge **"Pedido"** (atenuado si el pedido está cancelado). `getRecentConversations` pasa a
  recibir un objeto de opciones (`{ limit, status, hasOrder, sinceDays }`) y cruza con `orders`
  para el badge y el filtro con/sin pedido. (`lib/dashboard/queries.ts`,
  `app/dashboard/conversations/page.tsx`, `app/dashboard/ui.tsx`, `app/dashboard/page.tsx`).
- **Multi-agente / multi-marca — enrutamiento dinámico por número (ver `docs/16`, ADR-0023)**:
  la plataforma pasa de "un agente" a "muchos agentes". Nueva tabla **`agents`** (migración
  **`0010_agents.sql`**): cada fila es una marca/número con su **enrutamiento** (`whatsapp_number`,
  `callbell_channel_uuid`), sus **credenciales** (`callbell_api_key` —otras líneas viven en otra
  cuenta de Callbell—, `logistics_team_uuid`), su **catálogo** (`vector_store_id`) y su **IA**
  (`system_prompt`, `model`, `temperature`, `enabled`). La API key de **OpenAI sigue global**; la de
  **Callbell + canal son por agente**. El webhook resuelve el agente del inbound por canal/número
  (`matchAgent` puro + testeado en `lib/callbell/routing.ts`; `resolveAgentForInbound` en
  `lib/agent/agents.ts`) y guarda `conversations.agent_id`; la respuesta carga **ese** agente
  (no una config global) y envía con **sus** credenciales. `sendText/sendImage/sendTemplate` ahora
  reciben `CallbellCreds` (API key + canal); `credsFromEnv()` es el fallback. **Catálogo por marca**:
  `products.agent_id` + `unique (agent_id, sku)`; el gate de `#ID` y las imágenes filtran por agente;
  `/api/catalog/load` y `scripts/import-catalog-csv.mjs --agent <id>` apuntan a un agente. **Cero
  downtime**: enrutamiento/envío resuelven **DB primero, env como fallback** — el agente seed arranca
  con `callbell_*` en NULL y usa las env de Vercel hasta que se peguen los IDs en el dashboard.
  Retargets, reactivaciones y envío manual usan las credenciales del agente de la conversación.
  Nueva sección de dashboard **Agentes** (`/dashboard/agents`, nav): lista + **detalle editable** +
  **crear**, con la **API key enmascarada** (write-only; las queries nunca devuelven el valor crudo);
  Server Actions `saveAgent`/`createAgent`. RLS de `agents` **sin** lectura `authenticated` (protege
  el secreto; el dashboard usa service-role). `agent_config` queda **legacy** (el runtime ya no la
  lee). Archivos nuevos: `lib/callbell/routing.ts` (+test), `lib/agent/agents.ts`,
  `app/dashboard/agents/*` (`page`, `[id]`, `new`, `AgentEditor`, `types`, `not-found`),
  `docs/16`, ADR-0023. Tocados: `lib/callbell/sender.ts`, `lib/callbell/types.ts`,
  `app/api/webhooks/callbell/route.ts`, `lib/agent/{processMessage,retarget,reactivation}.ts`,
  `lib/openai/{catalog,catalogLoader}.ts`, `app/api/catalog/load/route.ts`,
  `app/dashboard/{actions,layout}.tsx`, `lib/dashboard/queries.ts`, `lib/supabase/types.ts`.
  **Requiere en Supabase** aplicar `0010_agents.sql`; luego pegar en el dashboard los IDs del agente
  actual (o dejar el fallback a env). 6 tests nuevos de enrutamiento.
- **Comprensión de audio e imágenes — multimodal (ver `docs/15`, ADR-0022)**: el bot ahora
  **escucha** las notas de voz y **ve** las imágenes que manda el cliente, y usa ese contenido
  para responder (caso estrella: la **captura del comprobante de pago**). El webhook extrae el
  adjunto de `payload.attachments` (array de URLs) → se guarda en `messages.media_url`
  (`getAttachments` en `lib/callbell/types.ts`, `InboundMessage.mediaUrl`, ingesta). En la fase
  de respuesta (`gatherPendingContent`, reemplaza a `gatherPendingInput`): las **notas de voz**
  se transcriben con OpenAI (`audio.transcriptions.create`, `OPENAI_TRANSCRIBE_MODEL` default
  `whisper-1`, `language: es`) y el texto se **persiste** en `messages.content` (visible en el
  dashboard, reutilizable por la orden, idempotente); las **imágenes** se descargan y entran como
  **visión** (`input_image` data URL base64) en la MISMA llamada de Responses (`generateReply`
  acepta `imageDataUrls`; `buildResponsesInput` arma el input multimodal). Ahora se **responde a
  mensajes solo-media** (antes se descartaban por `input.length === 0`). Video/documentos: nota
  pidiendo texto (fuera de alcance v1). Se mantiene la **IA simple**: una sola llamada de
  razonamiento; la transcripción es pre-proceso (como `extractOrder`) y la imagen va dentro del
  turno. Descarga best-effort con guarda de tamaño (`fetchMedia` en `lib/callbell/mediaFetch.ts`,
  helpers puros en `lib/callbell/media.ts`) y reintento autenticado si el host es de Callbell; un
  fallo no rompe el turno (se responde con nota y se loguea `audio_transcribed`/
  `audio_transcribe_failed`/`image_received`/`image_fetch_failed`). **Kill switch**
  `MEDIA_UNDERSTANDING_ENABLED` (default ON) + `MEDIA_MAX_BYTES` (default 20 MB). El dashboard ya
  renderiza imágenes inbound (`ChatPanel`, `media_url`). Nuevas env **opcionales**
  (`OPENAI_TRANSCRIBE_MODEL`, `MEDIA_UNDERSTANDING_ENABLED`, `MEDIA_MAX_BYTES`) — con defaults el
  deploy funciona. **Requiere en Supabase** aplicar `0009_update_agent_prompt_media.sql` (agrega
  la sección IMÁGENES Y NOTAS DE VOZ al prompt: comprobantes de pago). Módulos nuevos:
  `lib/callbell/media.ts` (+test), `lib/callbell/mediaFetch.ts`, `lib/openai/transcribe.ts`,
  `lib/openai/responsesInput.ts` (+test). Tocados: `lib/callbell/types.ts`,
  `app/api/webhooks/callbell/route.ts`, `lib/agent/processMessage.ts`, `lib/openai/responses.ts`,
  `lib/env.ts`. 13 tests nuevos.
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
