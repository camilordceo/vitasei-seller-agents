# 16 — Multi-agente / multi-marca (enrutamiento dinámico por número)

> La plataforma pasa de **un solo agente** a **muchos agentes**. Agregar Vitasei USA/México
> (o cualquier marca/número) es "pegar unos IDs" en el dashboard: su número empieza a llegar y
> a responder con **su propia IA, catálogo y cuenta del proveedor**. Sin tocar código.
>
> **Desde ADR-0056** cada agente además elige su **proveedor de WhatsApp** (`agents.provider`:
> Callbell o **Kapso**) y guarda las credenciales de ese proveedor. Los dos conviven en el mismo
> deploy. Este documento describe el enrutamiento y la config común; lo específico de Kapso
> (webhook, firma, plantillas por nombre, handoff) está en **`docs/24-integracion-kapso.md`**.

## 1. Problema

Todo estaba amarrado a env globales: un número (`AGENT_WHATSAPP_NUMBER`), un canal
(`CALLBELL_WHATSAPP_CHANNEL_UUID`), un equipo de logística, un vector store, y **una** fila
`agent_config` activa que servía a todas las conversaciones. No había forma de que un segundo
número respondiera con otra IA.

## 2. Modelo: la tabla `agents`

Cada fila de `agents` es una **marca/número** (migración `0010_agents.sql`):

| Campo | Para qué |
|---|---|
| `name`, `brand`, `country` | Identidad (ej. "Vitasei CO") |
| `whatsapp_number` | Enrutamiento/-display (E.164 sin `+`) |
| `callbell_channel_uuid` | Enrutamiento + envío (canal de esa línea) |
| `callbell_api_key` | **Secreto**. Otras marcas viven en otra **cuenta** de Callbell |
| `logistics_team_uuid` | Handoff (equipo de esa cuenta) |
| `vector_store_id` | Catálogo OpenAI (file_search) |
| `model`, `system_prompt`, `temperature` | La IA de esa marca |
| `enabled` | Prender/apagar el agente |

- **OpenAI API key: global** (env). **Callbell API key + canal: por agente**. `logistics_team_uuid`
  y `vector_store_id` también por agente.
- `conversations.agent_id` y `products.agent_id` amarran cada conversación y cada producto a su
  agente. El catálogo es **por marca** (`unique (agent_id, sku)`): el gate de `#ID` y las imágenes
  se validan contra el inventario de ESA marca.

## 3. Flujo por mensaje (qué cambió)

```
Webhook Callbell (un solo webhook para todos los números)
  └─ resolveAgentForInbound(payload): matchea el agente por channel_uuid o número
       · sin agente → inbox_rejected (no es un número nuestro)
  └─ ingesta: guarda conversation.agent_id
Respuesta (debounce, background)
  └─ carga el AGENTE de la conversación (no una config global)
  └─ genera con SU prompt/modelo/vector store; envía con SUS credenciales de Callbell
  └─ gate/imágenes filtran products por agent_id
Retargets / reactivaciones / envío manual → mismas credenciales del agente de la conversación
```

Piezas clave:
- `lib/callbell/routing.ts` — `matchAgent` (puro, testeado): canal primero, número después.
- `lib/agent/agents.ts` — `resolveAgentForInbound`, `loadAgentForConversation`, y los helpers
  `agentCallbellCreds` / `agentTeamUuid` / `agentVectorStoreId` (cada uno con **fallback a env**).
- `lib/callbell/sender.ts` — `sendText/sendImage/sendTemplate(creds, …)` reciben las credenciales
  del agente (`CallbellCreds`: API key + canal). `credsFromEnv()` es el fallback single-agent.

## 4. Cero downtime (transición)

El enrutamiento y el envío resuelven **DB primero, env como fallback**. El agente seed arranca
con `callbell_*` en NULL ⇒ usa las env actuales de Vercel. Cuando pegas los IDs del agente actual
en el dashboard, la DB toma el control. Nada se cae en el intermedio.

## 5. Dashboard → sección **Agentes**

`/dashboard/agents`: lista de agentes (nombre, marca/país, número, si tiene canal/API key/catálogo
propios, modelo) + **Nuevo agente**. El detalle (`/dashboard/agents/[id]`) edita todo con una
Server Action (`saveAgent`/`createAgent`, service-role tras Basic Auth). La **API key de Callbell
es write-only**: se muestra enmascarada (`•••• 1234`) y solo se reescribe si pegas una nueva; las
queries del dashboard nunca devuelven el valor crudo.

## 6. Catálogo por marca

`POST /api/catalog/load` y `scripts/import-catalog-csv.mjs --agent <id>` aceptan `agentId`:
suben al vector store de ESE agente y hacen upsert de `products` con su `agent_id`
(`unique (agent_id, sku)`). Sin `agentId`, usan el agente seed (compat).

## 7. Seguridad del secreto

`callbell_api_key` vive en Postgres, accedido **solo server-side** (service-role tras Basic Auth).
Nunca llega al cliente (queries enmascaran; el editor lo trata write-only). RLS de `agents` está
habilitada **sin** policy de lectura para `authenticated` (a diferencia de las demás tablas).
Trade-off aceptado; futuro: cifrado/KMS.

## 8. Cómo agregar una marca (operativa)

1. (Offline) Crear el vector store del catálogo en OpenAI y cargar `products` con
   `--agent <id>` (o desde el dashboard tras crear el agente).
2. En **Agentes → Nuevo agente**: pegar número, `channel_uuid`, `callbell_api_key` (si es otra
   cuenta), `team_uuid`, `vector_store_id`, prompt y modelo. Guardar (queda habilitado).
3. Apuntar el webhook de esa línea de Callbell a `/api/webhooks/callbell` (mismo endpoint).
4. Enviar un WhatsApp al número nuevo → responde con su IA.

## 9. Fuera de alcance / pasos manuales

- Aplicar `supabase/migrations/0010_agents.sql` (crea `agents`, agrega `agent_id`, siembra el
  agente actual y hace backfill).
- Pegar en el dashboard los IDs del agente actual (o dejar el fallback a env).
- Cifrado del `callbell_api_key` (futuro).
- Plantillas de reactivación por-agente: hoy la config de plantillas (`app_settings`) es global;
  el envío ya usa la cuenta/canal del agente. Multi-cuenta de plantillas: backlog.
- `agent_config` queda como tabla **legacy** (historial de prompt); el runtime ya no la lee.
