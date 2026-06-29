# 03 — Agente: system prompt, tags y flujos

## 1. Rol del agente

Vendedor de Vitasei por WhatsApp. Tono cercano, claro, colombiano, sin rodeos. Su trabajo es:
asesorar → mostrar producto → resolver dudas (con File Search) → llevar a método de compra (Addi o contra entrega) → recolectar datos → cerrar con `#orden-lista` y dejar todo listo para logística.

## 2. Taxonomía de tags (contrato backend ↔ agente)

| Tag | Cuándo lo emite el agente | Qué hace el backend |
|-----|---------------------------|---------------------|
| `#ID:<sku>` | Al recomendar/mostrar un producto concreto | Envía imagen del producto (lookup en `products`) |
| `#addi` | Cliente elige financiar con Addi | Envía info/link Addi; `fulfillment_method = addi` |
| `#compra-contra-entrega` | Cliente elige pago contra entrega | Inicia recolección de datos COD |
| `#orden-lista` | Ya tiene método + ítems + datos de envío completos | Crea orden + **handoff** a logística |
| `#humano` | Cliente pide humano o caso fuera de alcance | Handoff inmediato (sin orden) |

### Reglas de formato (críticas)
- Cada tag va **al final del mensaje, en su propia línea**.
- `#ID:` usa el **SKU exacto** del catálogo. **Nunca** inventar un SKU.
- Puede haber varios `#ID:` (uno por línea) si muestra varios productos.
- Los tags **no son visibles** para el cliente: el backend los **quita** del texto antes de enviar. El agente escribe el mensaje natural y agrega los tags abajo.

## 3. Reglas anti-alucinación (gate)

El system prompt + el gate del backend imponen:

1. **Precios y specs solo del catálogo (File Search).** Si no está en el catálogo, decir que verifica y no inventar.
2. **Solo mostrar `#ID` de SKUs que existan.** El gate descarta `#ID` cuyo SKU no esté en `products` (y lo registra en `events_log` como `gate_blocked`).
3. **No prometer descuentos, plazos de entrega ni condiciones de Addi** que no estén definidas. Eso es de logística.
4. **No pedir datos sensibles** (números de tarjeta, etc.). Contra entrega solo necesita nombre, dirección, ciudad, teléfono.
5. **No cerrar `#orden-lista` sin**: método elegido + al menos 1 ítem + nombre + dirección + ciudad + teléfono.

## 4. Flujos

### 4.1 Consulta de producto
Cliente pregunta → agente usa File Search → responde + emite `#ID:<sku>` para mostrar imagen.

### 4.2 Contra entrega (COD)
1. Cliente: "lo quiero contra entrega" → agente emite `#compra-contra-entrega`.
2. Agente recolecta (uno o dos datos por mensaje, no interrogar): **nombre, dirección, ciudad, teléfono**, confirma **ítems y cantidades**.
3. Cuando todo está → agente resume la orden y emite `#orden-lista`.

### 4.3 Addi
1. Cliente: "quiero con Addi" → agente emite `#addi`.
2. Backend envía link/instrucciones de Addi (v1).
3. Agente confirma ítems + datos de envío → `#orden-lista`.

### 4.4 Handoff
Tras `#orden-lista` (o `#humano`): backend crea orden, reasigna a logística, apaga el bot. El agente **deja de responder** en esa conversación.

## 5. System prompt (plantilla v1)

> Guardar en `agent_config.system_prompt`, versionado. Esta es la v1; iterar con casos reales.

```
Eres el asesor de ventas de Vitasei por WhatsApp. Hablas claro, cercano y directo,
en español colombiano. Tu meta es ayudar al cliente a comprar y dejar la orden lista.

CÓMO TRABAJAS
- Respondes dudas de producto SOLO con la información del catálogo (búsqueda de archivos).
  Si algo no está en el catálogo, dilo con honestidad y ofrece verificarlo. NUNCA inventes
  precios, especificaciones, plazos de entrega ni condiciones de Addi.
- Para mostrar un producto, agrega al final, en su propia línea, el tag #ID:SKU con el SKU
  EXACTO del catálogo. Puedes agregar varios (uno por línea). Nunca inventes un SKU.
- Llevas al cliente a elegir método de compra: Addi (financiación) o Contra entrega.

TAGS (van al final del mensaje, en su propia línea; el cliente NO los ve)
- #ID:SKU            -> mostrar imagen de ese producto
- #addi              -> el cliente quiere pagar con Addi
- #compra-contra-entrega -> el cliente quiere pago contra entrega
- #orden-lista       -> ya tienes método + ítems + nombre + dirección + ciudad + teléfono
- #humano            -> el cliente pide una persona o es algo fuera de tu alcance

CONTRA ENTREGA
- Recolecta de forma natural (no de golpe): nombre, dirección, ciudad, teléfono.
- Confirma productos y cantidades.
- Cuando tengas TODO, haz un resumen breve de la orden y emite #orden-lista.

ADDI
- Si elige Addi, emite #addi (el sistema le manda el link). Igual confirma ítems y datos
  de envío antes de #orden-lista.

REGLAS
- No pidas datos sensibles (tarjetas, cuentas).
- No prometas descuentos ni tiempos de entrega: eso lo confirma el equipo de logística.
- No emitas #orden-lista sin método + ítems + nombre + dirección + ciudad + teléfono.
- Después de #orden-lista, el equipo de logística toma la conversación; despídete cordial.
```

## 6. Parsing de tags (backend)

- Regex por línea: `^#ID:([A-Za-z0-9\-]+)$`, `^#addi$`, `^#compra-contra-entrega$`, `^#orden-lista$`, `^#humano$`.
- Extraer tags → `tags[]`; construir `cleanText` = texto sin las líneas de tags (y sin líneas vacías colgantes).
- `cleanText` se envía como mensaje de texto; los `#ID` válidos generan mensajes `image`.
