# PRD Maestro — AI Seller Vitasei

> **Producto 1:** Agente de IA que vende productos del ecommerce de Vitasei por WhatsApp,
> cierra la compra (método de pago/fulfillment) y hace handoff al equipo de logística.
> **Repo:** `ai-seller-vitasei` · **Proyecto Supabase:** `seller-agent-vitasei`

---

## 1. Objetivo

Construir un agente de ventas por WhatsApp que:

1. Responda preguntas sobre productos del ecommerce usando **OpenAI Responses API + File Search** sobre el catálogo cargado.
2. Muestre **imágenes de producto** bajo demanda usando el sistema `#ID` (lookup en Supabase).
3. Conduzca al cliente a **cerrar la compra** por uno de dos caminos: **Addi** (financiación) o **Contra entrega** (COD).
4. Una vez la compra está lista, haga **handoff al equipo de logística** (reasigna conversación + apaga el bot en Callbell) para que ellos confirmen la venta y gestionen la entrega.
5. Todo observable desde un **dashboard** de conversaciones.

**Límite de alcance v1:** el agente llega hasta *"orden lista para confirmar"*. La confirmación de venta, el cobro real de Addi y la logística de entrega los hace **otro equipo** (fuera de este producto).

---

## 2. Supuestos (confirmar/corregir)

| # | Supuesto | Razón |
|---|----------|-------|
| A1 | Stack: **Next.js 14 (App Router) + TypeScript + Supabase + Vercel + Inngest** | Es tu stack estándar; Inngest da el loop async (webhook responde rápido, el LLM corre en background). |
| A2 | WhatsApp vía **Callbell** (BSP) | Indicado por ti. `POST /v1/messages/send`, webhook `message_created`. |
| A3 | **Addi = link/instrucciones en v1** (no integración API todavía) | El objetivo es cerrar la intención de compra y pasar a logística; la integración Addi API es backlog. |
| A4 | Modelo OpenAI **configurable** (`OPENAI_MODEL`), familia GPT-5.x / GPT-4.1 capaz de Responses + file_search | Evita amarrarse a un modelo que rote. |
| A5 | El **`#ID` (SKU)** es la misma clave en el catálogo del vector store y en la tabla `products` | Es el puente entre razonamiento (File Search) e imágenes/precio (Supabase). |
| A6 | Dashboard interno (auth Supabase), styling neutral hasta tener tokens de marca Vitasei | No reusamos marca Rentmies. |

---

## 3. Arquitectura en una frase

> Callbell `message_created` → `/api/webhooks/callbell` (responde 200 inmediato) → evento Inngest → **loop** (sense → reason con Responses+file_search → propose/parse tags → gate anti-alucinación → act: enviar texto + imágenes `#ID` por Callbell / crear orden / handoff → log en Supabase) → Dashboard lee de Supabase.

Diagrama y detalle en `01-arquitectura.md`.

---

## 4. El sistema `#ID` (dos fuentes, una clave)

El conocimiento del producto vive en **dos lugares** y el SKU los une:

- **Vector Store (OpenAI):** catálogo completo en texto (descripciones, specs, FAQs, beneficios). El agente lo consulta con `file_search` para responder con flexibilidad.
- **Tabla `products` (Supabase):** fila estructurada por SKU con `name`, `price`, `image_url`, `in_stock`. Sirve para (a) traer la **imagen**, y (b) **validar** precio/existencia → es el **gate anti-alucinación**.

**Flujo de imagen:** el agente, al recomendar un producto, emite inline un tag `#ID:VITA-001`. El backend:
1. Extrae los tags `#ID:` del texto del agente.
2. Por cada uno, busca el producto en Supabase.
3. Si existe → envía un mensaje `type: image` por Callbell con la imagen (de Supabase Storage) + caption opcional.
4. Limpia los tags del texto antes de mandar el mensaje de texto.

**Imagen opcional:** un mensaje puede tener 0..N tags `#ID`, así que la imagen es opcional por diseño. Si el agente no emite `#ID`, no se manda imagen.

---

## 5. Escenarios / tags del agente

El agente comunica intención al backend mediante **tags estructurados**. Taxonomía v1:

| Tag | Significado | Acción del backend |
|-----|-------------|--------------------|
| `#ID:<sku>` | Mostrar producto | Enviar imagen(es) del producto por Callbell |
| `#addi` | Cliente quiere financiar con Addi | Enviar info/link de Addi; marcar `fulfillment_method = addi` |
| `#compra-contra-entrega` | Cliente quiere pago contra entrega | Activar flujo COD: recolectar nombre, dirección, ciudad, teléfono, ítems |
| `#orden-lista` | Datos completos, orden lista | Crear `orders` + `order_items`; disparar handoff |
| `#humano` | Escalar a humano ya | Handoff inmediato sin crear orden |

**Disciplina de tags (regla de prompt):** un tag siempre en su propia línea o claramente delimitado, SKU exacto, nunca inventar SKUs que no estén en el catálogo. Detalle completo y system prompt en `03-agente-prompt-y-tags.md`.

---

## 6. Handoff a logística (clave del v1)

Cuando el agente emite `#orden-lista` (o `#humano`):

1. Backend crea la orden en Supabase (`orders` + `order_items`) con método y datos de envío.
2. Reasigna la conversación en Callbell con `team_uuid` (equipo logística) y manda mensaje con `bot_status: bot_end` para **apagar el agente** en esa conversación.
3. (Opcional) Crea una nota interna en la conversación de Callbell con el resumen de la orden.
4. Marca `conversations.status = handed_off`.

A partir de ahí el agente no responde más en esa conversación; el equipo de logística confirma la venta manualmente.

---

## 7. Métricas v1 (en dashboard)

- Conversaciones activas / handoff / cerradas
- Órdenes creadas por método (Addi vs Contra entrega)
- Tasa de conversión (órdenes / conversaciones iniciadas)
- Productos más mostrados (#ID)
- Tiempo a handoff

---

## 8. Fuera de alcance v1 (backlog)

- Integración real de Addi API (cobro/financiación)
- Confirmación de venta y tracking logístico (lo hace otro equipo)
- Mensajes template fuera de la ventana de 24h (outbound proactivo)
- Multi-canal (IG, Messenger)
- A/B de prompts, evals automáticas
