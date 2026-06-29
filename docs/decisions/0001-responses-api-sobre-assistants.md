# ADR-0001: Usar OpenAI Responses API + file_search en vez de Assistants API

- **Estado:** Aceptada
- **Fecha:** 2026-06-29
- **Sprint:** diseño (pre-0)

## Contexto
Necesitamos que el agente responda preguntas de producto sobre el catálogo cargado (RAG).
OpenAI ofrece file_search vía Assistants API y, ya con paridad de features, vía Responses API.
La **Assistants API se apaga el 26 de agosto de 2026**.

## Decisión
Construir sobre **Responses API** con la tool nativa `file_search` y **vector stores**.

## Consecuencias
- No quedamos atados a una API que se deprecia a mitad de año.
- file_search es hosted: OpenAI hace chunking/embeddings/ranking; no mantenemos pipeline de retrieval.
- Estado de conversación vía `previous_response_id`, con Supabase como fuente de verdad de respaldo.
- Costo: tarifa por llamada de file_search + storage del vector store; controlar con `max_num_results`.

## Alternativas consideradas
- **Assistants API:** descartada por deprecación.
- **RAG propio con pgvector en Supabase:** más control pero más mantenimiento; innecesario para v1.
