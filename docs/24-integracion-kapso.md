# 24 — Integración Kapso (segundo proveedor de WhatsApp)

> **Qué es esto.** Kapso corre **en paralelo** a Callbell: cada agente elige su proveedor en
> `agents.provider` y los dos conviven en el mismo deploy. El cerebro (debounce, gate,
> órdenes, retargets, reactivaciones, Hotmart) es **el mismo**; solo cambia el transporte.
> Ver **ADR-0056**. La línea con la que arranca Kapso es **Hotmart** (`docs/17`).

**Lo primero que hay que entender:** Kapso **no es un proveedor tipo Callbell**. Es un **proxy
Meta-compatible**: los endpoints de envío son literalmente la forma de la **Cloud API de
WhatsApp de Meta**, con auth de Kapso. Por eso `lib/kapso/sender.ts` se parece más a la doc de
Meta que al sender de Callbell.

| | Callbell | Kapso |
|---|---|---|
| Base URL | `https://api.callbell.eu/v1` | `https://api.kapso.ai/meta/whatsapp/v24.0` |
| Auth | `Authorization: Bearer <key>` | `X-API-Key: <key>` |
| Envío | `POST /messages/send` (un endpoint, `type` en el body) | `POST /{phone_number_id}/messages` (forma de Meta) |
| Id del número | `channel_uuid` | `phone_number_id` (Meta Phone Number ID) |
| Id del mensaje | `uuid` | `wamid…` |
| Plantillas | por `uuid` | por **nombre + idioma** |
| Handoff | `team_uuid` + `bot_status` | **no existe** (ver §6) |
| Media entrante | `attachments: [url]` | `message.kapso.media_url` |
| Audio | lo transcribimos con Whisper | **Kapso ya lo transcribe** (ADR-0057) |

---

## 1. Configuración (qué pegar y dónde)

Todo se configura **por agente** en `/dashboard/agents/<id>` → *Proveedor de WhatsApp*:

1. **Proveedor**: `Kapso`.
2. **Kapso Phone Number ID**: el **Meta Phone Number ID** del número (no el teléfono).
   Está en Kapso → WhatsApp → Phone numbers. Es lo que enruta el inbound a este agente.
3. **Kapso API key**: la key del proyecto (Kapso → Integrations → API keys). Write-only.
4. **Secreto del webhook**: el mismo `secret_key` con el que registraste el webhook (§3).
5. **Idioma de las plantillas**: p. ej. `es_CO`.

Las env (`KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_SECRET`,
`KAPSO_TEMPLATE_LANGUAGE`) son **opcionales**: solo el fallback mientras se pegan los IDs en
el dashboard, igual que las de Callbell. Cada marca vive en su propio proyecto de Kapso, así
que lo normal es configurarlo por agente.

> **Migración `0026`** (`agents.provider` + columnas `kapso_*`) hay que aplicarla en Supabase.
> El orden respecto al deploy da igual: sin la migración, `provider` llega `undefined` → se
> resuelve a `callbell` → todo se comporta como hoy (ADR-0056).

## 2. Webhook (inbound)

- Endpoint: **`POST /api/webhooks/kapso`**.
- Evento: **`whatsapp.message.received`**.
- **Responder 200 en menos de 10 segundos.** Kapso reintenta (inmediato → 10s → 40s → 90s) y
  —importante— **auto-pausa el webhook** si en 15 min hay ≥20 entregas con ≥10 fallidas y ≥85%
  de fallos; reactivarlo es **manual** desde su dashboard. Por eso el endpoint responde 200
  casi siempre y el trabajo real va en background (`waitUntil`).
- **El nombre del evento va en el HEADER** `X-Webhook-Event`, no en el body (los payloads de
  WhatsApp no traen campo `event`; los de workflow sí).
- Enrutamiento: por **`phone_number_id`** (top-level en el payload) contra
  `agents.kapso_phone_number_id`. Sin agente → `inbox_rejected`.

Payload de un mensaje entrante (v2), recortado a lo que usamos:

```json
{
  "message": {
    "id": "wamid.123",
    "type": "text",
    "from": "16315551181",
    "text": { "body": "Hola" },
    "kapso": { "direction": "inbound", "has_media": false, "content": "Hola" }
  },
  "conversation": {
    "id": "conv_123",
    "phone_number": "16315551181",
    "phone_number_id": "123456789012345",
    "kapso": { "contact_name": "John Doe" }
  },
  "is_new_conversation": true,
  "phone_number_id": "123456789012345"
}
```

**Parsing defensivo (no es paranoia).** La doc de Kapso advierte textualmente: *"Do not assume
`phone_number`, `from`, `to`, or `wa_id` are always present"* — por el rollout de **BSUID** de
Meta (identidad sin teléfono). Por eso `getContactPhone` prueba `message.from` y luego
`conversation.phone_number`, y si no hay ninguno el mensaje se registra como
`inbox_indeterminate` en vez de reventar.

