# 02 — Supabase: schema y storage

Proyecto: **`seller-agent-vitasei`**. Migración: `supabase/migrations/0001_init.sql`.

## Tablas

| Tabla | Para qué |
|-------|----------|
| `contacts` | Cliente de WhatsApp (phone E.164 sin `+`, ej `573001234567`). |
| `conversations` | Hilo por contacto. Guarda `status`, `fulfillment_method`, `openai_previous_response_id`, `last_inbound_at` (ventana 24h), `assigned_team_uuid`. |
| `messages` | Cada mensaje in/out. `tags` (jsonb) guarda los tags emitidos; `callbell_message_uuid` da idempotencia. |
| `products` | **Gate anti-alucinación.** SKU = `#ID`. Fuente de `image_url` y `price`. |
| `orders` / `order_items` | Orden creada en `#orden-lista`, con método y datos de envío. |
| `agent_config` | System prompt **versionado** en DB (como hacías con EMA/Catalina). Un solo registro `is_active` por nombre. |
| `events_log` | El "log" del loop: webhook, reason, gate_blocked, image_sent, handoff. |
| `catalog_imports` | Trazabilidad de cada carga de catálogo al vector store. |

> **`fulfillment_method` (conversations/orders) es TEXTO LIBRE** desde la migración `0025`
> (antes era un enum `addi|cod|undecided`). Cada agente define sus métodos de pago en
> `agents.payment_methods` (jsonb `[{tag,label,method}]`) y el `method` elegido se guarda ahí.
> `undecided` sigue siendo el sentinela de "sin elegir". Ver ADR-0055. La tabla `agents`
> (multi-marca) se agregó en la migración `0010`.

## Storage

- Bucket público **`product-images`** para las imágenes de producto.
- `products.image_url` apunta a la URL pública del bucket.
- En la carga de catálogo (Sprint 2) las imágenes se suben aquí y se setea `image_url`.

## Convención de teléfono

Igual que en tus campañas: **E.164 sin `+`** → `573XXXXXXXXX`. Normalizar al recibir el webhook (Callbell entrega el número; quitar `+` y caracteres no numéricos).

## RLS

Activado en todas las tablas. El **backend** (Inngest functions, route handlers) usa `SUPABASE_SERVICE_ROLE_KEY` y bypassa RLS para escribir mensajes/órdenes. El **dashboard** usa usuarios autenticados con policies de lectura + escrituras puntuales (productos, cerrar conversación). El modelo de roles fino se ajusta cuando Vitasei defina su auth.

## Cómo aplicar

Con Supabase CLI:
```bash
supabase link --project-ref <ref-de-seller-agent-vitasei>
supabase db push
```
O pegando `0001_init.sql` en el SQL Editor del dashboard de Supabase.
