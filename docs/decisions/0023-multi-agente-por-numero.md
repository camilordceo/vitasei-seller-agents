# ADR-0023: Multi-agente / multi-marca (enrutamiento dinámico por número)

- **Estado:** Aceptada
- **Fecha:** 2026-07-02
- **Sprint:** post-6 (feature)

## Contexto

La plataforma era single-tenant: un número, un canal, un equipo de logística, un vector store y
una fila `agent_config` activa servían TODAS las conversaciones. El negocio necesita escalar a
varias marcas/números (Vitasei CO/US/MX) donde cada uno responde con su propia IA y catálogo, y
—dato clave del negocio— **algunas líneas viven en otra cuenta de Callbell** (otra API key),
mientras la cuenta de OpenAI es la misma para todos.

Disyuntivas:
1. ¿Evolucionar `agent_config` o crear una tabla nueva? `agent_config` no tiene enrutamiento
   (número/canal) ni credenciales, y su `is_active` único choca con "muchos agentes a la vez".
2. ¿Llaves por agente o globales? OpenAI puede ser global; Callbell **no** (cuentas distintas).
3. ¿Cómo migrar sin downtime, si la migración SQL no puede leer las env de Vercel?
4. ¿Dónde viven los secretos (Callbell API key por agente)?

## Decisión

- **Tabla `agents`** (nueva) con enrutamiento (`whatsapp_number`, `callbell_channel_uuid`),
  credenciales (`callbell_api_key`, `logistics_team_uuid`), catálogo (`vector_store_id`) y config
  de IA (`system_prompt`, `model`, `temperature`, `enabled`). `agent_config` queda legacy.
- **Enrutamiento por la DB:** el webhook resuelve el agente por `channel_uuid`/número
  (`matchAgent`, puro + testeado). Sin agente → `inbox_rejected`.
- **`conversations.agent_id` y `products.agent_id`:** cada conversación y producto pertenece a un
  agente; catálogo por marca (`unique (agent_id, sku)`), gate/imágenes filtrados por `agent_id`.
- **Llaves:** OpenAI **global** (env); **Callbell API key + canal por agente**; `team_uuid` y
  `vector_store_id` por agente. Todos con **fallback a env** (`agentCallbellCreds`, etc.).
- **Sender parametrizado:** `sendText/sendImage/sendTemplate(creds, …)` reciben las credenciales
  del agente; `credsFromEnv()` es el fallback single-agent.
- **Cero downtime:** DB primero, env como fallback. El agente seed arranca con `callbell_*` NULL
  ⇒ usa las env actuales hasta que se peguen los IDs en el dashboard.
- **Secreto en DB:** `callbell_api_key` en Postgres, solo server-side (service-role tras Basic
  Auth); RLS de `agents` sin lectura `authenticated`; enmascarado en el dashboard (write-only).
- **Dashboard:** sección **Agentes** (lista + detalle editable + crear), reusando los patrones de
  Órdenes/Reactivaciones (Server Actions, `revalidatePath`).

## Consecuencias

- Agregar una marca = crear una fila `agents` con sus IDs (minutos, sin deploy).
- Un secreto (Callbell key) vive en la DB. Mitigado (server-only, RLS, enmascarado); futuro:
  cifrado/KMS.
- La migración siembra el agente actual (CO) desde `agent_config` pero no puede leer las env
  (número/canal/team) → quedan NULL y se resuelven por fallback a env hasta pegarlos en el
  dashboard. Aceptado por el diseño DB-first/env-fallback.
- `products.sku` deja de ser único global (ahora único por agente). Backfill al agente seed.
- Retargets/reactivaciones/envío manual cargan el agente de la conversación (una query extra).

## Alternativas consideradas

- **Reusar `agent_config` con una columna de enrutamiento:** no cabe el modelo (credenciales,
  varios activos); habría que romper `is_active`. Descartada.
- **Llaves de Callbell globales:** imposible, otras líneas están en otra cuenta. Descartada.
- **Secretos por agente en un vault externo (KMS):** correcto a futuro, sobredimensionado para
  v1; se deja como evolución. Por ahora, secreto en DB server-only.
- **Enrutar por env (varios números en env):** no escala ni se edita sin deploy. Descartada.
