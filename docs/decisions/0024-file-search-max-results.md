# ADR-0024: Subir `max_num_results` de file_search (5 → 20, configurable)

- **Estado:** Aceptada
- **Fecha:** 2026-07-03
- **Sprint:** —  (fix operativo post-Sprint 6)

## Contexto
El agente respondía "no tengo esa info" o evitaba dar los **precios de envío**, pese a que
esa información **sí estaba en el vector store**, en un archivo aparte de los documentos de
producto (subido por fuera del pipeline de catálogo). En el **playground de OpenAI** la misma
consulta contra el mismo vector store **sí** devolvía el archivo de envíos.

`file_search` es hosted: OpenAI recupera los top-K fragmentos más similares a la consulta y el
modelo responde con eso (ver ADR-0001/0010). Nuestro código fijaba `max_num_results: 5`
(pensado para bajar tokens/latencia). Con un catálogo de decenas de archivos (uno por
producto, ver ADR-0009), una consulta como "¿cuánto vale el envío?" compite con muchos docs de
producto y el archivo de tarifas de envío puede caer fuera del top-5. El playground usa **20**
por defecto — de ahí la diferencia de comportamiento entre playground y producción.

## Decisión
Subir el default de `max_num_results` de **5 a 20** (paridad con el playground) y hacerlo
configurable con la env `FILE_SEARCH_MAX_RESULTS` (default 20). Se aplica a las dos llamadas a
`generateReply`: la respuesta normal (`processMessage`) y los seguimientos (`retarget`).

## Consecuencias
- **Bueno:** más recall — un archivo "aparte" (envíos, políticas, FAQs) entra al contexto y el
  modelo lo usa. Cierra el gap playground↔producción sin tocar el prompt ni el schema.
- **Malo:** más tokens de input y algo más de latencia por llamada (hasta ~4× el contexto de
  retrieval). Aceptable con `gpt-5-mini`; se puede bajar por env si el costo lo pide.
- **Atado a futuro:** el gate anti-alucinación de `#ID` no cambia — un `#ID` solo se envía si el
  SKU existe en `products`. Subir el recall no afecta esa garantía.

## Alternativas consideradas
- **Meter las tarifas de envío en cada doc de producto:** duplicación y drift; un solo archivo
  de envíos es más limpio.
- **Un vector store aparte para políticas/envíos:** más complejidad de gestión; con un solo
  store y `max_num_results` mayor basta para v1.
- **Bajar el umbral con `ranking_options.score_threshold`:** no ayuda al problema (el archivo
  quedaba fuera por ranking relativo, no por umbral) y es más difícil de calibrar.
