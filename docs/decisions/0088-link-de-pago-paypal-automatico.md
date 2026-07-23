# ADR-0088: Link de pago de PayPal automático al cerrar con `#paypal`

- **Estado:** Aceptada
- **Fecha:** 2026-07-23
- **Sprint:** —

## Contexto

El agente de EE.UU. cierra ventas con PayPal, pero el link de pago se armaba **a mano**
por cada cliente: alguien entraba a PayPal, creaba el cobro con el monto y lo pegaba en
el chat. Con una campaña de cientos de leads eso no escala — el cliente caliente espera
minutos u horas por un link que el sistema ya sabe armar (la orden trae productos,
cantidades y precios).

Ya existía la mitad del camino: los métodos de pago por agente (ADR-0055) hacen que el
tag `#paypal` marque el método y genere la orden. Faltaba que el link saliera solo.

Opciones de API de PayPal evaluadas:

1. **Orders v2 (Checkout):** el link `checkoutnow?token=…` exige un `return_url` y una
   **captura server-side** cuando el comprador vuelve del redirect. En el webview de
   WhatsApp ese "volver" es frágil: si el cliente aprueba y cierra el navegador, la
   orden queda APPROVED pero **sin capturar — la plata no entra**. Requiere además una
   página de retorno propia.
2. **Invoicing v2:** el invoice se envía con `send_to_recipient: false` (nada de email;
   pasa a UNPAID) y `detail.metadata.recipient_view_url` es un **link pagable por sí
   solo** — PayPal o tarjeta, cobro y recibo incluidos, sin captura ni página nuestra.
   Soporta ítems con precio, impuesto (%) por ítem y costo de envío en el breakdown.

## Decisión

**Invoicing v2.** Es la única de las dos donde el link cobra solo — exactamente lo que
un flujo de WhatsApp necesita. Concretamente:

1. **Config POR AGENTE** en `agents.paypal_config` (jsonb, migración `0034`):
   `client_id`, `client_secret` (write-only en el dashboard, como las demás
   credenciales), `sandbox`, `message` (el texto que acompaña el link, con `{link}`
   como placeholder), `tax_percent` y `shipping`. Sin credenciales → feature apagado y
   todo sigue como hoy. Cada marca/mercado tiene su propia cuenta de PayPal.

2. **Disparo con señal del TURNO, no con el estado.** El link se genera cuando hay
   orden Y (el modelo emitió `#paypal` en este turno O la orden se acaba de crear con
   ese método). Usar solo `fulfillment_method === 'paypal'` habría reenviado el link en
   **cada** mensaje posterior de la conversación.

3. **Idempotencia por orden** (`orders.payment_link` / `payment_link_id`): la misma
   orden nunca genera dos invoices. Si el tag vuelve a salir ("mándame el link otra
   vez"), se **reenvía el mismo link**. El link se ancla a la orden **antes** de
   enviarse, para que un fallo de envío no cree un segundo invoice al reintentar.

4. **El tag `#paypal` se reconoce SIEMPRE que haya config**, aunque el operador no lo
   haya agregado a los métodos de pago (se inyecta virtual: tag `#paypal`, método
   `paypal`). Sin esto, un tag no configurado **se le escaparía al cliente en el
   texto** — el peor desenlace posible.

5. **Best-effort de punta a punta:** cualquier fallo (credenciales malas, sin montos,
   PayPal caído) se loguea en `events_log` (`paypal_link_sent` / `paypal_link_resent` /
   `paypal_link_skipped` / `paypal_link_failed`) y **jamás rompe la respuesta**: la
   venta ya quedó registrada y avisada; el operador manda el link a mano como antes.

6. **Montos:** los ítems del invoice salen de `order_items` (los sin precio se omiten);
   si ninguno trae precio pero la orden tiene `total`, va un solo ítem "Pedido {marca}"
   por el total; sin ningún monto cobrable no hay link (skip logueado). El impuesto va
   como % por ítem y el envío como monto fijo del breakdown — PayPal calcula y muestra
   el desglose al cliente.

## Consecuencias

- El cierre de venta en EE.UU. queda 100% automático: tag → orden → invoice → link por
  WhatsApp con el mensaje configurado, en el mismo turno.
- Cuatro llamadas HTTP a PayPal por link (OAuth + create + send + get), solo en cierres
  con `#paypal`; corren en el background (`waitUntil`) después de responder al cliente.
- El estado "pagado" NO se rastrea aún: el dueño lo ve en su panel de PayPal (cada
  invoice lleva el id de la orden como `reference`). Backlog: webhook
  `INVOICING.INVOICE.PAID` para marcar la orden pagada sola.
- `parseDecimal` acepta lo que la gente teclea ("7.25", "7,25", "$5.99", "8 %").
- Guardar un agente exige la migración `0034` aplicada (mismo criterio que la 0026 y
  la 0028: fallar con mensaje accionable antes que guardar ignorando lo escrito).
