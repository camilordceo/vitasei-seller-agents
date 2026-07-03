# 05 — OpenAI: Responses API + File Search + carga de catálogo

> Importante: la **Assistants API se apaga el 26 de agosto de 2026**. Construimos sobre
> **Responses API** con la tool nativa `file_search` y **vector stores** (ya con paridad de features).

## 1. Vector store (catálogo)

Setup en 3 pasos (una vez, luego se actualiza):
1. Subir archivos del catálogo al File API.
2. Crear un **vector store** (`name: vitasei-catalog`).
3. Agregar los archivos al vector store y **esperar a que el procesamiento quede `completed`** (poll de status) antes de usarlo.

Guardar el `vector_store_id` en `OPENAI_VECTOR_STORE_ID` y en `agent_config.vector_store_id`.

> Consejo (de la doc): vector stores enfocados por dominio dan mejores resultados que uno gigante con todo mezclado. Para v1 con un solo catálogo basta uno.

## 2. Llamada de razonamiento (Responses API)

```ts
const response = await openai.responses.create({
  model: process.env.OPENAI_MODEL,            // ej. gpt-5.1
  instructions: agentConfig.system_prompt,    // system prompt versionado
  input: turnInput,                           // mensaje actual (o historial reciente)
  previous_response_id: convo.openai_previous_response_id ?? undefined,
  tools: [{
    type: "file_search",
    vector_store_ids: [process.env.OPENAI_VECTOR_STORE_ID],
    max_num_results: 20                        // recall vs tokens (env FILE_SEARCH_MAX_RESULTS, ADR-0024)
  }],
  temperature: agentConfig.temperature
});
```

- Guardar `response.id` en `conversations.openai_previous_response_id` para encadenar el siguiente turno.
- Extraer el **texto** del output del modelo (el bloque de texto, no el `file_search_call`).
- file_search es **hosted**: OpenAI ejecuta la búsqueda y el modelo responde con citaciones; no manejamos pipeline de retrieval.

## 3. Estado de conversación

- v1: usar `previous_response_id` cuando exista.
- Fallback / robustez: si no existe o la conversación es vieja, reconstruir `input` con los últimos N mensajes desde `messages` (Supabase = fuente de verdad).

## 4. Carga / sync de catálogo (pipeline)

Cuando llega un catálogo nuevo (CSV/Excel/PDF de productos):

1. **Texto → vector store:** generar un archivo de texto/markdown por producto o un documento del catálogo, subirlo al File API y agregarlo al vector store. Guardar `vector_store_file_id`.
2. **Estructurado → `products`:** upsert por `sku` con `name`, `description`, `price`, `currency`, `in_stock`, `metadata`, y `vector_store_file_id`.
3. **Imágenes → Storage:** subir imágenes al bucket `product-images`, setear `products.image_url`.
4. Registrar en `catalog_imports` (status, rows_imported, errores).

> **El SKU debe coincidir** entre el texto del catálogo (lo que el agente lee) y la fila en `products` (de donde sale la imagen). Si no coincide, el `#ID` no encuentra imagen. Validarlo en la importación.

## 5. Costos a tener presente

- file_search: tarifa por llamada + almacenamiento del vector store (storage por GB/día). `max_num_results` bajo ayuda a tokens/latencia. Monitorear en `events_log` el conteo de llamadas.
