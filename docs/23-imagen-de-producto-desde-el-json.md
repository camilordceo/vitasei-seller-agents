# 23 — Imagen del producto: el link del JSON, tal cual

## 1. Problema

Al cargar el inventario (`Agentes → (agente) → JSON de productos`), el pipeline **no**
usaba el link que ya trae el archivo: **descargaba** la imagen y la **re-subía** al bucket
`product-images` de Supabase, y guardaba en `products.image_url` la URL pública del bucket.

Ese re-hospedaje está **cambiando/confundiendo las imágenes entre productos** — el bot le
manda al cliente la foto de otro producto. La causa no es un cruce en el loop de carga (la
imagen siempre se asocia al producto correcto): es la **ruta de almacenamiento**, que se
deriva solo del SKU y se sobreescribe con `upsert: true`.

| # | Falla | Consecuencia |
|---|-------|--------------|
| 1 | La ruta es `catalog/<slug(sku)>.<ext>` — **sin `agent_id`**, aunque la migración `0010` permite explícitamente **el mismo SKU en dos marcas** (`unique (agent_id, sku)`) | La marca B **sobreescribe** la foto de la marca A y ambas quedan apuntando al **mismo objeto**. Cruce real de imágenes entre productos. |
| 2 | El slug colapsa SKUs distintos: `VITA-001`, `vita-001`, `VITA 001`, `VITA/001` → `catalog/vita-001.jpg` (y `validateCatalog` solo detecta duplicados exactos) | Dos productos distintos comparten un objeto. La última carga gana. |
| 3 | La URL pública **nunca cambia** entre cargas (misma ruta) y la subida no fija `cacheControl` | El CDN de Supabase (y WhatsApp/Callbell, que **descargan la URL ellos mismos**) sirven la imagen **anterior** hasta ~1h después de corregirla. |
| 4 | La extensión sale del `content-type` de la respuesta (Shopify negocia `webp`/`jpeg`) | El mismo SKU puede caer en `.jpg` o `.webp` según la carga; el objeto viejo queda huérfano. |
| 5 | Si el fetch o la subida fallan, se conserva la URL remota (solo `warning`) | El catálogo queda **mezclado**: unas imágenes re-hospedadas y otras remotas. |

El JSON de inventario **ya trae el link público y estable** de cada producto
(`Imagenes` / `ImageURL`, CDN de la tienda, versionado con `?v=…`). Re-hospedarlo no
aporta nada y es la fuente del bug.

Además, el propio dashboard ya es inconsistente consigo mismo: **`/dashboard/inventory`**
(ADR-0042) edita `products.image_url` pegando **el link crudo**, sin tocar Storage. El
importador era el único que re-hospedaba.

## 2. Objetivo

Que la imagen que el bot envía sea **exactamente el link que viene en el JSON**, sin
intermediarios: mostrarlo al cargar el archivo y mandarlo tal cual por WhatsApp.

## 3. Alcance

**Sí:**
- **Pass-through:** si el producto trae una URL `http(s)`, se guarda en `products.image_url`
  **sin descargarla ni re-subirla**. Cero escrituras en Storage en el caso normal.
- **Preview en el editor de agente:** al elegir el archivo, antes de guardar, se ve la
  miniatura + SKU + título + **el link** de cada producto, y el conteo de cuántos vienen
  **sin imagen**.
- **base64 (único caso que sigue usando Storage):** un producto sin URL pero con
  `image_base64` no tiene dónde vivir; se sube al bucket, pero a una ruta **por agente y con
  digest del contenido** (`catalog/<agent_id>/<sku>-<digest>.<ext>`) → sin colisiones entre
  marcas ni entre SKUs, y URL nueva cuando el contenido cambia (adiós cache viejo).

**No:**
- Migración de datos ni borrado de los objetos ya subidos a `product-images` (quedan ahí,
  inertes; no se sirven más apenas se re-cargue el JSON).
- Cambiar el formato del JSON, el vector store, ni el gate anti-alucinación.
- Validar que el link responda 200 en la carga (el editor muestra la miniatura: si está
  rota, se ve rota — feedback humano, sin latencia extra en el import).

## 4. Cómo queda el flujo

```
JSON (Imagenes / ImageURL)
  → normalizeCatalogJson (puro, en el browser)   ← el editor ya muestra el link + miniatura
  → loadAgentCatalog (server action)
  → runCatalogImport
       resolveProductImage(p):
         URL http(s)  → se usa TAL CUAL                     (99% de los casos, sin I/O)
         base64       → Storage: catalog/<agent>/<sku>-<digest>.<ext>
         nada         → null
  → products.image_url
  → processMessage: el #ID pasa el gate → sendImage(url) → Callbell descarga ESE link
```

`image_url` no forma parte del documento del vector store: el único join entre el `#ID` que
emite el modelo y la foto es `products.sku` (por agente). Eso no cambia.

## 5. Criterio de aceptación

1. Cargar `Vitasei Productos 2 julio.json` en un agente → cada `products.image_url` es
   **idéntico** al `ImageURL` del JSON (ningún `…supabase.co/storage/…`).
2. Dos agentes con el **mismo SKU** y fotos distintas → cada uno conserva la suya.
3. Al elegir el archivo, el editor muestra la miniatura y el link de cada producto y avisa
   cuántos vienen sin imagen — **antes** de guardar.
4. El bot manda por WhatsApp exactamente ese link.
5. `npm test` y `tsc --noEmit` en verde.

## 6. Cómo corregir el daño ya hecho

Los productos ya cargados siguen apuntando al bucket. **Re-cargar el JSON** del agente (modo
"agregar/actualizar") reescribe `image_url` con el link bueno: el upsert por `(agent_id, sku)`
lo pisa. Para un producto suelto, `/dashboard/inventory` → "Cambiar imagen".

Ver **ADR-0049**.
