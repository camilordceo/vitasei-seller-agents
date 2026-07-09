# 22 — Inventario (imagen del producto por agente)

## 1. Objetivo

Ver el catálogo **por agente** y poder **cambiar el link de la imagen** de cualquier
producto — la foto que el bot envía por WhatsApp. A veces la imagen que se ve bien
en WhatsApp no es la misma que la importada de la página, y hay que corregirla sin
re-importar el catálogo.

## 2. Alcance (v1)

- **Sí:** listar productos del agente (miniatura + SKU + nombre + precio + stock +
  link), **buscar** por nombre/SKU, y **editar `products.image_url`** (pegar otro
  link o vaciarlo).
- **No:** subir archivos (no se usa Storage, para no gastar almacenamiento); editar
  nombre/descripción/precio; re-sincronizar el vector store. Ver ADR-0042.

## 3. Cómo funciona

- `/dashboard/inventory` → selector de **agente** (`?agent=<id>`) → lista de
  productos de ese agente (`getAgentProducts`).
- "Cambiar imagen" edita el link y guarda con la server action `updateProductImage`,
  que hace **solo** un UPDATE de `image_url` en `products`. **No** toca OpenAI ni el
  vector store: `image_url` no es parte del documento de `file_search`; la imagen se
  envía aparte cuando un `#ID` pasa el gate (ver `lib/agent/processMessage.ts`).
- La miniatura se muestra desde el link; si está roto, aparece un placeholder.

## 4. Notas

- El catálogo se **carga** desde `Agentes → (agente) → Cargar catálogo` (eso sí
  sube al vector store). El inventario es solo para **corregir imágenes**.
- Editar precio/nombre/descripción (que sí requeriría re-sync del vector store)
  queda fuera de v1 — es una decisión aparte (ADR-0042, "a futuro").
