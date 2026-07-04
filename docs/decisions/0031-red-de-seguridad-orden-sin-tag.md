# ADR-0031: Red de seguridad — inferir la orden cuando el modelo cierra sin `#orden-lista`

- **Estado:** Aceptada
- **Fecha:** 2026-07-04
- **Sprint:** post-5 (operación)

## Contexto

La orden se crea, se avisa al dueño y se hace handoff **solo** cuando el modelo emite el tag
`#orden-lista` (`lib/agent/processMessage.ts`). En producción apareció un caso real (conversación
de Maria Elena Cardona, contra entrega, TOTAL $139.800) donde el bot **cerró la venta** —confirmó
el pedido ("tu pedido queda confirmado"), agradeció la compra ("¡Gracias por tu compra!"), y ya
tenía método + ítems + nombre + dirección + ciudad + teléfono— pero emitió **`#compra-contra-entrega`
en lugar de `#orden-lista`**. `#compra-contra-entrega` solo fija el `fulfillment_method`, no crea la
orden. Resultado: "Sin orden todavía" en el dashboard y **ningún aviso al dueño**. Es una venta
perdida operativamente (nadie la despacha) por un fallo de fiabilidad del modelo con los tags.

Es una IA simple (una sola llamada por mensaje, sin loop de tools). No queremos meter una segunda
llamada de clasificación por cada mensaje solo para atrapar este caso.

## Decisión

Añadir una **red de seguridad determinista en el backend** que infiere el cierre de la orden aunque
falte `#orden-lista`:

1. Función pura `isPurchaseConfirmation(cleanText)` (`lib/agent/order.ts`): detecta frases de cierre
   **estrictas** ("queda/quedó confirmado", "pedido/compra/orden (está) confirmad@", "gracias por tu
   compra/pedido"), sin depender de tildes. Deliberadamente estrecha para NO disparar al arrancar la
   recolección de datos.
2. En `generateAndSend`, si el mensaje **no** trae `#orden-lista`/`#humano`, el texto es un cierre
   confirmado **y** el `fulfillment_method` de la conversación ya está decidido (`cod`/`addi`) →
   `inferredClose = true` y se crea la orden por el **mismo camino** que `#orden-lista`
   (`extractOrder` + insert + aviso al dueño).
3. El cierre inferido crea la orden y **avisa**, pero **NO fuerza handoff** (no apaga el bot ni
   reasigna a logística). Menor radio de impacto si el heurístico se equivoca. El handoff sigue
   siendo exclusivo de `#orden-lista`/`#humano`.
4. **Idempotencia**: antes de crear se verifica si la conversación ya tiene orden; si existe, se
   reutiliza su id (no se duplica ni se re-avisa). Aplica también al camino explícito `#orden-lista`.
5. Cuando hay orden capturada no se agendan retargets ("¿sigues ahí?").
6. Trazabilidad: evento `order_inferred` al inferir y `order_created.inferred=true` en la creación.

Complementa (no reemplaza) el endurecimiento del `system_prompt` en el dashboard para que el modelo
distinga `#compra-contra-entrega` (elige método → recolectar datos) de `#orden-lista` (cierre con
todo listo).

## Consecuencias

- **Bueno:** dejamos de perder ventas por un tag olvidado; el dueño recibe el aviso; la orden aparece
  en el dashboard. Sin llamadas extra a la IA (solo lógica + un `extractOrder`, que ya corría al
  cerrar). Idempotente ante cierres dobles o coincidencia heurístico + `#orden-lista`.
- **Malo / riesgo:** un falso positivo crearía una orden con datos incompletos (lo que `extractOrder`
  logre extraer) y un aviso al dueño. Se mitiga con: frases muy estrictas, exigir método ya decidido,
  no forzar handoff, e idempotencia (a lo sumo **una** orden espuria por conversación).
- **Atado a futuro:** la lista de frases de cierre es en español y hay que ampliarla si cambia el tono
  del prompt. Si más adelante se quiere que el cierre inferido también haga handoff, es un cambio de
  una línea (`isHandoff`), pero hoy se prefiere la cautela.

## Alternativas consideradas

- **Solo endurecer el prompt.** Necesario pero insuficiente: los LLM olvidan tags de forma
  intermitente; sin red de backend el fallo reaparece y se pierden ventas en silencio.
- **Segunda llamada LLM de clasificación ("¿cerró la orden?") por mensaje.** Rompe el principio de
  "IA simple, una llamada por mensaje" y añade costo/latencia a cada turno.
- **Crear la orden con `#compra-contra-entrega`.** Falso: ese tag se emite al *elegir* el método,
  antes de tener los datos; crearía órdenes vacías en cada inicio de flujo COD.
