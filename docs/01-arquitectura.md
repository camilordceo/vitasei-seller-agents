# 01 — Arquitectura

## 1. Componentes

| Componente | Tecnología | Rol |
|------------|-----------|-----|
| Webhook receiver | Next.js Route Handler (`/api/webhooks/callbell`) en Vercel | Recibe `message_created`, responde 200 inmediato, encola |
| Orquestador async | Inngest | Procesa el mensaje fuera del request del webhook |
| Generación | OpenAI **Responses API** + `file_search` | **Una** llamada genera la respuesta sobre el catálogo |
| Conocimiento | OpenAI **Vector Store** | Catálogo indexado (chunking/embeddings los hace OpenAI) |
| Datos / estado | Supabase Postgres | contacts, conversations, messages, products, orders, logs |
| Imágenes | Supabase Storage | URLs públicas de imágenes de producto |
| Envío WhatsApp | Callbell `POST /v1/messages/send` | Texto e imágenes; handoff con `team_uuid` + `bot_status` |
| UI | Next.js + Supabase Auth | Dashboard de conversaciones |

## 2. Flujo inbound (por mensaje)

Es una **IA simple**: **una sola** llamada a Responses por mensaje. No hay loop de tools ni
razonamiento iterativo — `file_search` es hosted, así que OpenAI busca en el catálogo y
responde en esa misma llamada. La respuesta se guarda como mensaje y se envía.

```
Cliente WhatsApp
   │  escribe
   ▼
Callbell ──(webhook message_created)──► POST /api/webhooks/callbell
                                          │ 1. valida secret
                                          │ 2. responde 200 {"status":"ok"}  ← rápido
                                          │ 3. inngest.send("whatsapp/message.received")
                                          ▼
                              Inngest function: processMessage
   ┌──────────────────────────────────────────────────────────────────┐
   │ contexto  guardar inbound; cargar previous_response_id / historial │
   │ GENERAR   1× responses.create: system prompt + file_search +       │
   │           input (turno actual)  → texto del modelo                 │
   │ preparar  quitar los tags del texto (cleanText) + GATE: descartar  │
   │           #ID cuyo SKU no exista en products; chequear ventana 24h │
   │ enviar    Callbell: texto; por cada #ID válido, imagen; si         │
   │           #orden-lista → crear orden + handoff (team + bot_end)    │
   │ guardar   mensaje outbound (cleanText + tags), response_id, eventos │
   └──────────────────────────────────────────────────────────────────┘
```

Una llamada al modelo; el resto es código determinista (parseo + un lookup en `products` +
envío). Cada paso loguea en `events_log`.

## 3. Estado de conversación (Responses API)

- Guardamos `openai_previous_response_id` en `conversations`.
- En cada turno: si existe `previous_response_id` → se pasa para encadenar; si no (o si caducó / conversación vieja), se reconstruye `input` con los últimos N mensajes desde Supabase.
- **Supabase es la fuente de verdad** del historial (no dependemos solo del retention de OpenAI).

## 4. Webhook: respuesta rápida obligatoria

Callbell hace connection checks y espera `200` con `{"status":"ok"}`; si el endpoint no responde ~10 min, alerta al admin. Por eso el handler **nunca** hace el trabajo pesado inline: valida, encola en Inngest y responde 200. Si Callbell hace un health-check (ping sin mensaje), responder 200 `{"status":"ok"}` sin encolar.

## 5. Idempotencia y orden

- Cada `message_created` trae un `message uuid` de Callbell → usarlo como **idempotency key** (no procesar dos veces).
- Inngest: `concurrency` por `conversation_id` para evitar respuestas pisadas si el cliente manda varios mensajes seguidos. Opcional: pequeño **debounce** (esperar ~3-5s y agrupar mensajes consecutivos del mismo contacto en un solo turno de razonamiento).

## 6. Ventana de 24h (WhatsApp)

- Dentro de 24h del último mensaje del cliente → mensajes normales (texto/imagen).
- Fuera de 24h → requiere **template message**. v1 asume que el agente siempre responde dentro de la ventana (el cliente inició). El gate marca y omite envíos fuera de ventana, registrando el caso para revisión.

## 7. Variables de entorno

Ver `.env.example`. Mínimo:
```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.1                # configurable
OPENAI_VECTOR_STORE_ID=             # se setea tras crear el store (Sprint 2)
CALLBELL_API_KEY=
CALLBELL_WEBHOOK_SECRET=            # secret compartido para validar webhook
CALLBELL_LOGISTICS_TEAM_UUID=       # equipo al que se reasigna en handoff
CALLBELL_WHATSAPP_CHANNEL_UUID=     # opcional, si hay varios canales
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # solo backend
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

## 8. Seguridad

- Webhook Callbell: validar `CALLBELL_WEBHOOK_SECRET` (header o query token). **TODO Sprint 1:** confirmar mecanismo de firma de Callbell y endurecer.
- `SUPABASE_SERVICE_ROLE_KEY` solo en server (Inngest functions / route handlers), nunca expuesto al cliente.
- RLS activado en todas las tablas; dashboard usa anon key + policies.
- No guardar datos sensibles (tarjetas, cuentas) en metadata de Callbell ni en logs.
