# ADR-0048: Catálogo como UN solo documento en el vector store

- **Estado:** Aceptada (reemplaza la decisión #2 de ADR-0009)
- **Fecha:** 2026-07-10
- **Sprint:** post-MVP

## Contexto

La carga de catálogo (ADR-0009) subía **un archivo `.md` por producto** al vector
store de OpenAI, en serie, esperando el procesamiento de cada uno
(`vectorStores.files.uploadAndPoll`). El propio ADR-0009 marcó dos deudas:

1. **N round-trips secuenciales** — "bien para 5–50 productos; para catálogos
   grandes habría que migrar".
2. **Sin borrado de archivos viejos al recargar** — huérfanos acumulados.

En la práctica (1) rompió el flujo del dashboard: al crear una IA nueva y cargar el
catálogo, el *server action* (sin el `maxDuration=300` de la route) se pasaba del
límite de ejecución subiendo producto por producto, la función moría a mitad y el
cliente recibía `undefined` → *"Cannot read properties of undefined (reading
'ok')"*. Un catálogo de 16 productos ya lo disparaba.

El gate anti-alucinación del `#ID` valida contra la tabla `products` (no contra el
vector store), y las imágenes del `#ID` salen de `products.image_url` (Supabase
Storage). El vector store solo alimenta el conocimiento de `file_search`. Es decir,
**cómo se indexa el catálogo en OpenAI es independiente del gate y de las imágenes**.

## Decisión

Subir el catálogo como **UN solo documento** al vector store en vez de uno por SKU:

1. El loop de importación ya **no** llama a OpenAI por producto: solo re-hospeda la
   imagen (Storage) y hace upsert en `products`.
2. **El documento se reconstruye desde TODO el catálogo del agente en la BD**
   (`loadAgentCatalogForDoc` + `buildCatalogDocument`), no solo desde los productos del
   request. Por eso cargar un subconjunto (incluso **un** producto) es un **MERGE**: se
   agrega/actualiza ese SKU y **no se pierde del store lo que ya existía**. Es la clave
   para "agregar un producto sin borrar lo demás".
3. `buildCatalogDocument` (puro) concatena la sección markdown de cada producto
   (`buildProductDocument`, con el `SKU (#ID)` prominente arriba) separadas por `---`.
4. `uploadCatalogDocument` sube ese único archivo con `uploadAndPoll` (una sola espera);
   su `file_id` se fija en `products.vector_store_file_id` de **todas** las filas del
   agente en una sola `update`.
5. `deleteVectorStoreFiles` **purga** los archivos anteriores del agente (recolectados
   de `products.vector_store_file_id` ANTES de subir el nuevo) — best-effort, nunca rompe
   la carga. Salda la deuda de huérfanos y limpia los N archivos del esquema anterior.

**Dashboard** (`AgentEditor`): además de "Crear vector store nuevo" y "Ya tengo vector
store" (solo Supabase), un tercer modo **"Agregar / actualizar productos"** (`add` →
`vectorStoreMode: "sync"`) que **mantiene** el store del agente y hace el merge. Es el
default al editar un agente que ya tiene store.

`supabase-only` sigue igual (no sube ni toca `vector_store_file_id`).

## Consecuencias

- **Bueno:** una sola llamada a OpenAI por carga → se acaba el timeout; crear una IA
  nueva con catálogo funciona desde el dashboard. Sin huérfanos: cada carga deja el
  store con exactamente un documento del catálogo por agente.
- **Bueno:** menos piezas móviles, alineado con "IA/infra simple".
- **Trade-off (retrieval):** `file_search` trocea el documento (~800 tokens/chunk con
  solapamiento). Con secciones cortas y el SKU al inicio de cada una, el retrieval por
  producto se mantiene; para descripciones muy largas un producto podría partirse
  entre chunks. Aceptable para el tamaño de catálogo de Vitasei; si algún día crece a
  miles de SKUs con fichas largas, evaluar `fileBatches.uploadAndPoll` (N archivos en
  un solo poll) para recuperar granularidad sin volver a N round-trips secuenciales.
- **`vector_store_file_id` deja de ser 1:1 con la fila** (ahora todas comparten el id
  del documento del catálogo). Era solo trazabilidad: nada del gate ni del envío lo
  usaba.
- **Idempotencia intacta:** upsert por `(agent_id, sku)`; recargar/batchear sigue sin
  duplicar.
- **Agregar un producto es seguro** (merge desde la BD) en los modos que sincronizan
  docs (`create`/`sync`). En `supabase-only` el producto entra a `products` pero NO al
  store (la IA no lo "conoce" por `file_search`): para eso está el modo `add`.
- **Costo del merge:** cada carga relee el catálogo completo de la BD y re-sube el
  documento entero. Trivial para catálogos modestos; si crecen mucho, ver la salida de
  `fileBatches` abajo.

## Alternativas consideradas

- **Subir el JSON crudo:** más literal al pedido, pero `file_search` trocea peor un
  JSON (objetos partidos, prosa embebida). Un markdown por secciones con el SKU
  prominente recupera mejor y reusa `buildProductDocument` ya probado.
- **`fileBatches.uploadAndPoll` (N archivos, un poll):** conserva granularidad 1:1 y
  evita el timeout, pero mantiene los huérfanos y es más complejo. Innecesario para el
  tamaño actual; queda como salida si el catálogo escala mucho.
- **Mantener N archivos y solo paralelizar/lotear:** no elimina los huérfanos ni
  simplifica; sigue con más piezas que un único documento.
