# 25 — Llamadas con IA (Synthflow)

> **Estado:** PRD + contrato de API verificado contra la cuenta real (2026-07-18).
> ADRs: [0060](decisions/0060-synthflow-assistant-referenciado-y-override-por-llamada.md) ·
> [0061](decisions/0061-webhook-como-aviso-api-como-fuente-de-verdad.md) ·
> [0062](decisions/0062-extractores-configurables-por-agente.md) ·
> [0063](decisions/0063-cadencia-de-llamadas-por-agente.md)

El agente ya vende por WhatsApp. Esta feature le da **voz**: llamadas telefónicas hechas por
IA (Synthflow), agendadas desde el flujo de WhatsApp o disparadas a mano, con el resultado
(transcript, grabación, datos extraídos, minutos) de vuelta en la conversación.

---

## 1. Qué se construye

1. **IA de llamadas por agente.** Cada agente puede tener su propio cerebro de voz: prompt de
   llamada, saludo, voz, assistant de Synthflow y número saliente.
2. **Cadencia configurable y prendible/apagable.** N etapas por agente:
   *1 llamada a los 10 min del primer mensaje*, o *3 llamadas: al llegar, a 24h y a 72h*.
   Se puede acotar por país (prefijo E.164).
3. **Extractores de información por agente** (producto, dirección, nombre, método de pago…),
   configurables desde el dashboard. La sincronización con Synthflow es **un botón aparte**: el
   guardado normal no lo toca, porque actualizar el assistant lo pasa a una versión nueva y le
   cambia la voz (ADR-0085). También se pueden **traer** los que ya existan en su panel.
4. **Disparo manual** de una llamada desde el detalle de la conversación.
5. **Sección Llamadas unificada**: realizadas + programadas, filtrable y buscable por teléfono,
   con detalle (transcript + audio) y **cancelación masiva** de las programadas.
6. **Resultado como nota** en la conversación + **minutos y costo** logueados.
7. **Filtro en Conversaciones**: cuáles tuvieron llamada con IA.

**Fase 2 (fuera de este alcance):** knowledge base (se carga desde Synthflow), llamadas
entrantes (`inbound_call_webhook_url`), campañas masivas fuera de conversación.

> **Continuación:** el **resultado de la llamada → orden** y las **campañas masivas** ya están
> implementados en [docs/29](29-resultado-de-llamada-y-campanas.md) (ADR-0083 y ADR-0084,
> migración `0032`); el **guardado que no toca Synthflow** y el **saludo con variables** están en
> docs/29 §2.7 y §5 (ADR-0085 y ADR-0086, migración `0033`). Esas dos features cambian cosas de este documento: `voice_calls` gana
> `outcome`, `order_id`, `campaign_id`, `contact_name` y `variables`; `conversation_id` y
> `contact_id` pasan a ser opcionales; y el cron pasa a correr **cada minuto**.

---

## 2. Contrato de la API de Synthflow — VERIFICADO contra la cuenta real

> No confiar en la documentación de Synthflow sin verificar: **tres puntos centrales de su doc
> están mal** y romperían la implementación. Todo lo de abajo se probó contra el workspace real
> el 2026-07-18 (82 assistants, 43 actions, 977 objetos `executed_actions` de llamadas reales).

### 2.1 Auth y región
- `Authorization: Bearer <SYNTHFLOW_API_KEY>`
- **La región importa.** El workspace vive en la global: `https://api.synthflow.ai/v2`.
  Las bases `api.us` y `api.eu` devuelven **401 con la misma key** (no 404), así que un 401
  puede significar "región equivocada", no "key inválida".
- `workspace_id` (requerido en `/voices` y `/numbers`) es **distinto** de la API key.

### 2.2 Voces — `GET /v2/voices?workspace=<ws>&limit=100&offset=N`
2.108 voces en la cuenta. Objeto real:
```json
{ "voice_id": "vQSmovmw0GQKhfDjdkLJ", "name": "Clarice – Soft & Smooth…",
  "preview": "https://storage.googleapis.com/…/9J6qfWGJ3y8gt2SW7Ox6.mp3",
  "workspace": "<SYNTHFLOW_WORKSPACE_ID>",
  "provider": "elevenlabs", "gender": "female", "languages": ["english"] }
```
- `preview` **sí viene poblado** (la doc lo muestra vacío) → se puede escuchar la voz en el dashboard.
- ⚠️ `languages` es **inconsistente**: conviven `"english"` y `"en"`, `"es"`, `"pt"`… El filtro
  de idioma debe normalizar por prefijo (`es*`), no por igualdad.

