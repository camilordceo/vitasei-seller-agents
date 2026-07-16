# 03 — Agente: system prompt, tags y flujos

## 1. Rol del agente

Vendedor de Vitasei por WhatsApp. Tono cercano, claro, colombiano, sin rodeos. Su trabajo es:
asesorar → mostrar producto → resolver dudas (con File Search) → llevar a método de compra (Addi o contra entrega) → recolectar datos → cerrar con `#orden-lista` y dejar todo listo para logística.

## 2. Taxonomía de tags (contrato backend ↔ agente)

| Tag | Cuándo lo emite el agente | Qué hace el backend |
|-----|---------------------------|---------------------|
| `#ID<dígitos>` (inline) | Al recomendar/mostrar un producto concreto | Envía imagen del producto (lookup en `products`) |
| **Tag de pago** (por agente) | Cliente elige un método de pago | Fija `fulfillment_method = <method>` + alimenta el cierre inferido; NO envía info extra |
| `#orden-lista` | Ya tiene método + ítems + datos de envío completos | Crea orden + **handoff** a logística |
| `#humano` | Cliente pide humano o caso fuera de alcance | Handoff inmediato (sin orden) |
| `#llamada` | Cliente pide que lo llamen | Crea solicitud de llamada + aviso (no fuerza handoff) |

### Métodos de pago por agente (ADR-0055)
Los tags de **pago** ya **no** están cableados: cada agente configura los suyos en el editor de
Agentes (`agents.payment_methods` = `[{tag,label,method}]`) según su mercado. Ejemplos:
- Colombia: `#compra-contra-entrega` (Contra entrega, `method=cod`), `#addi` (Addi, `method=addi`).
- EE.UU.: `#zelle` (Zelle, `method=zelle`).

El backend reconoce **solo** los tags configurados del agente que responde: los quita del texto,
fija el método (`fulfillment_method`, ahora **texto libre**) y los usa para generar la orden.
El link de Addi se envía únicamente para el método `addi` (retrocompat CO). Un tag de pago que
el agente **no** tenga configurado no se reconoce (queda como texto normal). **Instruir el tag es
responsabilidad del `system_prompt` del agente.**

### Reglas de formato (críticas)
- **`#ID` va INLINE** (formato `#ID` + dígitos, p. ej. `#ID7948237144230`): el agente lo
  escribe dentro del mensaje; el backend lo detecta por regex (`/#ID\d+/g`), envía la imagen
  y lo **borra** del texto. El **SKU es el token completo** (incluye `#ID`) y es el `sku`
  exacto del catálogo. **Nunca** inventar ni modificar un `#ID`. Ver ADR-0014.
- Puede haber varios `#ID` (se deduplican en orden) si muestra varios productos.
- Los tags de **flujo** (el de pago del agente, `#orden-lista`, `#humano`, `#llamada`) van
  **al final del mensaje, cada uno en su propia línea**.
- Los tags **no son visibles** para el cliente: el backend los **quita** del texto antes de
  enviar. El agente escribe el mensaje natural.

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
- Para mostrar un producto, escribe su #ID del catálogo (formato #ID seguido de números,
  por ejemplo #ID7948237144230). Puedes escribirlo dentro del mensaje: el sistema lo detecta,
  envía la foto y BORRA el #ID antes de que el cliente lo vea. Usa el #ID EXACTO del catálogo;
  nunca lo inventes ni lo modifiques. Puedes incluir varios #ID.
- Llevas al cliente a elegir método de compra: Addi (financiación) o Contra entrega.

TAGS DE FLUJO (van al final del mensaje, cada uno en su propia línea; el cliente NO los ve)
- #addi                  -> el cliente quiere pagar con Addi
- #compra-contra-entrega -> el cliente quiere pago contra entrega
- #orden-lista           -> ya tienes método + ítems + nombre + dirección + ciudad + teléfono
- #humano                -> el cliente pide una persona o es algo fuera de tu alcance

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

## 5.1 Imágenes y notas de voz (multimodal — ver `docs/15`, ADR-0022)

El agente **ve** las imágenes y **escucha** las notas de voz del cliente:
- **Audio** → se transcribe (Whisper, español) y entra como texto del cliente; la transcripción
  queda en `messages.content` (visible en el dashboard).
- **Imagen** → entra como **visión** en la MISMA llamada de Responses (el modelo la ve).
- La migración **`0009`** agrega al `system_prompt` una sección **IMÁGENES Y NOTAS DE VOZ**:
  ante un **comprobante de pago** el agente confirma que lo **recibió** (NO confirma el cobro —
  eso es de logística); ante una foto de producto responde con base en el catálogo; si la imagen
  no es legible, pide reenviarla; nunca inventa lo que no ve.

## 6. Parsing de tags (backend)

- **`#ID` inline:** `/#ID\d+/g` en cualquier parte del texto → `skus[]` (token completo, dedup,
  en orden); se quitan del `cleanText`.
- **Tags universales por línea:** `^#orden-lista$`, `^#humano$`, `^#llamada$`.
- **Tags de pago por línea:** dinámicos por agente (`parseReply` recibe `paymentMethods`); el que
  matchee fija `paymentMethod` (la clave `method` de la config). Ver ADR-0055.
- `cleanText` = texto sin `#ID` ni líneas de tags (y sin líneas vacías colgantes).
- `cleanText` se envía como mensaje de texto; los `#ID` **válidos** (gate: existen en
  `products`) generan mensajes `image` con `products.image_url`.

> El system prompt v1 usaba `#ID:SKU` en línea propia; el prompt vigente (migración `0005`)
> usa el formato inline. Ver ADR-0014.
