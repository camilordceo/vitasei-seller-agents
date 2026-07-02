# 04 — Integración Callbell

Base URL: `https://api.callbell.eu/v1` · Auth: `Authorization: Bearer <CALLBELL_API_KEY>`

## 1. Webhook (inbound)

- Suscribirse al evento **`message_created`** (incluye referencia completa de contacto, y referencias `messageContext`, `messageContactCard`, `messageLocation`, etc.).
- Endpoint: `POST /api/webhooks/callbell`.
- Responder **siempre 200** con `{"status":"ok"}` (Callbell hace health-checks; si no respondes ~10 min, alerta al admin).
- Validar `CALLBELL_WEBHOOK_SECRET` (header/query). **TODO:** confirmar el mecanismo de firma exacto de Callbell y endurecer.
- Filtrar: procesar solo mensajes **inbound del cliente** (ignorar outbound propios y status updates en este endpoint).
- **Filtrar por número de la IA:** la cuenta tiene varios números y un solo webhook. Solo se
  procesan los inbound al número de la IA (`AGENT_WHATSAPP_NUMBER=573332877350`); por número
  destino o, si no viene en el payload, por `channel_uuid` (`CALLBELL_WHATSAPP_CHANNEL_UUID`).
  El resto se descarta con `inbox_rejected`. Ver **ADR-0015** y `docs/09`.
- Normalizar teléfono a E.164 sin `+`.
- **Adjuntos (media):** imagen/audio/video/documento llegan en `payload.attachments`
  (**array de URLs**), con `payload.type` = `image|audio|...` y `payload.text` = caption (opcional).
  Se guarda la primera URL en `messages.media_url`; el bot transcribe el audio y ve las imágenes.
  Ver **ADR-0022** y `docs/15`.

Ejemplo (imagen con caption):
```json
{
  "event": "message_created",
  "payload": {
    "type": "image",
    "text": "¿este me sirve?",
    "attachments": ["https://.../archivo.jpg"],
    "contact": { "phoneNumber": "+57...", "uuid": "..." },
    "uuid": "..."
  }
}
```

```ts
// pseudo — procesamiento inline (sin cola async; ver ADR-0012)
export async function POST(req) {
  const sig = req.headers.get('x-callbell-secret');
  if (sig !== process.env.CALLBELL_WEBHOOK_SECRET) return json({status:'ok'}); // no filtrar info
  const body = await req.json();
  if (body?.event !== 'message_created' || isOutbound(body)) return json({status:'ok'});
  try { await processInboundMessage(normalize(body)); } catch (e) { logError(e); }
  return json({ status: 'ok' });
}
```

## 2. Enviar texto

```bash
POST /v1/messages/send
{
  "to": "573001234567",
  "from": "whatsapp",
  "type": "text",
  "content": { "text": "Hola! ..." },
  "channel_uuid": "<opcional>",
  "metadata": { "conversation_id": "<uuid interno>" }
}
```
Respuesta: `{ "message": { "uuid": "...", "status": "enqueued" } }` → guardar `uuid` en `messages.callbell_message_uuid`.

## 3. Enviar imagen (sistema `#ID`)

La IA escribe el `#ID` **inline** (`#ID7948237144230`); el backend lo extrae por regex,
busca el producto en `products` por `sku` y, por cada `#ID` **válido** (gate), envía:
```bash
POST /v1/messages/send
{
  "to": "573001234567",
  "from": "whatsapp",
  "type": "image",
  "content": { "url": "<products.image_url>", "text": "<caption opcional: nombre/precio>" }
}
```
> Dos tipos de envío: **sin imagen** = solo `sendText` (flujo normal); **con imagen** =
> `sendText` (texto limpio, sin el `#ID`) + un `sendImage` por cada `#ID` válido. Ver `docs/09`
> y ADR-0014. Sender abstraído (`sendImage(to, url, caption)`); `content.url` confirmado en
> el sender.

## 4. Handoff a logística

En `#orden-lista` / `#humano`:
1. Crear `orders` (+`order_items`).
2. Reasignar y apagar bot en un solo envío:
```bash
POST /v1/messages/send
{
  "to": "573001234567",
  "from": "whatsapp",
  "type": "text",
  "content": { "text": "¡Listo! Te paso con el equipo que confirma tu pedido y la entrega 🙌" },
  "team_uuid": "<CALLBELL_LOGISTICS_TEAM_UUID>",
  "bot_status": "bot_end"
}
```
- `team_uuid` reasigna la conversación al equipo de logística.
- `bot_status: bot_end` **detiene** al bot en esa conversación.
3. (Opcional) crear nota interna en la conversación con el resumen de la orden.
4. `conversations.status = 'handed_off'`, `assigned_team_uuid = <logística>`.

## 5. Ventana de 24h

- Si `now - last_inbound_at > 24h` → no se puede mandar mensaje normal; requiere **template**. v1: el gate marca `out_of_window`, registra en `events_log` y omite el envío. (Templates = backlog.)

## 6. Endpoints útiles (referencia)

- `GET /v1/messages/{uuid}/status` — estado de un mensaje.
- Contact messages API — historial de un contacto (paginado).
- `bot_status` (`bot_start`/`bot_end`), `assigned_user`, `team_uuid`, `metadata`, `channel_uuid` — todos soportados en `send`.
