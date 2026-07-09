# ADR-0042: Inventario — editar la imagen del producto sin tocar el vector store

- **Estado:** Aceptada
- **Fecha:** 2026-07-09
- **Sprint:** post-MVP

## Contexto

El bot envía la foto del producto (`products.image_url`) por WhatsApp cuando un
`#ID` pasa el gate. A veces la imagen que se ve bien en WhatsApp **no es la misma**
que la que se importó de la página del catálogo, y hacía falta poder corregir ese
link **por producto** y **por agente**, sin depender de re-importar el catálogo.
El usuario pidió explícitamente: (1) NO subir archivos (para no gastar
almacenamiento/base de datos) y (2) NO re-sincronizar el vector store en estos
cambios.

## Decisión

Agregar una sección **Inventario** (`/dashboard/inventory`) con un selector de
**agente** (el catálogo es por agente) que lista los productos con su **miniatura**
y su **link**, y permite **cambiar el `image_url`** pegando otro link (o vaciarlo).

- **Solo `image_url`.** La edición actualiza únicamente esa columna de `products`.
- **Sin subir archivos:** no se usa Storage; se pega el link de una imagen ya
  hospedada. (Evita costo de almacenamiento.)
- **Sin vector store:** `image_url` no forma parte del documento de `file_search`
  (el vector store es texto para búsqueda; las imágenes se envían aparte vía el
  gate). Por eso cambiar la imagen **no** requiere ni dispara re-sync del vector
  store — la acción `updateProductImage` solo hace un UPDATE en Supabase.

## Consecuencias

- **Bueno:** se corrige la foto de cualquier producto en segundos, por agente, sin
  re-importar catálogo ni gastar almacenamiento. Cambio de bajo riesgo (una sola
  columna, sin efectos en la IA ni en el vector store).
- **Alcance acotado (a propósito):** por ahora solo se edita la imagen. Nombre,
  descripción, precio y stock quedan de solo lectura aquí — editarlos sí tocaría el
  contenido del vector store y es otra decisión (futura).
- **Miniaturas:** se muestran con `<img>` (link externo de dominio arbitrario) con
  `eslint-disable-next-line @next/next/no-img-element` y placeholder si el link está
  roto — se evita configurar `next/image` con dominios remotos arbitrarios.
- No requiere migración (la columna `products.image_url` ya existe).

## Alternativas consideradas

- **Subir la imagen a Supabase Storage y guardar su URL:** descartado por pedido
  explícito (costo de almacenamiento). Se pega un link externo.
- **Editar todo el producto (nombre/precio/desc) aquí:** descartado por ahora —
  esos campos alimentan el vector store y el usuario pidió no re-sincronizarlo en
  esta parte. Se deja para una iteración posterior con re-sync controlado.
- **Re-importar el catálogo para cambiar una imagen:** costoso y global; no sirve
  para un ajuste puntual por producto.