### 2.3 Llamada saliente — `POST /v2/calls`
Requeridos: `model_id`, `phone`, **`name`** (fácil de omitir; está en el `required` del schema).
Opcionales clave: `from_phone_number`, `custom_variables`, **`prompt`**, **`greeting`**.
```json
{ "model_id": "…", "phone": "+573001112233", "name": "Camilo",
  "from_phone_number": "+576015110375",
  "custom_variables": [{ "key": "producto", "value": "Colágeno" }],
  "prompt": "…", "greeting": "…" }
```
→ `{"status":"success","response":{"answer":"ok","call_id":"…"}}`
- **`prompt` y `greeting` se pueden sobreescribir por llamada** → es lo que nos permite inyectar
  el contexto de la conversación sin mutar el assistant (ADR-0060).
- Variables se referencian en el prompt con **llaves**: `{producto}`.
- ⚠️ `custom_variables` es **array** de `{key,value}` aquí, pero **objeto** en otros endpoints
  de su doc. Usar array en `POST /v2/calls`.
- ⚠️ El teléfono va en **E.164 con `+`** — al revés de nuestra convención interna (sin `+`).
- **No existe campo de agendamiento.** La llamada sale de inmediato → el scheduling es nuestro.

### 2.4 Extractores — `POST /v2/actions` + `POST /v2/actions/attach`
Creación (probada, y luego borrada):
```json
{"INFORMATION_EXTRACTOR":{"SINGLE_CHOICE":{
  "identifier":"metodo_pago","description":"Método de pago que prefiere",
  "choices":["contra entrega","addi","transferencia"]}}}
```
→ `{"status":"success","response":{"action_id":"36b0e74a-…","action_type":"Information Extractor"}}`

**Cómo lo guarda realmente** (`GET /v2/actions/{id}`) — el `description` que mandamos se
normaliza a `parameters_hard_coded.condition`, y el `name` se genera solo:
```json
{ "action_id":"36b0e74a-…", "action_type":"INFORMATION_EXTRACTOR",
  "name":"info_extractor_metodo_pago", "description":"",
  "parameters_hard_coded":{ "type":"SINGLE_CHOICE","identifier":"metodo_pago",
    "condition":"Método de pago que prefiere","choices":[…],"examples":[] },
  "input_variables":{"values":[],"assistants":[]}, "assistants":[] }
```
Tipos: `OPEN_QUESTION` (usa `examples[]`), `SINGLE_CHOICE` (usa `choices[]`), `YES_NO`.
Attach: `POST /v2/actions/attach` con `{"model_id":"…","actions":["<action_id>"]}`.

> ⚠️ Regla dura de Synthflow: **el texto del extractor debe ser plano**. Pedir JSON o usar
> `{} [] <>` puede dejar la llamada colgada en "in progress" indefinidamente.

### 2.5 Resultado de los extractores — **el hallazgo crítico**
Llegan en `executed_actions`, **no** en `collected_variables`. Objeto real de producción:
```json
"extract_info_telefonocelular": {
  "name": "extract_info_telefonocelular",
  "action_type": "extract_info_action_type",
  "description": "Get information with question: Extrae el telefono…",
  "parameters_hard_coded": "{\"identifier\": \"telefonocelular\", …}",
  "parameters_from_llm": "{}",
  "error_message": "",
  "return_value": "{\"telefonocelular\": \"387506619\"}",
  "return_value_status": "", "is_relevant_action": "true",
  "timestamp_datetime": "2025-10-26T10:34:09.638940", "timestamp": "1761474849.63"
}
```

Cuatro trampas, todas confirmadas sobre 977 objetos reales:

1. **`return_value` es un STRING con JSON adentro, no un objeto.** La doc lo muestra como
   objeto. Hay que `JSON.parse` — y tolerar que falle.
2. **Hay DOS prefijos de clave conviviendo**: `extract_info_<identifier>` (histórico) e
   `info_extractor_<identifier>` (el que genera hoy la API — lo confirmamos creando uno).
   El parser debe aceptar ambos.
3. **El identifier puede tener espacios** (`info_extractor_nombre y apellido`), así que no se
   puede asumir slug limpio. Se resuelve leyendo la clave *dentro* de `return_value`.