**Lotes.** Si el número tiene `buffer_enabled`, el payload cambia a
`{ type, batch: true, data: [ …, … ], batch_info }` y **TODOS** los eventos llegan así, incluso
los de un solo mensaje. Nosotros registramos el webhook con `buffer_enabled: false` (el
debounce es nuestro, ADR-0058), pero `unwrapEvents` tolera las dos formas por si alguien lo
enciende.

## 3. Registrar el webhook (Platform API)

```bash
POST https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/{phone_number_id}/webhooks
X-API-Key: <KAPSO_API_KEY>

{
  "whatsapp_webhook": {
    "kind": "kapso",
    "url": "https://<tu-dominio>/api/webhooks/kapso",
    "events": ["whatsapp.message.received"],
    "secret_key": "<el secreto que pegas en el dashboard>",
    "buffer_enabled": false
  }
}
```

El `secret_key` **lo eliges tú**. Se registra **por número**: si tienes varios, apúntalos
todos a la misma URL (el ruteo lo hace `phone_number_id`) y usa el mismo secreto salvo que
vivan en proyectos distintos.

## 4. Firma del webhook

Kapso firma con **HMAC SHA256** (hex) sobre el cuerpo, y manda el resultado en
**`X-Webhook-Signature`**.

**La doc se contradice**: dice *"Always verify against the raw JSON payload, not a parsed
object"*, pero **todos** sus ejemplos firman `JSON.stringify(req.body)` —que es una
re-serialización, no el cuerpo crudo—. Las dos solo coinciden si Kapso serializa exactamente
igual que nosotros.

Como no se puede saber cuál es sin tráfico real, `verifyKapsoSignature` **acepta las dos**. No
debilita nada: ambas exigen el secreto. La ruta lee el cuerpo con `await req.text()` (no
`req.json()`) justo para poder verificar los bytes originales. Sin secreto configurado no se
bloquea (dev), igual que en Callbell.

## 5. Enviar

Todos los envíos son `POST /v24.0/{phone_number_id}/messages` con la forma de Meta:

```jsonc
// texto
{ "messaging_product": "whatsapp", "to": "573001234567", "type": "text",
  "text": { "body": "Hola!" } }

// imagen (sistema #ID) — link directo, sin re-hospedar (ADR-0049)
{ "messaging_product": "whatsapp", "to": "573001234567", "type": "image",
  "image": { "link": "<products.image_url>", "caption": "<nombre>" } }

// plantilla (único envío permitido fuera de la ventana de 24h)
{ "messaging_product": "whatsapp", "to": "573001234567", "type": "template",
  "template": { "name": "carrito_abandonado", "language": { "code": "es_CO" },
    "components": [ { "type": "body", "parameters": [ { "type": "text", "text": "Ana" } ] } ] } }
```

Respuesta: `{ "messages": [ { "id": "wamid…" } ] }` → el `wamid` se guarda en
`messages.callbell_message_uuid` (que desde ADR-0056 es "el id del mensaje **del proveedor**").

### HTTP 409 "in-flight" — la diferencia que más duele

Kapso responde **409** si *"Another message is already in-flight for this conversation"*.
Callbell no hace esto. Nuestro flujo manda **texto + N imágenes seguidas** (una respuesta con
varios `#ID`), así que se choca de frente. El sender **reintenta con backoff** (400/1200/2500
ms) y solo se rinde después. Si aparecen muchos `retarget_error`/`text_sent` fallidos con 409
en producción, subir esos tiempos es el primer ajuste.

### Otros códigos

- **422 + `131047`** → fuera de la ventana de 24h (requiere plantilla). No se reintenta.
- **429** → rate limit (la Platform API documenta 100–1000 req/min por plan; **los límites de
  la API de envío NO están documentados**).
- Hay **dos formas de error distintas**: la de Meta (`{error:{message,code}}`) en el proxy y la
  plana (`{error:"texto"}`) en la Platform API. `errorMessage()` entiende las dos.

## 6. Handoff

Kapso **no tiene equipos ni un bot propio que apagar**, así que `team_uuid`/`bot_status` no
existen y el adaptador los ignora (`supportsHandoff = false`).

**El handoff sigue funcionando**: con `#orden-lista`/`#humano` se crea la orden, se manda el
texto de cierre y la conversación queda en `status = 'handed_off'` — y eso es lo que de verdad
calla a nuestra IA (`runDebouncedReply` no responde si la conversación no está `active`). Lo
que NO ocurre es la reasignación a un equipo dentro del proveedor: en Kapso el reparto al
humano se hace desde su **Inbox** (`inbox.kapso.ai`).

## 7. Ventana de 24h

Igual que siempre: fuera de la ventana solo entran **plantillas**. Kapso **no expone** ningún
campo tipo "ventana abierta" ni "expires_at" (lo más cercano es
`conversation.kapso.last_inbound_at`), así que la ventana la seguimos calculando nosotros
contra `conversations.last_inbound_at` — el mismo gate de siempre (`out_of_window`).

## 8. Plantillas

