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

Una conversación puede tener **varias órdenes**. La creación se distingue por origen:

1. **Bot (automático)** — `lib/agent/processMessage.ts`: idempotencia por **orden ACTIVA**. Una
   orden `cancelled` no cuenta como activa: reutiliza una orden previa solo si `status <>
   'cancelled'` (filtro `.neq("status","cancelled")` + `order by created_at desc limit 1`); si no
   hay ninguna activa (nunca tuvo, o todas canceladas), **crea una nueva** y avisa al dueño. La
   idempotencia sigue viva porque el bot crea sin intervención humana y no debe duplicar por
   ráfaga de mensajes.
2. **Manual (acción humana)** — `createOrderForConversation` en `app/dashboard/actions.ts`, detrás
   del botón "Crear orden / Crear otra orden" del panel de la conversación: **siempre crea una
   orden nueva** anclada a la conversación. No deduplica: el operador decide cuándo hay otra orden
   (p. ej. la anterior quedó cancelada y hoy pidió de nuevo). Es el mismo criterio que
   `createManualOrder` de la sección Órdenes (que además crea su propia conversación).

**Asociación orden ↔ conversación (bidireccional y visible):**
- El **panel de la conversación** lista **todas** sus órdenes (más nueva primero) con estado,
  total, fecha, ítems y envío, cada una con enlace **"Ver / editar orden"**, más el botón "Crear
  otra orden". `getConversation` pasa de devolver `order` (una) a `orders: ConversationOrder[]`.
- El **detalle de una orden** ya enlaza de vuelta con **"Ver conversación"**
  (`/dashboard/conversations/{conversation_id}`), así que desde la orden siempre se llega a su
  conversación.

No se toca la base de datos (no hace falta migración): `orders.conversation_id` siempre fue una FK
sin `UNIQUE`, así que ya soportaba varias órdenes por conversación.

## Consecuencias

- **Bueno:** el caso "canceló y volvió a pedir" funciona por los dos caminos (bot y manual). La
  orden previa queda cancelada intacta; la nueva nace con la fecha de hoy, cuenta en
  órdenes/reportes y (por el bot) **avisa al dueño**. Desde la conversación se ven, editan y crean
  varias órdenes; desde cada orden se vuelve a la conversación. Consistente con el idioma "orden
  activa" que ya usaban las guardas de compra de retargets/reactivaciones.
- **Idempotencia del bot intacta dentro de una misma venta:** apenas nace la orden queda
  `pending_handoff` (activa), así que los mensajes siguientes de esa misma ráfaga la reutilizan y
  no duplican.
- **A tener en cuenta:** el botón manual crea una orden cada vez que se pulsa (puede quedar alguna
  en blanco si el operador se arrepiente; se marca Cancelada y listo). Los reportes cuentan
  "transacciones = órdenes no canceladas por su `created_at`", así que cada orden nueva suma una
  transacción sin doble conteo, y las canceladas no suman.
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
