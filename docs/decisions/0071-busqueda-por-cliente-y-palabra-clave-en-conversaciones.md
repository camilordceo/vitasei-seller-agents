# ADR-0071: Búsqueda por cliente y por palabra clave en Conversaciones

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** post-v1 (mejoras dashboard)

## Contexto

La lista de Conversaciones filtra por agente, fechas, etiqueta, producto, estado, pedido y
llamada, pero no había forma de **encontrar a un cliente concreto** (por nombre o teléfono)
ni de encontrar conversaciones **donde se dijo algo específico** ("contra entrega",
"factura", el nombre de un producto). Para eso tocaba paginar a ojo.

Restricciones conocidas del stack (mismas de ADR-0053 y del filtro "sin etiqueta"):

- PostgREST no hace joins arbitrarios cómodos → los filtros que cruzan tablas se resuelven
  como **conjunto de ids** y luego `.in(...)` sobre `conversations`.
- Un `.in(...)` con miles de UUIDs revienta la URL (400 comprobado con "sin etiqueta").
- Los teléfonos se guardan **E.164 sin `+`** (`573XXXXXXXXX`), pero el usuario los teclea
  con `+`, espacios o guiones.

## Decisión

Dos filtros de texto libre en la lista (query params `q` y `kw`), aplicados con
Enter/botón (no letra a letra: cada búsqueda es una consulta al servidor):

1. **Cliente (`q`)** — busca en `contacts` por `name ilike` **y**, si el término trae
   dígitos, por `phone ilike` con **solo los dígitos** (así `+57 300 123` encuentra
   `57300123…`). Los ids resultantes acotan `conversations.contact_id`. Tope **200
   contactos**.
2. **Palabras clave (`kw`)** — busca en `messages.content ilike` (con `%`/`_` escapados),
   toma los **mensajes coincidentes más recientes** (tope 1000, el máximo de PostgREST),
   dedupe a máximo **200 conversaciones** y las intersecta con los conjuntos de
   etiqueta/llamada, igual que los filtros existentes.

Ambos conviven con todos los demás filtros y con la paginación; el término viaja en la URL
(máx. 60 caracteres) y se preserva al cambiar cualquier otro filtro.

## Consecuencias

- Se puede saltar directo a la conversación de un cliente o auditar qué conversaciones
  mencionan una palabra, combinando con agente/fechas/etiqueta.
- **Topes visibles:** con un término genérico ("hola") la palabra clave muestra las ~200
  conversaciones con coincidencia más reciente, no todas. Aceptable en volumen v1; si
  crece, la salida es una **RPC con full-text search** (`to_tsvector`) en la base.
- `ilike` sin índice trigram hace scan de `messages`; en volumen v1 es barato. Si algún
  día duele: índice `pg_trgm` o la misma RPC.
- Cero migraciones: todo se resuelve con columnas existentes.

## Alternativas consideradas

- **Buscar letra a letra (debounce en el cliente):** una consulta por pulsación contra
  Supabase sin índice de texto; innecesario para un dashboard interno. Enter basta.
- **Filtrar en JS sobre la ventana ya traída** (patrón "sin etiqueta"): solo vería los
  mensajes de las conversaciones de la ventana actual y el fetch de mensajes ya viene
  capado a 1000 filas por PostgREST → resultados incompletos de forma silenciosa.
- **Full-text search (RPC + `tsvector`) desde ya:** más potente (acentos, ranking), pero
  exige migración + función SQL para una necesidad que hoy resuelve `ilike`. Queda como
  evolución declarada.
