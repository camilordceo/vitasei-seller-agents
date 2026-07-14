# ADR-0049: La imagen del producto es el link del JSON (sin re-hospedaje en Storage)

- **Estado:** Aceptada
- **Fecha:** 2026-07-14
- **Sprint:** — (fix de producción)

## Contexto

Desde el Sprint 2 (ADR-0009, ADR-0016), la carga de catálogo **descargaba** la imagen de cada
producto y la **re-subía** al bucket público `product-images`, guardando en
`products.image_url` la URL del bucket. La ruta la deriva `imageStoragePath(sku, contentType)`:

```
catalog/<sku slugificado>.<ext>     // upsert: true
```

Esa ruta es la fuente de un bug de producción: **el bot manda la foto de otro producto**.

1. **La ruta no incluye `agent_id`.** La migración `0010` volvió el SKU único **por agente**
   (`unique (agent_id, sku)`) justamente para que dos marcas puedan repetir SKU — pero la ruta
   se quedó global. Dos agentes con el mismo SKU escriben el **mismo objeto** con `upsert: true`
   y `getPublicUrl` les devuelve la **misma URL**: la segunda carga sobreescribe la foto de la
   primera y ambos productos terminan mostrando la misma imagen.
2. **El slug colapsa SKUs distintos.** `sku.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")` manda
   `VITA-001`, `vita-001`, `VITA 001` y `VITA/001` al mismo archivo. Son filas distintas en
   Postgres (el `sku` es case-sensitive) y `validateCatalog` solo detecta duplicados exactos,
   así que pasan la validación y se pisan en Storage.
3. **La URL nunca cambia entre cargas.** Misma ruta ⇒ misma URL pública; la subida no fija
   `cacheControl`. El CDN de Supabase (default ~1h) y quien descargue el link — **Callbell y
   WhatsApp descargan la URL ellos mismos**, ver `lib/callbell/sender.ts` — siguen sirviendo la
   imagen vieja después de corregirla.
4. Detalles menores que agravan: la extensión sale del `content-type` de la respuesta (Shopify
   negocia `webp` o `jpeg` según el cliente, así que el mismo SKU salta de ruta entre cargas y
   deja huérfanos), y si el fetch o la subida fallan se conserva la URL remota con solo un
   `warning`, dejando el catálogo mezclado.

Mientras tanto, el JSON de inventario **ya trae el link público y estable** de cada producto
(`Imagenes` / `ImageURL`: CDN de la tienda, versionado con `?v=…`). Y el propio dashboard ya
trabaja así en el otro lado: **`/dashboard/inventory` (ADR-0042) escribe el link crudo en
`image_url` sin tocar Storage**. El importador era el único que re-hospedaba.

El re-hospedaje se justificaba (ADR-0016) por miedo a que el CDN de la tienda rotara o borrara
las URLs. En 6 meses de operación eso no pasó; el cruce de imágenes sí, y le pega al cliente
final en cada mensaje.

## Decisión

**Pass-through.** El pipeline de carga guarda en `products.image_url` **el link que viene en el
JSON, tal cual**, sin descargarlo ni re-subirlo. Se elimina el re-hospedaje de URLs remotas.

Único caso que sigue usando Storage: un producto **sin URL pero con `image_base64`** (no hay
dónde vivir), y ahí la ruta pasa a ser **por agente y con digest del contenido**:

```
catalog/<agent_id>/<sku>-<sha256(bytes)[0..12]>.<ext>
```

— sin colisiones entre marcas ni entre slugs, y URL nueva cuando cambia el contenido (el cache
viejo deja de importar).

El editor de agente **muestra el link y la miniatura de cada producto al elegir el archivo**,
antes de guardar: lo que se ve ahí es exactamente lo que se manda por WhatsApp.

## Consecuencias

**Bueno**
- Desaparece la clase entera de bug: no hay ruta compartida, no hay objeto sobreescrito, no hay
  URL con contenido mutable ⇒ **una foto no puede cruzarse a otro producto**.
- La carga es más rápida y no puede fallar por red: cero `fetch` y cero subidas en el caso
  normal (antes, N descargas + N subidas por import; con timeouts y `warnings` por producto).
- Cero almacenamiento consumido en Supabase, coherente con ADR-0042 (`/dashboard/inventory` ya
  no usaba Storage) y con el principio de menos infraestructura.
- El operador ve el link antes de guardar: si la tienda tiene la foto mal, se detecta en el
  dashboard y no en el chat del cliente.

**Malo / atado a futuro**
- **Dependemos del CDN de la tienda.** Si borran o rotan una imagen, el link muere y el bot
  manda solo texto (el gate de `#ID` no se ve afectado: la imagen es best-effort en
  `processMessage`). Mitigación operativa: `/dashboard/inventory` permite corregir el link de
  un producto sin re-importar; el preview del editor hace visible una foto rota.
- Los objetos ya subidos a `product-images` **quedan en el bucket** (inertes). No se borran:
  borrar objetos de producción no es reversible y no aporta — dejan de servirse apenas se
  re-cargue el JSON. Se puede vaciar el bucket a mano más adelante.
- **Los productos ya cargados siguen apuntando al bucket** hasta que se re-cargue el JSON del
  agente (el upsert por `(agent_id, sku)` reescribe `image_url`). Es un paso manual, no una
  migración.
- `imageStoragePath` conserva la firma vieja (`(sku, contentType)`) para no romper su test; el
  digest y el agente entran como parámetros opcionales.

## Alternativas consideradas

- **Arreglar la ruta (meter `agent_id` + digest) y seguir re-hospedando.** Corrige el cruce,
  pero mantiene la descarga/subida por producto (lenta, falible), el gasto de Storage, los
  huérfanos y la incoherencia con ADR-0042 — todo para resolver un riesgo (que el CDN de la
  tienda rote) que no se materializó. Igual habría que re-cargar el JSON para reparar los datos.
  El digest y la ruta por agente **sí** se adoptan, pero solo en el camino base64, que es el
  único que obliga a hospedar.
- **Re-hospedar pero validando que el objeto nuevo != el viejo** (comparar hash antes de
  sobreescribir). Complejidad sin premio: sigue habiendo un objeto compartido entre marcas.
- **Descargar la imagen solo para validar que existe (HEAD) y guardar la URL remota.** Suma N
  requests y una fuente de falsos negativos (CDNs que rechazan `HEAD`) al import. La miniatura
  del editor da la misma señal, gratis y en el momento correcto.
- **Guardar ambas** (`image_url` remota + copia en Storage como fallback). Duplica el estado y
  obliga a decidir cuál gana en cada envío. No hay evidencia de que haga falta.
