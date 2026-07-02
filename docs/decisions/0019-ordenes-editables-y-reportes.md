# ADR-0019: Órdenes editables en el dashboard + reportes de ventas

- **Estado:** Aceptada
- **Fecha:** 2026-07-02
- **Sprint:** 6 (continuación — dashboard)

## Contexto
El agente crea `orders` + `order_items` al cerrar la venta (`#orden-lista`, ADR-0011), pero la
extracción puede quedar mal: ítems mal parseados, método equivocado, envío incompleto, o una
"orden" que en realidad no se concretó. El equipo necesita (1) **ver** las transacciones con sus
fechas, (2) **corregir** los campos, y (3) **reportes claros** de cuántas ventas se están
generando para informar al resto del equipo. No había sección de órdenes ni edición; los KPIs de
Resumen sumaban `orders.total` de **todas** las órdenes, incluidas las canceladas.

## Decisión
- **Reutilizar el esquema existente** (`orders`/`order_items`, migración `0001`). **No** se crea
  tabla ni migración: los estados (`pending_handoff`/`handed_off`/`confirmed`/`cancelled`) y los
  campos de envío/total ya cubren el caso.
- **Sección Órdenes** (`/dashboard/orders`): lista con filtro por estado + detalle
  (`/dashboard/orders/[id]`) con un **editor de guardado único** (client component `OrderEditor`)
  que edita cabecera (estado, método, envío, notas, total) e **ítems** (agregar/quitar/editar).
- **Edición vía Server Action `saveOrder`** (service-role, protegida por el Basic Auth del
  dashboard, como `setConversationManual`). Los ítems se **reemplazan** (delete + insert): es lo
  más simple y correcto al volumen v1. Se loguea `order_edited` en `events_log` (auditoría).
- **Reportes conscientes del estado** (`lib/dashboard/report.ts`, lógica pura `summarizeOrders` +
  `getSalesReport`): **confirmadas** = `confirmed`; **generadas** = todo menos `cancelled`;
  **pipeline** = `pending_handoff` + `handed_off`; canceladas separadas. Cortes por estado,
  método y por día (últimos 14, zona `America/Bogota`, UTC-5 fija). Se corrige `getKpis` para
  excluir canceladas de "Ventas generadas".
- **Sin cambios en Supabase**: el dashboard escribe con service-role, que **omite RLS**; las
  tablas ya existen. No hay nada que aplicar.

## Consecuencias
- **Bueno:** cero fricción de infra/migraciones; consistente con el patrón de Server Actions +
  service-role ya usado; reportes honestos (canceladas no cuentan como venta); lógica de
  agregación pura y testeada (9 tests).
- **Malo / atado a futuro:**
  - Editar ítems = **reemplazo total** (sin historial por ítem); aceptable a este volumen.
  - `saveOrder` hace update + delete + insert en 3 statements (no transacción atómica). A este
    volumen y con un solo editor humano el riesgo es mínimo; si crece, mover a una RPC Postgres.
  - Los reportes suman en JS sobre todas las órdenes; si el volumen crece, mover a vistas/RPC.
  - Los cortes por día asumen Colombia (UTC-5, sin DST); no sirve tal cual para otras zonas.

## Alternativas consideradas
- **(a) Migración nueva** (`confirmed_at`, `source ai|manual`): innecesaria — `updated_at` (trigger)
  + `events_log.order_edited` ya dan la traza. Descartada para no tocar Supabase.
- **(b) Acciones por ítem** (update/delete/insert individuales) en vez de reemplazo: más código y
  más superficie, beneficio marginal.
- **(c) Reportes con vistas/RPC en Postgres**: prematuro; se hará si el volumen lo pide.
- **(d) Botones rápidos "Confirmar/Cancelar"** aparte del editor: se prefirió un **único** editor
  con `<select>` de estado (una sola fuente de verdad, menos superficie); fácil de agregar luego.