Se referencian por **nombre + idioma**, no por uuid. El campo de la base
(`hotmart_templates.template_uuid`, `agents.reactivation_template_7d/15d`) guarda:

- **Callbell** → el uuid de la plantilla.
- **Kapso** → el **nombre** aprobado en Meta (`carrito_abandonado`), o `nombre:idioma`
  (`carrito_abandonado:en_US`) para forzar un idioma distinto al del agente.

Las **variables son posicionales** (`{{1}}`, `{{2}}`…), en el mismo orden en que aparecen los
tokens `{{nombre}}`/`{{producto}}` del texto configurado en el dashboard (ADR-0040). La
plantilla aprobada en Meta debe usar variables posicionales.

> **La plantilla debe existir en la cuenta del proveedor del agente.** Una plantilla de
> Callbell no sirve en Kapso: hay que crearla/aprobarla en Meta y poner su nombre.

## 9. Media entrante

La URL llega en `message.kapso.media_url`. **La doc NO dice si esa URL requiere auth para
descargarse** (ver §11). Por eso `fetchMedia` intenta primero **sin credenciales** y solo si
Kapso responde 401/403 reintenta con la API key del agente (`X-API-Key`): funciona en los dos
escenarios sin tener que saberlo de antemano. El `hostPattern` evita que la key salga hacia
un host que no sea Kapso.

**Audio:** Kapso lo transcribe solo y manda el texto en `message.kapso.transcript.text`. Se
guarda como el `content` del mensaje en la ingesta, y con eso el cerebro **no llama a
Whisper** (solo transcribe si el content está vacío). Ver **ADR-0057**.

## 10. Usar Kapso solo como pasarela (y no despertar su IA)

Es un caso de uso oficial suyo (*"Use Kapso as your WhatsApp API"*). Su motor de IA son los
**Workflows**, y **son opt-in**: solo corren si hay un workflow con un **trigger de WhatsApp**
activo en ese número.

> ⚠️ **Cuidado**: un workflow con trigger de WhatsApp *"intercepts messages before they reach
> agents"*. Si alguien crea uno en nuestro número, podría alterar el flujo antes de que llegue
> al webhook. Regla: **ningún workflow con trigger de WhatsApp** en los números que use este
> backend.

## 11. Pendientes de verificar (contra tráfico real)

La doc de Kapso deja tres cosas ambiguas. El código **tolera ambos casos** en los tres, así
que no bloquean el arranque, pero conviene cerrarlos con la primera prueba real:

1. **Firma**: ¿cuerpo crudo o `JSON.stringify`? Hoy se aceptan los dos (§4). Al confirmarlo se
   puede cerrar a uno solo.
2. **Auth de `media_url`**: ¿pública o requiere `X-API-Key`? Hoy se intenta sin y se reintenta
   con (§9). Si resultara que caduca rápido, existe el camino documentado
   `GET /v24.0/{media_id}?phone_number_id=…` → `download_url` (token embebido, 4 min).
3. **Rate limits de la API de envío**: no publicados. Vigilar 429 al mandar ráfagas.

## 12. Prueba de humo (checklist)

1. Aplicar la migración `0026` en Supabase.
2. Crear el agente en `/dashboard/agents/new` con proveedor **Kapso** + Phone Number ID + API
   key + secreto, y su prompt/catálogo.
3. Registrar el webhook del número (§3) apuntando al dominio desplegado.
4. Escribirle al número → debe aparecer la conversación en `/dashboard/conversations` y el bot
   debe responder (~12s por el debounce).
5. Mandar una **nota de voz** → el hilo debe mostrar el texto transcrito (sin costo de audio en
   Reportes: es de Kapso, ADR-0057).
6. Mandar una **foto** → el bot debe reaccionar a la imagen (visión).
7. Pedir un producto para que la respuesta traiga `#ID` → deben llegar **texto + imagen**
   (aquí se ejercita el 409 in-flight).
8. **Hotmart**: en `/dashboard/hotmart`, apuntar el selector al agente de Kapso, crear la
   plantilla con su **nombre** y disparar un carrito de prueba (`docs/17` §10).
9. Revisar `events_log`: `webhook_received`, `reply_generated`, `text_sent`/`image_sent`, y que
   NO haya `inbox_rejected` (sería un `phone_number_id` mal pegado) ni
   `webhook_signature_rejected` (secreto distinto al registrado).

## Referencias

- `docs/04-integracion-callbell.md` — el equivalente del otro proveedor.
- `docs/16-multi-agente.md` — enrutamiento por agente (ADR-0023).
- `docs/17-hotmart-carritos.md` — la línea con la que arranca Kapso.
- **ADR-0056** (puerto y adaptadores), **ADR-0057** (transcripción), **ADR-0058** (debounce).
- Doc de Kapso: <https://docs.kapso.ai/docs/introduction> · `llms-full.txt` y los OpenAPI
  (`openapi-whatsapp.yaml`, `openapi-platform.yaml`) son la fuente autoritativa.
