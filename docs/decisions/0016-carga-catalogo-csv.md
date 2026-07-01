# ADR-0016: Carga del catálogo desde CSV vía script → `/api/catalog/load`

- **Estado:** Aceptada
- **Fecha:** 2026-07-01
- **Sprint:** post-S5 (ajustes v1.1 — ver docs/09)

## Contexto
El catálogo real llega como CSV (`vitasei-productos-actualizado.csv`, 16 productos). El
pipeline de carga del Sprint 2 ya existe y es completo (`/api/catalog/load` → validación →
vector store → re-hospedaje de imagen en `product-images` → upsert por `sku` →
`catalog_imports`), pero acepta **JSON**, no CSV. Necesitamos poblar `products` con esos datos
para el gate y la **entrega de imágenes** (`image_url`), sin duplicar el pipeline.

Restricción técnica: `runCatalogImport` es `server-only` (usa service-role + OpenAI), así que
no se puede importar desde un script de Node suelto.

## Decisión
Un script Node **sin dependencias** (`scripts/import-catalog-csv.mjs`, `npm run import:catalog`)
que:
- parsea el CSV (parser propio RFC-4180: comillas, comas y saltos dentro de comillas);
- mapea columnas → `products` (`ID→sku`, `Titulo→name`, `Descripcion→description`,
  `Precio→price`, `Imagenes|ImageURL|Imagen→image_url`, `Categoria/Link_producto/…→metadata`);
- valida que cada `ID` sea `#ID<dígitos>` y reporta productos sin imagen;
- hace **POST a `/api/catalog/load`** con `CATALOG_ADMIN_SECRET` (lee env o `.env.local`).

Modo `--dry` para previsualizar el mapeo sin llamar a la API. Las imágenes del CSV son URLs
públicas del CDN; el pipeline las **re-hospeda** en `product-images` (si falla, conserva la
URL del CDN) → URL estable para Callbell.

## Consecuencias
- Reúsa TODO el pipeline S2 (una sola fuente de verdad de validación/carga); el script solo
  traduce CSV→JSON.
- Sin nuevas dependencias (parser CSV a mano) — coherente con "menos servicios/piezas".
- Requiere el server arriba (o desplegado) y el `CATALOG_ADMIN_SECRET`. Aceptable para una
  operación de admin puntual.
- El schema de `products` (migración `0001`) no cambia: soporta `#ID<dígitos>` como `sku`.

## Alternativas consideradas
- **Importar `runCatalogImport` desde el script:** imposible sin levantar Next (`server-only`).
- **Endpoint que reciba `text/csv`:** mete el parseo de CSV en el server; preferimos el CSV en
  un script de admin y el server con un contrato JSON estable.
- **`INSERT` directo a Supabase desde el script:** se saltaría el vector store y la
  validación → rompería la consistencia SKU↔catálogo que exige el gate.
