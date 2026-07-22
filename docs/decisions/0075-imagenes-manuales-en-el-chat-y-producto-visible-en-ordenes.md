# 0075 — Imágenes manuales en el chat (subida + catálogo) y producto visible en órdenes

- Estado: aceptada
- Fecha: 2026-07-22

## Contexto

El compositor del chat del dashboard solo mandaba texto. Cuando un humano toma la
conversación (modo manual) y el cliente pide "mándame la foto", la única salida era
volver a WhatsApp por fuera del dashboard: el mensaje se enviaba, pero no quedaba en
`messages` y el hilo del dashboard dejaba de contar la historia completa.

El caso más frecuente no es una foto nueva: es **la foto de un producto que ya está en
`products.image_url`**. Obligar a descargarla y volver a subirla es trabajo tonto y
además re-hospeda una imagen que ya vive en un link válido.

Aparte, en la lista de órdenes y en el panel de órdenes de la conversación solo se veía
"3 ítems": para saber **qué** compró el cliente había que abrir la orden.

## Decisión

1. **Dos caminos para adjuntar, un solo envío.** El compositor acepta (a) subir un
   archivo y (b) elegir un producto del catálogo del agente. Ambos terminan en la misma
   Server Action `sendManualImage(conversationId, url, caption)`, que pasa por el puerto
   `MessagingProvider` (`sendImage`) y registra el mensaje en `messages` con
   `type: "image"`, `media_url` y tag `manual` — igual que `sendManualMessage`.
2. **Del catálogo se manda el link tal cual**, sin descargar ni re-hospedar. Es la misma
   regla de ADR-0049: re-hospedar es lo que cruzaba fotos entre productos.
3. **Solo lo subido se hospeda.** `uploadChatImage` guarda en el bucket `product-images`
   bajo `chat/{conversationId}/{sha256}.{ext}`. Ruta por conversación + digest: la misma
   foto reusa el objeto y una distinta estrena URL (el CDN nunca sirve la vieja).
4. **El texto del compositor viaja como caption**, no como mensaje aparte: con una foto
   adjunta se envía **un** mensaje, no dos.
5. **El buscador solo lista productos con imagen.** Un resultado sin foto no sirve para
   lo que abre ese buscador; mostrarlo sería ofrecer algo que al hacer clic no hace nada.
6. **El nombre del producto sube a la lista.** `OrderRow` y `ConversationOrder` llevan
   `productNames` (derivado de `order_items`, sin repetir; si el ítem no guardó nombre se
   cae al SKU). La lista de órdenes muestra el primero + "+N más"; el panel de la
   conversación los lista todos.

## Alternativas consideradas

- **Subir también las fotos del catálogo al bucket.** Descartada: duplica bytes y revive
  el problema que cerró ADR-0049.
- **Mandar foto y texto como dos mensajes.** Descartada: el cliente ve dos globos y el
  orden de llegada no está garantizado.
- **Filtro de producto en la lista de órdenes en vez de mostrar el nombre.** Ya existe el
  selector de SKU; lo que faltaba era leer la fila sin filtrar nada.
- **JOIN de `order_items` en la fila.** No hace falta: la consulta de ítems ya se hacía
  para el conteo; solo se le pidieron dos columnas más.

## Consecuencias

- `next.config.mjs` sube `serverActions.bodySizeLimit` a 8 MB: el default de 1 MB rebota
  cualquier foto de celular. La acción valida aparte tipo (JPG/PNG/WebP) y tamaño (7 MB)
  antes de escribir nada en Storage.
- El bucket `product-images` ahora guarda también imágenes que no son de producto (prefijo
  `chat/`). Es el mismo bucket público que ya servía fotos a WhatsApp; separar en otro no
  aportaba nada más que una segunda política de acceso que mantener.
- El buscador consulta en cada tecleo (con debounce de 250 ms) y trae hasta 40 filas. Con
  el volumen v1 alcanza; si un catálogo crece, esto pide índice o paginación.
- Una orden con muchos productos distintos muestra solo el primero en la lista. Es a
  propósito: la fila no puede crecer sin control. El detalle está a un clic.