4. **El valor no siempre es escalar.** Formas reales observadas:
   `{}` · `{"id": null}` · `{"id":"Arriendo"}` · `{"id":1500000}` ·
   `{"id":{"nombre_cliente":"Enrique Ruiz","tipo_inmueble":"apartamento"}}` · y hasta anidado
   en dos niveles (`{"caracteristicas":{"habitaciones":2,"parqueadero":true}}`).

`action_type` observados: `extract_info_action_type` y `custom_function_action_type`.

### 2.6 Registro de la llamada — `GET /v2/calls/{call_id}` y `GET /v2/calls?model_id=…`
⚠️ **`GET /v2/calls/{call_id}` devuelve igual un array paginado** `response.calls[0]`, no el
objeto suelto. Campos útiles (verificados): `call_id`, `model_id`, `call_status`, `duration`
(segundos), `end_call_reason`, `transcript` (string `"bot: …\nhuman: …"`, no turnos),
`recording_url`, `executed_actions`, `collected_variables`, `phone_number_from/to`,
`lead_phone_number`, `start_time`, `telephony_duration` (**milisegundos**, ≠ `duration`).

Desalineaciones webhook ↔ API (a normalizar en un solo sitio):
| | webhook | API |
|---|---|---|
| estado | `call.status` | `call_status` |
| inicio | ISO-8601 | epoch **ms** en string |

`call_status` observados: `completed`, `failed`, `no-answer`, `hangup_on_voicemail`,
`busy`, `in-progress`, `pending`, `canceled`.

### 2.7 Webhook
- Post-call → `external_webhook_url` (por assistant). Evento entrante → `inbound_call_webhook_url`.
- Firma: HMAC-SHA256 **base64**, header documentado como `HTTP_SYNTHFLOW_SIGNATURE`
  (grafía WSGI; en el cable casi seguro `Synthflow-Signature` → comparar case-insensitive
  contra varias grafías).
- ⚠️ **Se firma solo el `call_id`, no el cuerpo.** Eso autentica al emisor pero **no da
  integridad del payload** → no confiar en el cuerpo para nada que mueva plata (ADR-0061).
- El webhook **no trae costo ni resumen**. `analysis.call_summary === "true"` es un flag de
  juez, no un resumen.

### 2.8 Costo y minutos
No hay costo en la API (`/v2/analytics` da `duration_metrics.total_minutes`, sin plata;
`/v2/analytics/export`, `/v2/credits`, `/v2/usage` → **404**).
→ **Lo calculamos nosotros**: `duration_sec / 60 × SYNTHFLOW_USD_PER_MINUTE` (default `0.20`,
rango de mercado 0.15–0.24), en `lib/synthflow/pricing.ts`, igual que `lib/openai/pricing.ts`.

### 2.9 Números
`GET /v2/numbers?workspace=…` devolvió **0 registros** aunque los assistants sí tienen
`attached_phone_numbers: [{number, sid: null, slug}]` → son números importados (BYO). El
`from_phone_number` se toma de ahí, no de `/v2/numbers`.

### 2.10 Estado de la cuenta al integrar
82 assistants (23 inbound / 50 outbound / 9 widget). **Los dos assistants que nos dieron
(`ed835bbc…` +576015110375 y `b197e6e7…` +576015148837) son de Rentmies (inmobiliaria), son
`type: "inbound"` y ya apuntan su `external_webhook_url` a Bubble.**
→ **No se tocan.** Ver ADR-0060: no mutamos assistants ajenos y no dependemos del webhook.

---

## 3. Modelo de datos (migración `0027_voice_calls.sql`)

### `agents` — columnas nuevas
| Columna | Tipo | Para qué |
|---|---|---|
| `voice_enabled` | boolean default false | Prender/apagar la IA de llamadas del agente |
| `synthflow_api_key` | text | Secreto por agente (null → env) |
| `synthflow_model_id` | text | Assistant de Synthflow que ejecuta la llamada |
| `synthflow_from_number` | text | Número saliente (E.164 con `+`) |
| `voice_id` / `voice_name` | text | Voz elegida (el nombre solo para mostrar) |
| `voice_prompt` | text | **Prompt de voz, separado del de WhatsApp** |
| `voice_greeting` | text | Saludo de apertura |
| `voice_config` | jsonb | Etapas `[{delayMinutes, guidance}]` |
| `voice_countries` | jsonb | Prefijos E.164 permitidos (`["57"]`); vacío = todos |
| `voice_extractors` | jsonb | `[{identifier,type,condition,choices,examples,actionId}]` |
| `voice_stop_when_answered` | boolean default true | Cortar las etapas siguientes si ya contestó |

