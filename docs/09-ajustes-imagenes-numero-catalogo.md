# 09 — Ajustes v1.1: envío con/sin imagen, filtro de número y carga del catálogo real

> **Contexto.** El core del agente (webhook → debounce → 1× Responses → tags → gate →
> envío por Callbell → orden/handoff) ya está construido (Sprints 1–5). Este documento
> especifica tres ajustes para operar con los **datos reales de Vitasei** y con la
> realidad de la cuenta de Callbell. Aterriza el PRD maestro (`docs/00`) §4 y §5 al
> catálogo real.

Decisiones asociadas: **ADR-0014** (`#ID` inline), **ADR-0015** (filtro de número),
**ADR-0016** (carga del catálogo desde CSV).

---

## 1. Dos tipos de envío: con imagen y sin imagen

Un mensaje del agente puede salir de dos formas por Callbell:

| Tipo | Cuándo | Cómo se envía |
|------|--------|---------------|
| **Sin imagen** | El agente responde texto normal (sin recomendar un producto concreto) | `sendText` → `POST /v1/messages/send` `type:"text"` (el flujo Callbell de siempre) |
| **Con imagen** | El agente recomienda uno o más productos y emite su `#ID` | `sendText` (texto limpio) **+** por cada `#ID` válido `sendImage` → `type:"image"` con el `url` de la imagen del producto |

**Cómo se combina con lo que responde la IA** (igual que hacías en Bubble):

1. La IA tiene instrucciones de **dar el `#ID`** de los productos que recomienda
   (formato `#ID` seguido de números, p. ej. `#ID7948237144230`), escrito **inline**
   dentro del mensaje.
2. El backend hace un **regex** sobre la respuesta buscando esos `#ID`
   (`/#ID\d+/g`) — `lib/agent/tags.ts` → `parseReply`.
3. Por cada `#ID` encontrado hace un **search en Supabase** (`products` por `sku`) y trae
   el **link de la imagen** (`products.image_url`).
4. Ese link va en el **campo de imagen de Callbell** (`content.url`) para el mensaje
   `type:"image"` — `lib/callbell/sender.ts` → `sendImage`.
5. El `#ID` se **quita del texto** antes de enviarlo (los tags nunca los ve el cliente).

> **Gate anti-alucinación (se mantiene):** si el `#ID` no existe en `products`, **no** se
> envía imagen y se registra `gate_blocked` en `events_log`. Un mensaje puede tener 0..N
> `#ID`, así que la imagen es opcional por diseño.

### Cambio respecto a la v1
- **Antes:** el tag era `#ID:<sku>` en **su propia línea** (`#ID:VITA-001`).
- **Ahora:** es `#ID<dígitos>` **inline** (`#ID7948237144230`), extraído por regex en
  cualquier parte del texto. El **SKU es el token completo** (incluye el prefijo `#ID`) y
  es la misma clave en `products.sku` y en el catálogo del vector store. Ver **ADR-0014**.
- Los tags de **flujo** (`#addi`, `#compra-contra-entrega`, `#orden-lista`, `#humano`)
  **no cambian**: siguen yendo al final, cada uno en su propia línea.

---

## 2. Filtro de número: solo responder al número de la IA

En Callbell hay **varios números** en la cuenta y solo se puede crear **un webhook**. Por lo
tanto el webhook recibe inbound de **todos** los números. El agente **solo** debe responder a
los mensajes que llegan al **número de la IA: `573332877350`**.

**Regla:** al inicio del webhook, si el mensaje **no** llegó al número de la IA, se **detiene**
el flujo (200 `ok`, sin ingesta ni respuesta).

**Cómo se identifica el número destino** (`lib/callbell/types.ts` → `classifyInbox`):

1. **Por número destino** si el webhook lo trae (`AGENT_WHATSAPP_NUMBER` vs. el número de
   negocio del payload). El campo exacto del webhook se confirma contra un webhook real (por
   eso probamos varios candidatos: `to`, `channel.phoneNumber`, …).
2. **Fallback por `channel_uuid`**: si no viene el número, se compara el canal del inbound
   contra `CALLBELL_WHATSAPP_CHANNEL_UUID` (el canal del número de la IA).
3. **Indeterminado** (ni número ni canal legibles con este webhook): se **procesa igual**
   (fail-open) y se registra `inbox_indeterminate` con el body crudo, para confirmar el
   campo y endurecer. Con `CALLBELL_WHATSAPP_CHANNEL_UUID` seteado esto no debería ocurrir.

| Decisión | Qué pasa | Log en `events_log` |
|----------|----------|---------------------|
| `match` | Se procesa normal | — |
| `reject` | Se descarta (200 ok) | `inbox_rejected` |
| `indeterminate` | Se procesa + se marca para confirmar | `inbox_indeterminate` |

**Config:** `AGENT_WHATSAPP_NUMBER=573332877350` (E.164 sin `+`). Si está vacío, el filtro
queda **desactivado** (procesa todo — solo para dev). Ver **ADR-0015**.

