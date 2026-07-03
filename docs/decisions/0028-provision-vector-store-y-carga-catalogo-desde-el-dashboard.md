# ADR-0028: Provisión del vector store y carga de catálogo desde el editor de agente

- **Estado:** Aceptada
- **Fecha:** 2026-07-03
- **Sprint:** 6 (continuación — dashboard multi-marca)

## Contexto
Crear un agente (marca/número) en el dashboard solo insertaba la fila en `agents`. Para que ese
agente pudiera vender había que, **por fuera**: (1) crear un vector store en OpenAI, (2) subir los
productos como documentos, (3) cargar esos productos a la tabla `products` (que es lo que necesita el
**gate anti-alucinación**: ningún `#ID` se envía si el SKU no existe en `products`), y (4) pegar a
mano el `vector_store_id` en el formulario. Cuatro pasos manuales, fáciles de dejar a medias
(p. ej. store creado pero `products` vacío → el bot no puede citar nada).

Toda la maquinaria de carga ya existía y era reutilizable: `runCatalogImport` (sube docs al store,
re-hospeda la imagen en Storage, hace upsert en `products` y persiste el `vector_store_id` en el
agente), `getOrCreateVectorStore`, `uploadProductDocument`, `validateCatalog`, `buildProductDocument`.
Solo estaba **desconectada** del flujo de crear/editar agente y se disparaba por `POST
/api/catalog/load` (o el script CSV), con su propio secreto y fuera del Basic Auth del dashboard.

Además, el catálogo real del cliente viene en un **export tipo Bubble** (`ID`, `Titulo`,
`Descripcion`, `Precio`, `PrecioConDescuento`, `Imagenes`, `Categoria`, …), no en la forma canónica
del sistema (`sku`, `name`, `price`, …).

## Decisión
Integrar la provisión del vector store y la carga de catálogo **dentro del editor de agente**, con
**dos flujos** que convergen en `runCatalogImport`:

- **"Crear vector store nuevo"** — se crea el store del agente (nombrado por marca, ignorando el
  fallback de `env.OPENAI_VECTOR_STORE_ID` para no reusar el global), se suben los productos del JSON
  como documentos a OpenAI **y** se hace upsert en `products`; el `vector_store_id` queda guardado en
  el agente.
- **"Ya tengo vector store"** — se pega/guarda un `vs_...` existente y los productos del JSON se
  cargan **solo a Supabase** (`products`), **sin** re-subir documentos al store (para no duplicar lo
  que ya está en OpenAI). El id se valida best-effort con `retrieve` (aviso si no existe, sin crear).

Piezas:
- **`runCatalogImport(input, { vectorStoreMode })`** con `VectorStoreMode = "sync" | "create" |
  "supabase-only"`. `sync` = comportamiento histórico (route + script CSV) **sin cambios**; `create`
  y `supabase-only` son los dos flujos nuevos. En `supabase-only` se **omite** `vector_store_file_id`
  del upsert para no pisar el existente (PostgREST no toca columnas ausentes) y **no** se persiste el
  id (ya lo tenía). La imagen se re-hospeda en los tres modos.
- **Mapeo de JSON** puro en `lib/openai/catalog.ts`: `normalizeCatalogJson(raw)` detecta formato
  (canónico por `sku`/`name`, Bubble por `ID`/`Titulo`) y mapea Bubble → canónico. **El precio
  oficial (`price`) es `PrecioConDescuento`** (con fallback a `Precio`); `Precio` de lista,
  `PorcentajeDescuento`, `Ahorro`, `Categoria`, `Link_producto` van a `metadata`. Al ser puro y sin
  `server-only`, corre **también en el cliente** para preview/validación instantánea.
- **Server Action `loadAgentCatalog(agentId, { mode, products, filename })`** en
  `app/dashboard/actions.ts`: mapea `create`→`create` y `existing`→`supabase-only`, llama a
  `runCatalogImport` y devuelve el `CatalogImportResult`. Corre con service-role dentro del Basic
  Auth del dashboard (no usa el `CATALOG_ADMIN_SECRET` de la route pública).
- **UI** en `AgentEditor.tsx`: selector de modo, `<input type="file">` para el JSON (requerido en
  "crear", opcional en "ya tengo"), preview de "N productos detectados (formato)", y panel de
  resultado (N cargados, `vs_...`, avisos). El submit orquesta en dos pasos:
  crear/guardar agente → cargar catálogo, con feedback escalonado.
- **`getOrCreateVectorStore(openai, existingId?, name?)`** acepta un `name` para nombrar el store por
  marca (default `vitasei-catalog`).
- **`maxDuration = 300`** en `app/dashboard/agents/new/page.tsx` y `[id]/page.tsx`: el server action
  hereda el presupuesto de la route de la página (el polling del vector store es lento).

## Consecuencias
- **Bueno:** crear un agente con catálogo es "de una vez" y sin pasos manuales fuera de banda; el
  `products` (gate) y el vector store quedan **consistentes** por construcción; reutiliza el pipeline
  ya probado (`runCatalogImport`, idempotente por `(agent_id, sku)` → recargar actualiza, no duplica);
  la route `/api/catalog/load` y el script CSV siguen intactos (modo `sync` por default); acepta el
  export real del cliente sin pre-procesarlo.
- **Malo / atado a futuro:**
  - **Body del server action (~1MB):** el JSON viaja como argumento del action. Con imágenes por
    **URL** (el caso real) el payload es chico; un catálogo con muchas imágenes en **base64** podría
    exceder el límite → ese caso sigue por `/api/catalog/load`. Documentado, no cubierto por UI.
  - **Sin barra de progreso:** el import corre síncrono dentro del submit (spinner + "puede tardar
    1–2 min"). Catálogos muy grandes podrían acercarse a los 300s; mover a background con progreso
    queda en backlog.
  - En "ya tengo vector store" **no** se verifica que los docs del store coincidan con los productos
    cargados a Supabase (se asume que el operador ya lo pobló); solo se avisa si el `vs_...` no existe.
  - Elegir "crear" sobre un agente que ya tenía `vector_store_id` genera un store **nuevo** (el
    anterior queda huérfano, no se borra). Es la semántica esperada de "crear", pero hay que saberlo.

## Alternativas consideradas
- **(a) Llamar a `/api/catalog/load` desde el cliente:** exigiría exponer el `CATALOG_ADMIN_SECRET`
  al browser o un doble salto por un proxy; el server action directo queda dentro del Basic Auth y es
  más simple. Descartada.
- **(b) Wizard de dos pasos (crear agente → pantalla aparte de catálogo):** más robusto ante fallos,
  pero rompe el "de una vez" que pidió el negocio. Se resuelve con un solo submit que orquesta ambos
  y, si el catálogo falla, conserva el agente ya creado para reintentar desde la edición.
- **(c) Precio de lista (`Precio`) como precio oficial:** el negocio corre 20% de descuento activo;
  se prefirió `PrecioConDescuento` para que el bot cotice el precio real. El de lista queda en
  `metadata` por si luego se quiere mostrar "antes/ahora".
- **(d) Re-subir docs al store también en "ya tengo vector store":** duplicaría los documentos que el
  operador ya cargó en OpenAI; se limitó ese flujo a Supabase.
