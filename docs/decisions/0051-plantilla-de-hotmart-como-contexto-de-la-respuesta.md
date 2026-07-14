# ADR-0051: La plantilla de Hotmart que se envió es contexto de la respuesta

- **Estado:** Aceptada
- **Fecha:** 2026-07-14
- **Sprint:** post-5 (mejoras en producción)

## Contexto

El flujo de carrito abandonado de Hotmart (ADR-0035, ADR-0040) funciona: llega el webhook,
se resuelve la plantilla para ese curso (`data.product.id` → `hotmart_templates.product_id`,
ver `pickHotmartTemplate`) y se envía por Callbell. El outbound se guarda en `messages` con
el tag `hotmart-recovery`, así que se ve en el panel.

Pero **la IA nunca vio ese mensaje**. El contexto del agente NO se reconstruye desde
`messages`: viene entero de la cadena de Responses (`conversations.openai_previous_response_id`,
ver `lib/openai/responses.ts`). La plantilla se manda desde el webhook, sin pasar por
`responses.create`, así que no crea ningún response ni encadena nada.

Consecuencia real: cuando el cliente contestaba la plantilla ("¿cuánto vale?", "sí me
interesa"), el modelo recibía `previous_response_id = null` y como `input` solo esa frase
suelta más el marcador `Es flujo hotmart`. **No sabía qué curso le habían ofrecido ni qué le
había dicho**, así que arrancaba de cero y preguntaba lo que ya estaba dicho. Con **varios
cursos** en Hotmart el daño escala: el agente ni siquiera podía saber cuál de ellos vender.

## Decisión

**Anteponer al turno del cliente un bloque de contexto con el curso (id + nombre de Hotmart)
y el texto EXACTO de la plantilla que se le envió** — el mismo patrón que
`prependContactContext` (ADR-0047) y el marcador de Hotmart (ADR-0040): va en el `input` que
ve la IA, **no** en `messages`.

`lib/hotmart/context.ts` · `loadHotmartReplyContext()`:

1. Lee el **último outbound** de la conversación. Si **no** tiene el tag `hotmart-recovery`,
   devuelve `""` y no hace nada más. Ese tag es la compuerta: si el último outbound es la
   plantilla, la IA todavía no ha respondido desde que se envió y el texto **no** está en la
   cadena. En cuanto responde una vez, el bloque ya viajó dentro del `input` y quedó
   encadenado → se deja de inyectar (no se duplica ni se gastan tokens de más).
2. Toma el curso del `hotmart_events` más reciente de esa conversación (si el cliente abandona
   otro carrito, manda el nuevo evento).
3. El texto es el que quedó guardado en `messages`. Si es el respaldo sin texto
   (`[Plantilla Hotmart: …]`, envío legado por env), **re-resuelve la plantilla por producto**
   — la misma búsqueda del webhook — para que el contexto sea la plantilla real de ESE curso.

La compuerta es el **tag**, no `conversations.hotmart_flow`: así funciona aunque la migración
0019 no esté aplicada. **No requiere migración nueva.**

En el webhook (`processEvent.ts`) se añade el evento `hotmart_template_resolved` con
`productId`, `templateId`, `matchedProduct` y `fallbackEnv`: con varios cursos es la forma de
ver, desde el dashboard, si el `product.id` casó con la plantilla de ese curso o si cayó en la
genérica / el fallback por env (que mandaría el mensaje de otro curso).

## Consecuencias

- El agente continúa la conversación **desde la plantilla**: sabe qué curso vender y no repite
  la presentación. Es la diferencia entre vender y volver a empezar.
- Es contexto interno: se le pide a la IA que no lo mencione. El hilo del panel y la extracción
  de la orden quedan **limpios** (no se toca `messages`).
- Se inyecta **una sola vez** por plantilla enviada → el costo en tokens es el del primer turno,
  no el de todos.
- Best-effort: si la lectura falla, se genera la respuesta sin el contexto. Nunca tumba la
  respuesta.
- El bloque queda dentro de la cadena de Responses, así que **sobrevive** a los turnos
  siguientes sin releer nada.

## Alternativas consideradas

- **Encadenar la plantilla en OpenAI al enviarla** (llamar a `responses.create` desde el
  webhook y guardar `openai_previous_response_id`, como hace `retarget.ts`): descartado —
  añade una llamada a OpenAI (costo + latencia) dentro del webhook, que corre con
  `maxDuration = 30` y debe responder 2xx rápido a Hotmart. Y no aporta nada que la inyección
  en el `input` no dé.
- **Reconstruir todo el historial desde `messages` en cada turno**: descartado — rompe el
  principio de "IA simple, una sola llamada" y tira a la basura la cadena de Responses, que ya
  es la fuente del contexto para el resto del producto.
- **Guardar la plantilla en el inbound del cliente** (`messages.content`): descartado por la
  misma razón que en ADR-0040 — ensucia el hilo del panel y contamina la extracción de la orden.
