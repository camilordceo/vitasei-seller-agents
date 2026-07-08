# 21 — Fuente de producto + analítica de horarios

Tres cosas para empezar a medir mejor: (1) categorizar cada conversación por **producto**,
(2) ver **a qué hora** llega el cliente y se hace la orden (hora Colombia), y (3) reportes por
**día de la semana / hora** y **conversión por producto**.

## 1. Fuente de producto de la conversación
- Nueva columna `conversations.product_category` (migración `0018`).
- **Autodetección**: al responder, si el mensaje del cliente o la respuesta del bot menciona una
  palabra clave (se reutiliza el catálogo de `videos`, ej. "magnesio", "colageno"), se fija la
  categoría con la **primera** que aparezca — solo si la conversación aún no tiene una (no pisa la
  manual). `lib/agent/productCategory.ts`, enganchado en `processMessage`. Best-effort.
- **Manual**: en el detalle de conversación hay un editor **Producto / fuente** (input con
  autocompletado de las palabras conocidas) para fijarla o corregirla — sirve para las viejas o para
  cambiarla a futuro. Server action `setConversationProductCategory`.
- Sirve para el reporte **Conversión por producto** (ver abajo).

## 2. Analítica de horarios en la orden (hora Colombia)
- En el detalle de la orden se muestran, en **hora Colombia** (`America/Bogota`):
  - **Cliente llegó**: `created_at` de la conversación (primer contacto).
  - **Orden creada**: `created_at` de la orden.
  - **Tiempo a la orden**: diferencia entre ambos.
- Se agregaron `formatBogotaDateTime` / `formatBogotaTime` porque el server corre en UTC y
  `formatDateTime` mostraba UTC. No hubo columnas nuevas: los timestamps ya existían.

## 3. Reportes nuevos
- **Por día de la semana** y **Por hora del día** (órdenes generadas, hora Colombia). Cortes puros
  en `summarizeOrders` (`byWeekday[7]`, `byHour[24]`) usando `bogotaWeekdayHour` (UTC-5 fijo, sin
  DST, determinista para tests).
- **Conversión por producto**: conversaciones agrupadas por `product_category` con su tasa de
  conversión (orden no cancelada). `summarizeProductConversion` (puro) + `getProductConversion`.
  "Sin categoría" agrupa las nulas y va al final.

## Datos (migración 0018)
`alter table conversations add column product_category text` + índice. **Requiere aplicar
`0018_conversation_product_category.sql` en Supabase.** Todo es resiliente a la ventana de
migración: si falta la columna, la detección/edición/reportes degradan sin romper (todo cae en
"Sin categoría").

## Archivos
- `supabase/migrations/0018_conversation_product_category.sql`, `lib/supabase/types.ts`.
- `lib/agent/productCategory.ts` (+ hook en `lib/agent/processMessage.ts`).
- `lib/dashboard/report.ts` (byWeekday/byHour + `summarizeProductConversion` + `bogotaWeekdayHour`),
  `lib/dashboard/queries.ts` (`getProductConversion`, `getOrder`+llegada, `getConversation`+categoría),
  `lib/dashboard/format.ts` (helpers Bogota).
- `app/dashboard/actions.ts` (`setConversationProductCategory`),
  `app/dashboard/conversations/[id]/ProductCategoryEditor.tsx` (+ página),
  `app/dashboard/orders/[id]/page.tsx`, `app/dashboard/reports/page.tsx`.
- Tests en `lib/dashboard/report.test.ts`.

## Qué NO hace (v1)
- La autodetección usa el catálogo de palabras de **videos**; un producto sin video no se
  autodetecta (se pone a mano). Si hace falta, se separa el catálogo luego.
- No hay conversión por producto **cruzada con hora/día** todavía; se puede agregar después.
