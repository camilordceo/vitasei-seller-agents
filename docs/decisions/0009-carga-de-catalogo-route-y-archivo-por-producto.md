# ADR-0009: Carga de catálogo — route handler y un archivo por producto

- **Estado:** Aceptada
- **Fecha:** 2026-06-30
- **Sprint:** 2

## Contexto
El Sprint 2 necesita un mecanismo para cargar/sincronizar el catálogo: subir texto al vector
store de OpenAI (`file_search`), hacer upsert estructurado en `products` por `sku`, subir
imágenes a `product-images` y registrar el import en `catalog_imports`. La doc 05 deja abierto
si el texto va como **un documento del catálogo** o **un archivo por producto**, y el schema
tiene `products.vector_store_file_id` (singular, por fila). El entorno Windows tuvo fricción
con scripts de Node vía `cmd.exe` (ver sprint-01), lo que pesa contra un script CLI suelto.

## Decisión
1. **Route handler** `POST /api/catalog/load` (no un script): corre server-side con acceso a
   env + service-role + OpenAI, es desplegable en Vercel y evita la fricción de scripts en
   Windows. `runtime=nodejs`, `maxDuration=300` por el poll del vector store.
2. **Un archivo por producto** en el vector store: cada SKU genera su `.md`, se sube con
   `vectorStores.files.uploadAndPoll` (espera `completed`) y su `file_id` se guarda en
   `products.vector_store_file_id`. Mejor granularidad de retrieval y mapeo 1:1 con la fila.
3. **Lógica pura separada** (`lib/openai/catalog.ts`): validación, generación de documento y
   rutas de imagen, sin I/O, testeada con Vitest. La orquestación vive en `catalogLoader.ts`.
4. **Imagen best-effort:** se re-hospeda en `product-images` (desde URL remota o base64); si
   falla, no tumba el import — se conserva la URL original y se reporta un `warning`.
5. **Auth:** secret opcional `CATALOG_ADMIN_SECRET` (Bearer o `x-admin-secret`); si no está
   seteado, la route queda abierta en dev (mismo patrón que el secret del webhook).

## Consecuencias
- **Bueno:** SKU consistente por construcción (texto y fila salen de la misma fuente
  validada); el gate del `#ID` se sostiene; trazabilidad por import; reusable como sync.
- **Malo / atado a futuro:** N round-trips a OpenAI (uno por producto) — bien para 5–50
  productos; para catálogos grandes habría que migrar a `fileBatches.uploadAndPoll`. La route
  abierta sin secret es solo para dev; en prod hay que setear `CATALOG_ADMIN_SECRET`. No hay
  borrado de archivos viejos del vector store al re-cargar (posible huérfanos) — deuda para S7.

## Alternativas consideradas
- **Un solo documento del catálogo:** menos llamadas, pero no llena `vector_store_file_id`
  por fila ni permite actualizar/borrar por producto; peor granularidad de retrieval.
- **Script CLI (`tsx`):** chocaba con la fricción de Node vía `cmd.exe` en Windows y no es
  desplegable; un endpoint se invoca igual desde el dashboard a futuro.
- **Subir imágenes sin re-hospedar (solo guardar URL externa):** más simple, pero ata la
  imagen del `#ID` a un host externo que puede caerse; el bucket propio da control.
