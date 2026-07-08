# 12 — Órdenes y reportes (dashboard)

Continuación del Sprint 6. Da al equipo una vista de las **transacciones** (órdenes) con sus
fechas, la posibilidad de **corregirlas**, y **reportes** de ventas para informar al resto del
equipo. Ver **ADR-0019**.

## De dónde salen las órdenes
El agente crea `orders` + `order_items` al cerrar la venta (`#orden-lista`, ver ADR-0011 y
`docs/03`). Estados posibles (`order_status`):

| Estado            | Significado                                              | ¿Cuenta como venta? |
| ----------------- | ------------------------------------------------------- | ------------------- |
| `pending_handoff` | Recién creada por la IA, antes del handoff              | Sí (generada)       |
| `handed_off`      | Pasada a logística (handoff automático)                 | Sí (generada)       |
| `confirmed`       | **Venta cerrada**, confirmada por el equipo             | Sí (confirmada)     |
| `cancelled`       | No se concretó                                          | **No**              |

## Sección Órdenes (`/dashboard/orders`)
- **Lista** con filtro por estado (Todas / Pendientes / Con logística / Confirmadas / Canceladas):
  contacto, estado, método, ítems, ciudad, fecha y total. Más recientes primero.
- **Detalle** (`/dashboard/orders/[id]`): un **editor** para corregir lo que la IA marcó mal:
  - Estado y método.
  - Datos de envío (nombre, teléfono, dirección, ciudad).
  - **Ítems**: agregar, quitar y editar (nombre, SKU/`#ID`, cantidad, precio unitario).
  - **Total**: manual, o marcando "Recalcular el total desde los ítems" (suma qty × precio).
  - Notas de logística.
  - Un solo botón **Guardar cambios**. Enlace a la conversación de origen.

Marca la orden como **Confirmada** cuando la venta quede cerrada: así suma en Reportes.

### Cómo se guarda
Server Action `saveOrder(orderId, input)` (`app/dashboard/actions.ts`): corre server-side con
service-role (protegida por el Basic Auth del dashboard, `middleware.ts`). Actualiza la cabecera y
**reemplaza** los ítems (delete + insert). Registra `order_edited` en `events_log` (auditoría) y
revalida las rutas afectadas (órdenes, reportes, resumen y la conversación).

## Sección Reportes (`/dashboard/reports`)
Agrega **todas** las órdenes (lógica pura `summarizeOrders` en `lib/dashboard/report.ts`):
- **Titulares:** ventas confirmadas (monto + #), en curso/pipeline (monto + #), órdenes generadas
  (# + monto, sin canceladas), canceladas (#).
- **Ventanas:** hoy, últimos 7 y 30 días (órdenes generadas).
- **Por estado** y **por método** (este último sobre órdenes activas, sin canceladas).
- **Últimos 14 días:** órdenes generadas por día (barras), zona `America/Bogota`.
- **Conversión:** tabla por periodo (hoy / 7 / 30 días / total) y gráfico por día de
  **conversaciones vs. transacciones** y **% de conversión**. En hoy/7/30 días y en el gráfico,
  "Conversaciones" = conversaciones **activas** (con al menos un mensaje inbound del cliente) en el
  periodo, **distintas** (no las creadas ese día: la ingesta reutiliza una conversación por contacto
  entre días). "Transacciones" = órdenes **no canceladas** por su `created_at` (la MISMA base que
  "Órdenes generadas por día", para que coincidan). "Total" es histórico (todas las conversaciones
  vs. todas las órdenes no canceladas). Lógica pura `summarizeConversationActivity`; datos con
  `getConversionReport` (paginado, sobre `messages` inbound + `orders`). Ver **ADR-0037** y `docs/19`.
- **Copiar resumen:** botón que copia un resumen en texto plano (incluye la conversión) para pegar
  en WhatsApp/Slack.

## Qué NO hace (v1)
- No confirma la venta ni la logística automáticamente (eso es de otro equipo; ver `docs/00`).
- No crea órdenes a mano desde el dashboard (solo edita las que crea el agente).
- No hay historial por ítem ni transacción atómica en la edición (volumen bajo; ver ADR-0019).

## Supabase
**No hay nada que aplicar** para esta funcionalidad: reutiliza `orders`/`order_items` (migración
`0001`) y el dashboard escribe con service-role, que omite RLS.
