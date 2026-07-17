# ADR-0059: Idempotencia de orden por "orden activa" (múltiples órdenes por conversación)

- **Estado:** Aceptada
- **Fecha:** 2026-07-17
- **Sprint:** — (mejora post-Sprint 5)

## Contexto

Hasta ahora, la creación de orden era **idempotente por conversación**: tanto el flujo del
bot (`lib/agent/processMessage.ts`) como la creación manual del dashboard
(`createOrderForConversation` en `app/dashboard/actions.ts`) reutilizaban **cualquier** orden
existente de la conversación (`.eq("conversation_id", id).limit(1)`), sin mirar su estado. Con
eso, una conversación tenía en la práctica **una sola orden para siempre**.

Caso real que rompe ese supuesto: una clienta generó una orden hace una semana, la **canceló**,
y hoy volvió a pedir. Con la idempotencia anterior el bot encontraba la orden cancelada, la
reutilizaba y **no creaba una nueva** ni **avisaba al dueño** de la nueva venta; en el dashboard,
"Crear orden" tampoco creaba una: reabría la cancelada. Resultado: la venta de hoy quedaba
invisible en órdenes/reportes y sin aviso al dueño.

Hecho clave del esquema: **no hay ningún constraint `UNIQUE`** sobre `orders.conversation_id`
(`idx_orders_conversation` es un índice normal, `0001_init.sql:124`). La base **ya permite**
varias órdenes por conversación; el límite de "una sola" vivía únicamente en el código. Además,
la guarda de compra de retargets/reactivaciones ya trataba a una orden **cancelada como
inexistente** (`.neq("status", "cancelled")`, `retarget.ts:248`), así que el concepto de "orden
activa" ya existía en el sistema, solo faltaba aplicarlo a la creación.

## Decisión

La idempotencia de creación pasa de "una orden por conversación" a **"una orden ACTIVA por
conversación"**. Una orden `cancelled` **no** cuenta como activa: reutilizamos una orden previa
solo si `status <> 'cancelled'`; si la conversación no tiene ninguna activa (nunca tuvo, o todas
están canceladas), se **crea una nueva**.

Se aplica el mismo filtro `.neq("status", "cancelled")` (más `order by created_at desc limit 1`
para elegir de forma determinista la más reciente) en los dos puntos de creación:

- `lib/agent/processMessage.ts` — cierre de venta del bot (`#orden-lista` o cierre inferido).
- `app/dashboard/actions.ts` — `createOrderForConversation` ("Crear orden" en la conversación).

No se toca la base de datos (no hace falta migración) ni `createManualOrder` (siempre crea una
conversación nueva, así que ya generaba órdenes independientes).

## Consecuencias

- **Bueno:** el caso "canceló y volvió a pedir" funciona por los dos caminos. La orden previa
  queda cancelada intacta; la nueva se crea con la fecha de hoy, cuenta en órdenes/reportes y
  **dispara el aviso al dueño** (el aviso vive dentro del bloque de creación, así que solo se
  emite cuando de verdad nace una orden nueva). Consistente con el idioma "orden activa" que ya
  usaban las guardas de retargets/reactivaciones.
- **Idempotencia intacta dentro de una misma venta:** apenas nace la orden nueva queda
  `pending_handoff` (activa), así que los mensajes siguientes de esa misma ráfaga la reutilizan y
  no duplican.
- **A tener en cuenta:** una conversación puede acumular varias órdenes (p. ej. 1 cancelada + 1
  activa). El detalle de conversación muestra la **más reciente** (comportamiento ya existente);
  el histórico completo se ve en la sección **Órdenes** (que ya lista todas y filtra por estado).
  Los reportes ya contaban "transacciones = órdenes no canceladas por su `created_at`", así que
  cada orden nueva suma una transacción sin doble conteo.
- **Atado a futuro:** si algún día se quisiera "una sola orden viva a la vez" a nivel de datos,
  habría que un índice único parcial (`unique (conversation_id) where status <> 'cancelled'`); hoy
  no se necesita y se prefiere no atar la base.

## Alternativas consideradas

- **Constraint/índice único parcial en la DB** (`unique(conversation_id) where status <>
  'cancelled'`): daría garantía dura, pero es rígido (bloquearía la creación con un error en vez
  de reutilizar) y ata el esquema a una regla de producto que hoy resolvemos mejor en código.
  Descartada por ahora (queda anotada arriba como opción futura).
- **"Reabrir" la orden cancelada** (poner la misma otra vez en `pending_handoff`): perdería el
  registro de que hubo una cancelación y mezclaría los datos de dos pedidos distintos en una sola
  fila. Descartada: el requisito explícito es que la anterior **quede cancelada** y la de hoy sea
  **una orden nueva**.
- **Deduplicar por teléfono/contacto** en vez de por conversación: fuera de alcance; la unidad de
  trabajo del bot es la conversación y `createManualOrder` ya cubre el alta suelta por teléfono.
