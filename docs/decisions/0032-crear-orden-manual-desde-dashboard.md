# ADR-0032: Crear órdenes manualmente desde el dashboard

- **Estado:** Aceptada
- **Fecha:** 2026-07-04
- **Sprint:** post-5 (operación)

## Contexto

Hasta ahora las órdenes solo nacían del bot al cerrar la venta (`#orden-lista` o la red
de seguridad de ADR-0031). No había forma de **registrar una venta a mano** cuando: el
agente cerró sin dejar orden, la venta se cerró por otro canal (teléfono), o se quieren
cargar ventas históricas para ver cómo quedan las **métricas** (KPIs, Reportes de ventas y
conversión leen la tabla `orders`). El dueño pidió un botón para crear órdenes tanto en la
**conversación** como en la sección **Órdenes**.

Restricción del modelo: `orders.conversation_id` y `orders.contact_id` son **NOT NULL**
(FK con `on delete cascade`). Toda orden necesita una conversación y un contacto.

## Decisión

Dos Server Actions (service-role, protegidas por el Basic Auth del dashboard) que crean una
orden **en blanco** y devuelven su id para abrir el `OrderEditor` ya existente (ítems, envío,
total y estado se completan ahí). Reutilizan toda la maquinaria de edición (`saveOrder`).

1. **`createOrderForConversation(conversationId)`** — botón "Crear orden" en el panel lateral
   de una conversación (solo cuando NO tiene orden). Usa el `contact_id` y el método de la
   conversación. **Idempotente**: si ya hay orden, abre esa. Resuelve el caso "el bot cerró
   sin `#orden-lista`".
2. **`createManualOrder({ name, phone })`** — botón "Nueva orden" en la sección Órdenes.
   Para ventas que no pasaron por el bot. Crea (o reutiliza por teléfono) un **contacto** y
   una **conversación manual** (`handed_off`) que anclan la orden.

Ambas nacen en `pending_handoff` y se registran con el evento `order_manual_created`
(deliberadamente distinto de `order_created`: NO entra en `TOKEN_EVENT_TYPES`, así que no
contamina el costo de IA — no hubo tokens).

## Consecuencias

- **Bueno:** se puede registrar cualquier venta a mano y verla en métricas al instante
  (cuenta como transacción/venta salvo que se marque **Cancelada**). Cero código nuevo de
  edición: se reaprovecha el editor de órdenes. El costo de IA no se altera.
- **Trade-off (métricas de conversión):** `createManualOrder` crea una conversación sintética
  que entra al **denominador** del embudo de conversión (`getConversionReport`) y, al tener
  orden no cancelada, cuenta como "convertida". Cargar muchas órdenes históricas por aquí
  **infla** la tasa de conversión. Las ventas totales (KPI principal) sí quedan correctas.
  `createOrderForConversation` no tiene este efecto (la conversación ya existía).
- **Menor:** una orden en blanco abandonada (total null) cuenta como transacción con $0
  hasta que se complete o se marque Cancelada.

## Alternativas consideradas

- **Compartir una única conversación "manual" para todas las órdenes de cero.** Evitaría
  inflar el denominador, pero rompe la lista de Órdenes (todas mostrarían el mismo contacto)
  y el editor. Descartada.
- **Formulario de orden completo aparte (sin editor).** Duplicaría la lógica de `OrderEditor`
  y `saveOrder`. Se prefirió "crear en blanco → abrir el editor existente".
- **Hacer `conversation_id` nullable.** Cambio de esquema invasivo que tocaría todas las
  queries del dashboard; no lo justifica el caso de uso.
