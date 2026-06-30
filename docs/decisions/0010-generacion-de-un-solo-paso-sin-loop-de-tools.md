# ADR-0010: Generación de un solo paso (sin loop de tools)

- **Estado:** Aceptada
- **Fecha:** 2026-06-30
- **Sprint:** 3

## Contexto
La doc de arquitectura describía el procesamiento como un "loop de razonamiento"
(`SENSE → REASON → PROPOSE → GATE → ACT → LOG`). El término "loop" generaba la idea de que
el agente itera o hace varias llamadas al modelo por respuesta. No es así: con la Responses
API + `file_search` (hosted), OpenAI ejecuta la búsqueda en el vector store y devuelve la
respuesta final en **una sola** llamada. El producto es una IA simple de venta, no un agente
con tool-calling iterativo.

## Decisión
La respuesta de cada mensaje se produce con **una sola** `responses.create`. El texto que
devuelve se parsea (quitar tags → `cleanText`), se guarda como mensaje y se envía. No se
implementa loop de tools ni razonamiento multi-paso. La documentación se ajusta: el "flujo
por mensaje" es **generar (1 llamada) → preparar (tags + gate) → enviar → guardar**; cada
paso (salvo la llamada) es código determinista barato (parseo + un lookup en `products`).

## Consecuencias
- **Bueno:** menos latencia, menos costo (1 llamada), menos superficie de error; el código
  es más fácil de razonar; coincide con el modelo mental del dueño del producto.
- **Malo / atado a futuro:** si en el futuro se necesitara una tool propia (no `file_search`),
  habría que introducir un ciclo de tool-calling — quedaría como decisión nueva, no es el caso
  de v1. El "gate" sigue siendo obligatorio, pero es un chequeo, no razonamiento.

## Alternativas consideradas
- **Agente con loop de tool-calling:** innecesario porque `file_search` es hosted; añadiría
  llamadas, latencia y complejidad sin beneficio en v1.
- **Mantener el nombre "loop de razonamiento":** descartado por inducir a error; el flujo se
  renombró a "flujo por mensaje" / "generación".
