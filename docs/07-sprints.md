# 07 — Sprints (ejecución por Claude Code)

Cada sprint es una unidad ejecutable con entregable y criterio de aceptación. Claude Code
los toma en orden. Tiempo estimado: dev a tiempo parcial.

---

## Sprint 0 — Setup del repo y servicios
**Entregables**
- Repo `ai-seller-vitasei` en GitHub (ver instrucciones en README).
- Proyecto Vercel conectado.
- Proyecto Supabase `seller-agent-vitasei` creado.
- Cuenta OpenAI con API key; cuenta Callbell con WhatsApp configurado y API key.
- `.env` lleno a partir de `.env.example`.

**Aceptación:** `npm run dev` levanta; conexión a Supabase OK; ping a OpenAI y Callbell OK.

---

## Sprint 1 — Base Next.js + Supabase + webhook
**Entregables**
- Scaffold Next.js 14 + TS + Tailwind. Cliente Supabase (browser + server/service-role).
- Aplicar migración `0001_init.sql` (`supabase db push`). Bucket `product-images`.
- Setup Inngest (cliente + endpoint `/api/inngest`).
- Route handler `POST /api/webhooks/callbell`: valida secret, responde `200 {"status":"ok"}`,
  filtra `message_created` inbound, normaliza teléfono, encola `whatsapp/message.received`.
- Idempotencia por `callbell_message_uuid`.

**Aceptación:** un mensaje real de WhatsApp llega al webhook, se encola en Inngest y se ve un
registro en `events_log` (`webhook_received`). Contact + conversation se crean/actualizan.

---

## Sprint 2 — Catálogo: vector store + products + storage
**Entregables**
- Script/route de **carga de catálogo**: sube texto al File API, crea/actualiza vector store,
  espera `completed`, guarda `OPENAI_VECTOR_STORE_ID` y `agent_config.vector_store_id`.
- Upsert estructurado en `products` por `sku` (con validación SKU↔catálogo).
- Subida de imágenes a `product-images` y set de `image_url`.
- Registro en `catalog_imports`.

**Aceptación:** cargar un catálogo de prueba (5-10 productos) deja vector store `completed`,
filas en `products` con imagen, y SKUs consistentes.

---

## Sprint 3 — Generación de respuesta (Responses + tags)
**Entregables**
- `processMessage` (ya con concurrency por teléfono): cargar `previous_response_id` / historial.
- **Generar:** UNA sola llamada `openai.responses.create` con `file_search` + system prompt de
  `agent_config`. Guardar `previous_response_id`. Extraer el texto del output.
- **Parsear tags** (`#ID:`, `#addi`, `#compra-contra-entrega`, `#orden-lista`, `#humano`) y
  construir `cleanText` (el texto sin las líneas de tags). Sin razonamiento ni llamadas extra:
  la respuesta del modelo se guarda como mensaje.

**Aceptación:** mensaje del cliente → respuesta generada en una llamada y parseada; `cleanText`
y tags quedan en `messages` (outbound; el envío a Callbell es el Sprint 4).

---

## Sprint 4 — Envío por Callbell + gate (texto + imágenes #ID)
**Entregables**
- Sender Callbell abstraído: `sendText`, `sendImage`. Guardar `callbell_message_uuid`.
- GATE: descartar `#ID` cuyo SKU no exista en `products` (log `gate_blocked`); validar ventana 24h.
- Por cada `#ID` válido → `sendImage(image_url, caption)`. Enviar `cleanText` como texto.
- Persistir todo en `messages` + `events_log` (`image_sent`, etc.).

**Aceptación:** cliente pide un producto → recibe texto + imagen correcta en WhatsApp. Un `#ID`
inventado por el modelo NO genera envío y queda logueado como `gate_blocked`.

---

## Sprint 5 — Flujos de compra + handoff
**Entregables**
- Manejo de `#addi` (enviar link/instrucciones; set `fulfillment_method = addi`).
- Manejo de `#compra-contra-entrega` (set método; el prompt recolecta datos).
- Manejo de `#orden-lista`: crear `orders` + `order_items` con datos de envío e ítems.
- Handoff: `send` con `team_uuid` (logística) + `bot_status: bot_end`; `status = handed_off`;
  nota interna opcional con resumen.
- Manejo de `#humano`: handoff inmediato sin orden.

**Aceptación:** una conversación completa de compra (contra entrega y Addi) crea la orden
correcta, reasigna a logística, apaga el bot y el agente deja de responder.

---

## Sprint 6 — Dashboard
**Entregables (ver doc 06)**
- Auth Supabase. Vistas: Conversaciones (lista + detalle realtime), Órdenes, Productos, Métricas.
- Reglas UI "Pro Max" + styling neutral (tokens Vitasei placeholder).

**Aceptación:** se puede ver una conversación en vivo, abrir su detalle con imágenes y tags,
ver la cola de órdenes y el catálogo.

---

## Sprint 7 — Hardening
**Entregables**
- Confirmar y endurecer firma del webhook Callbell.
- Retries/dead-letter en Inngest; manejo de errores de OpenAI/Callbell.
- Rate limit básico; logs/alertas; revisar costos file_search.
- QA end-to-end con números reales; checklist UI Pro Max.

**Aceptación:** flujo estable end-to-end; errores no rompen el loop; conversaciones no se duplican.

---

## Orden de dependencias
```
S0 → S1 → S2 → S3 → S4 → S5 → S6 → S7
                 └─ S2 debe estar listo antes de S4 (imágenes/gate dependen de products)
```

## Backlog (post-v1)
Integración Addi API · templates fuera de 24h · multicanal (IG/Messenger) · evals de prompt ·
confirmación de venta y tracking (otro equipo) · debounce avanzado de mensajes.

---

## Definition of Done (aplica a TODOS los sprints)
Además del criterio de aceptación de cada sprint, no se cierra hasta:
1. `CHANGELOG.md` actualizado (versión movida de `[Unreleased]`).
2. `docs/sprint-log/sprint-NN.md` escrito (desde `_template.md`).
3. ADR(s) creado(s) si hubo decisiones no triviales (`docs/decisions/`).
4. Commits en Conventional Commits + push.
Ver `docs/08-registro-y-documentacion.md`.
