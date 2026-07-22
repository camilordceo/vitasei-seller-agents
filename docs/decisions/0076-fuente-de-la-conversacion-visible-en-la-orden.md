# 0076 — La fuente de la conversación viaja hasta la orden

- Estado: aceptada
- Fecha: 2026-07-22

## Contexto

ADR-0075 puso en la lista de órdenes **qué producto se pidió** (`order_items`). Eso responde
"qué compró", pero no responde la pregunta que importa para decidir plata: **de qué pauta
llegó ese cliente**. Esa atribución vive en la conversación, no en la orden:
`conversations.product_category` (migración 0018) — se detecta por palabra clave y se puede
fijar a mano desde el detalle de la conversación.

Hasta ahora, para saber de qué campaña salió una venta había que abrir la orden, saltar a la
conversación y leer el panel lateral. Con eso nadie compara pautas.

## Decisión

1. **La orden hereda la fuente de su conversación.** `OrderRow` y `OrderDetail` llevan
   `productCategory`, resuelto por `conversation_id`. No se copia el valor a `orders`: sigue
   siendo un dato de la conversación, con un solo dueño, y si se corrige allá la orden lo
   refleja sola.
2. **Se ve donde se decide.** Chip teal (`SourcePill`) junto a estado y método en cada fila de
   Órdenes; fila "Producto / fuente" en el detalle, que enlaza a
   `/dashboard/conversations?product=…` para ver todas las conversaciones de esa fuente.
3. **Una sola consulta compartida y best-effort.** `categoriesByConversation()` centraliza la
   lectura de la columna; si falta la migración 0018 devuelve un mapa vacío y las órdenes se
   listan sin fuente en vez de dejar la página en error (mismo criterio que `getConversation`).
   Acepta `ids` para acotar cuando ya se sabe qué conversaciones interesan.

## Alternativas consideradas

- **Denormalizar `product_category` en `orders`.** Descartada: un segundo lugar donde el dato
  puede quedar viejo, y corregir la fuente en la conversación dejaría de arreglar la orden.
- **Filtro por fuente en la lista de órdenes.** No ahora: el selector de SKU ya ocupa ese
  espacio y dos selectores parecidos confunden. Primero que el dato se vea; si se pide
  comparar, el lugar natural es Reportes (ADR-0069), no un filtro más.
- **Resolverlo con un JOIN de PostgREST.** No aplica: `getOrdersPage` ya barre y cruza en JS
  a propósito (los totales cubren el filtro completo, no la página), y la lectura tiene que
  poder fallar sola cuando la columna no existe.

## Consecuencias

- La lista de órdenes suma un barrido de `conversations(id, product_category)`. Es el mismo
  patrón (y volumen) que el barrido de conversaciones que ya hacía para resolver el agente.
- Órdenes de conversaciones sin categorizar no muestran chip: el vacío es información —
  significa que esa venta no está atribuida a ninguna pauta todavía.
- Cambiar la fuente de una conversación cambia lo que se lee en sus órdenes, incluidas las
  viejas. Es deliberado: es una corrección de atribución, no un histórico.