Se leen en consultas aparte, resilientes a `42703`, **fuera de `AGENT_COLS`** — igual que
`retarget_config` y `payment_methods`, para no arriesgar la ruta crítica de inbound si la
migración no está aplicada todavía.

### `voice_calls` — tabla nueva
`id`, `conversation_id`, `contact_id`, `agent_id`, `phone`, `stage`, `delay_minutes`,
`trigger` (`auto|manual|request`), `status`, `scheduled_at`, `placed_at`, `started_at`,
`ended_at`, `synthflow_call_id` (unique), `synthflow_model_id`, `call_status`,
`end_call_reason`, `duration_sec`, `cost_usd`, `transcript`, `recording_url`, `summary`,
`extracted` jsonb, `anchor_inbound_at`, `error`, `created_at`, `updated_at`.

`status` es **text + CHECK** (no enum) siguiendo ADR-0055/0056: agregar un estado no exige
`ALTER TYPE`. Valores: `scheduled · processing · placed · completed · no_answer · failed ·
cancelled · skipped`.

Índices: `(status, scheduled_at)` para el cron, `(conversation_id)`, `(phone)` para la
búsqueda por teléfono, unique `(synthflow_call_id)` para idempotencia, y el **parcial**
`unique (conversation_id, stage) where status in ('scheduled','processing')` que evita
duplicar una etapa viva (mismo truco que `retargets`).

---

## 4. Flujo

### 4.1 Agendamiento (automático)
Al **primer inbound** de una conversación (`source = whatsapp`), si el agente tiene
`voice_enabled` y el teléfono pasa el filtro de país → se insertan N filas `scheduled` según
`voice_config`, ancladas en `last_inbound_at`.

### 4.2 Cron `/api/cron/voice-calls` (cada 5 min)
1. Toma las vencidas (`status='scheduled'`, `scheduled_at <= now`), **claim atómico**
   `scheduled → processing` (idéntico a retargets: dos crones solapados no llaman dos veces).
2. Guardas antes de marcar: conversación `active`, no `ai_paused`, sin orden, agente sigue
   con `voice_enabled`, y **dentro del horario del agente** (`isAgentActiveNow`) — si está
   fuera de horario **difiere** (vuelve a `scheduled`), no cancela. *Nadie debe recibir una
   llamada de ventas a las 3am.*
3. `POST /v2/calls` con prompt + saludo + `custom_variables` de contexto → guarda
   `synthflow_call_id`, `status='placed'`.
4. **Reconciliación**: las `placed` sin desenlace se consultan por API y se cierran. Esto hace
   que el sistema funcione **aunque el webhook nunca se configure**.

> **No se aplica la ventana de 24h de WhatsApp.** Es la diferencia de fondo con retargets:
> una llamada a las 72h es perfectamente válida.

### 4.3 Cierre de la llamada
Por webhook (rápido) o por reconciliación (red de seguridad) — ambos caen en la misma función:
1. Se lee la llamada por API (fuente de verdad).
2. Se normaliza `executed_actions` → `extracted`.
3. Se guardan `duration_sec`, `cost_usd`, `transcript`, `recording_url`.
4. Se escribe la **nota** en la conversación (`messages`, `role='system'`, `type='other'`,
   `tags:['#llamada-ia']`) y se loguea `voice_call_completed` en `events_log`.
5. Si `voice_stop_when_answered` y la llamada fue contestada → se cancelan las etapas restantes.

### 4.4 Cancelación
- Manual: 1 clic, o multi-selección con checkboxes → acción masiva.
- Automática: al crear orden, al cerrar/handoff, o si el agente apaga `voice_enabled`.

---

## 5. Configuración

| Env | Default | Para qué |
|---|---|---|
| `SYNTHFLOW_API_KEY` | — | Key global (cada agente puede sobreescribirla) |
| `SYNTHFLOW_API_BASE` | `https://api.synthflow.ai/v2` | Región del workspace |
| `SYNTHFLOW_WORKSPACE_ID` | — | Requerido para listar voces |
| `SYNTHFLOW_WEBHOOK_SECRET` | — | Firma del post-call webhook |
| `SYNTHFLOW_USD_PER_MINUTE` | `0.20` | Costo estimado por minuto |
| `VOICE_CALLS_ENABLED` | `false` | Kill switch global |

**Apagado por defecto.** Prender exige: aplicar `0027`, poner las envs, y prender
`voice_enabled` en el agente. Tres cerraduras, porque el fallo aquí llama a un cliente real.
