# ADR-0011: Extracción de la orden con una completion estructurada

- **Estado:** Aceptada
- **Fecha:** 2026-07-01
- **Sprint:** 5

## Contexto
Al cerrar la venta (`#orden-lista`) hay que crear `orders` + `order_items` con **ítems y datos
de envío**. Esos datos están dispersos en la conversación (el agente los recolecta en lenguaje
natural), no en un tag. Se necesitaba una forma de obtenerlos estructurados. El dueño pidió
mantener la IA simple: **una** llamada a Responses por mensaje normal.

## Decisión
Usar una **completion aparte con salida estructurada** (`chat.completions.create` +
`response_format: json_schema`, `strict`) que lee el transcript de la conversación y devuelve
la orden en JSON (`items[]`, `shipping`, `fulfillment_method`, `notes`, `total`). Se ejecuta
**solo al cerrar** (`#orden-lista`), no en cada mensaje. El transcript se arma desde `messages`
(fuente de verdad). La lógica de armado (transcript, total, normalización de ítems) es pura y
está testeada; el schema fuerza que el modelo no invente (lo ausente va `null`).

## Consecuencias
- **Bueno:** el flujo por mensaje sigue siendo 1 llamada; la extracción es determinista
  (schema estricto) y aislada; no acopla el prompt de venta con el formato de orden.
- **Malo / atado a futuro:** hay **una** llamada extra al cerrar la orden (costo/latencia, pero
  puntual, no por mensaje). Si el transcript es largo, sube tokens — mitigable acotando N
  mensajes (hoy 40). La calidad de la orden depende de que el agente haya recolectado los datos.

## Alternativas consideradas
- **(a) El modelo emite JSON junto al tag `#orden-lista`:** cero llamadas extra, pero ensucia
  el prompt de venta y arriesga romper el mensaje visible al cliente si el formato falla.
- **(c) Orden mínima (solo método + handoff), logística completa el resto:** más simple pero
  pierde la captura estructurada de ítems/envío que sí está en la conversación.
- Elegimos (b) por pedido explícito del dueño: los resúmenes de orden salen de una completion
  estructurada.