> **Acción de setup:** setear `AGENT_WHATSAPP_NUMBER` y, para el fallback robusto, el
> `CALLBELL_WHATSAPP_CHANNEL_UUID` del canal de `573332877350`.

---

## 3. Catálogo real: estructura y carga desde CSV

Fuente inicial: `vitasei-productos-actualizado.csv` (16 productos: colágenos, kits y
magnesios). El SKU es la columna **ID** tal cual (`#ID7948237144230`).

### 3.1 Estructura en Supabase

La tabla **`products`** (migración `0001`) ya soporta esto **sin cambios de schema**:

| Columna | Origen CSV | Nota |
|---------|-----------|------|
| `sku` (unique) | `ID` | Token completo `#ID<dígitos>` — join key del `#ID` y del gate |
| `name` | `Titulo` | |
| `description` | `Descripcion` | Alimenta el documento del vector store |
| `price` | `Precio` | COP, entero (p. ej. `245900`) |
| `image_url` | `Imagenes` (fallback `ImageURL`, `Imagen`) | Se re-hospeda en el bucket `product-images`; si falla, se conserva la URL original |
| `metadata` (jsonb) | `Categoria`, `Link_producto`, `Empresa`, `Estado` | |
| `vector_store_file_id` | — | Lo setea el pipeline al subir el documento a OpenAI |

El **mismo SKU** vive en dos lugares (PRD maestro §4): el **vector store** (texto que lee
`file_search` para que el modelo emita el `#ID`) y **`products`** (imagen + gate). El pipeline
de carga los deriva de la misma fila → consistencia garantizada.

### 3.2 Carga (reusa el pipeline del Sprint 2)

No se reimplementa nada: `scripts/import-catalog-csv.mjs` parsea el CSV, mapea las columnas y
hace **POST a `/api/catalog/load`**, que ya:
1. valida (SKU único/presente, name, price ≥ 0),
2. sube el documento de cada producto al **vector store** (`file_search`),
3. re-hospeda la imagen en **`product-images`** y setea `image_url`,
4. hace **upsert por `sku`** en `products`,
5. registra el import en `catalog_imports`.

```bash
# 1) Server arriba y CATALOG_ADMIN_SECRET seteado (o abierto en dev)
npm run dev

# 2) Previsualizar el mapeo sin llamar a la API
node scripts/import-catalog-csv.mjs --dry

# 3) Cargar (localhost por defecto; o --url https://<app>/api/catalog/load)
npm run import:catalog
```

El script lee `CATALOG_ADMIN_SECRET` / `CATALOG_API_URL` de env o de `.env.local`, valida
que cada `ID` tenga formato `#ID<números>` y reporta productos sin imagen. Ver **ADR-0016**.

---

## 4. Cambios de código (resumen)

| Archivo | Cambio |
|---------|--------|
| `lib/agent/tags.ts` | `#ID` inline (`/#ID\d+/g`), token completo = SKU, se quita del `cleanText` |
| `lib/agent/tags.test.ts` | Tests del nuevo formato inline |
| `lib/agent/processMessage.ts` | `messages.tags` de la imagen usa `[sku]` (el sku ya incluye `#ID`) |
| `lib/callbell/types.ts` | `getDestinationNumber`, `getChannelUuid`, `classifyInbox` |
| `lib/callbell/types.test.ts` | Tests del filtro de número |
| `app/api/webhooks/callbell/route.ts` | Aplica el filtro (reject/indeterminate + log) |
| `lib/env.ts`, `.env.example` | `AGENT_WHATSAPP_NUMBER` |
| `supabase/migrations/0005_update_agent_prompt.sql` | Prompt v2 (formato `#ID` inline) |
| `scripts/import-catalog-csv.mjs`, `package.json` | Loader del CSV (`npm run import:catalog`) |

---

## 5. Criterios de aceptación

1. **Sin imagen:** una respuesta sin `#ID` sale solo como texto por Callbell (flujo normal).
2. **Con imagen:** el cliente pide un producto → recibe **texto limpio** (sin el `#ID`) **+**
   la **imagen correcta** del producto (URL de `products.image_url`).
3. **Gate:** un `#ID` que no existe en `products` **no** envía imagen y queda como
   `gate_blocked`.
4. **Filtro de número:** un inbound al número de la IA (`573332877350`) se procesa; un inbound
   a **otro** número de la cuenta **no** genera respuesta (`inbox_rejected`).
5. **Catálogo:** `npm run import:catalog` deja los **16 productos** en `products` con
   `image_url`, el vector store `completed` y SKUs `#ID<dígitos>` consistentes.

## 6. Definition of Done (ver `docs/08`)
- [x] Código + tests (48 verdes) + typecheck + lint.
- [x] ADR-0014, ADR-0015, ADR-0016.
- [x] `CHANGELOG.md` bajo `[Unreleased]`.
- [ ] Verificación con servicios reales (webhook multi-número, carga del CSV, envío con
      imagen en WhatsApp) — pendiente de aprovisionamiento, como el resto de `[Unreleased]`.
