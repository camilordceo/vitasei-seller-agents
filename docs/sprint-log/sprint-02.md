# Sprint 02 — Catálogo: vector store + products + storage

- **Fecha / sesión:** 2026-06-30
- **Estado:** En progreso — código y verificación local listos; aceptación bloqueada por credenciales

## Objetivo
Carga/sync de catálogo: subir texto al File API y crear/actualizar el vector store esperando
`completed`; upsert estructurado en `products` por `sku` (validando SKU↔catálogo); subir
imágenes a `product-images` y setear `image_url`; registrar en `catalog_imports`.
**Aceptación:** cargar un catálogo de prueba (5–10 productos) deja vector store `completed`,
filas en `products` con imagen, y SKUs consistentes.

## Qué se hizo
- **Route** `POST /api/catalog/load` (`runtime=nodejs`, `maxDuration=300`), protegida por
  `CATALOG_ADMIN_SECRET` opcional (Bearer / `x-admin-secret`; abierta en dev sin secret).
- **Lógica pura** (`lib/openai/catalog.ts`): `validateCatalog` (SKUs presentes/únicos, name,
  price), `buildProductDocument` (markdown con el SKU prominente), `productToRow`,
  `imageStoragePath` / `extensionForContentType` / `parseImageData`.
- **Orquestación** (`lib/openai/catalogLoader.ts`): por producto → documento a vector store
  (`vectorStore.ts` con `uploadAndPoll`, espera `completed`, guarda `vector_store_file_id`),
  imagen a Storage (`lib/supabase/storage.ts`, re-hospedaje best-effort), upsert por `sku`;
  reuso/creación del vector store; persistencia de `vector_store_id` en `agent_config` activo;
  trazabilidad en `catalog_imports` (processing → completed/failed).
- **Cliente OpenAI** lazy (`lib/openai/client.ts`), build-safe.
- **Tests** (Vitest): 11 casos de la lógica pura, incluyendo SKU duplicado y price inválido.

## Criterio de aceptación
- [x] **Verificación local** — `npm run typecheck` ✓, `npm test` (11/11) ✓, `npm run build` ✓
  (la route aparece como función dinámica `/api/catalog/load`).
- [ ] **Vector store `completed`** — pendiente: requiere `OPENAI_API_KEY`. Validación: `POST`
  un catálogo de prueba → la respuesta trae `vectorStoreId` y `products[].vectorStoreFileId`
  sin warnings de status.
- [ ] **Filas en `products` con imagen + SKUs consistentes** — pendiente: requiere Supabase
  aprovisionado (proyecto + migraciones + bucket). Validación: `products` con `image_url`
  pública y `vector_store_file_id`; `catalog_imports.status = completed`.

> Sin credenciales no se puede correr el pipeline I/O end-to-end; la lógica que sostiene el
> gate (validación SKU↔catálogo) sí queda verificada con Vitest.

## Desviaciones del PRD
- Se implementó como **route handler** en vez de script CLI (despliegue + fricción de Node
  vía `cmd.exe` en Windows). Ver ADR-0009.
- Se eligió **un archivo por producto** en el vector store (la doc 05 dejaba ambas opciones);
  llena `products.vector_store_file_id` por fila. Ver ADR-0009.

## Decisiones nuevas
- [ADR-0008](../decisions/0008-vitest-como-framework-de-tests.md) — Vitest como framework de tests.
- [ADR-0009](../decisions/0009-carga-de-catalogo-route-y-archivo-por-producto.md) — carga de
  catálogo: route + archivo por producto.

## Pendientes / deuda técnica
- Correr la aceptación end-to-end con credenciales (catálogo de prueba 5–10 productos).
- Re-carga: no se borran archivos viejos del vector store (posibles huérfanos) — S7.
- Catálogos grandes: migrar de N `uploadAndPoll` a `fileBatches.uploadAndPoll`.
- Tests de integración (OpenAI/Supabase) con mocks o entorno real.

## Archivos principales
- `app/api/catalog/load/route.ts`
- `lib/openai/{client,catalog,vectorStore,catalogLoader}.ts`, `lib/openai/catalog.test.ts`
- `lib/supabase/storage.ts`, `lib/env.ts` (`CATALOG_ADMIN_SECRET`)
- `vitest.config.ts`, `package.json` (scripts de test), `.env.example` / `.env.local`
- `docs/decisions/0008-*.md`, `docs/decisions/0009-*.md`
