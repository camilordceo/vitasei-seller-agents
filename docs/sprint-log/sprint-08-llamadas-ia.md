# Sprint 08 — Llamadas con IA (Synthflow)

- **Fecha / sesión:** 2026-07-18
- **Estado:** Completado (código + verificación); **pendiente el aprovisionamiento** para prender.

## Objetivo
Darle **voz** al agente: llamadas telefónicas hechas por IA (Synthflow), agendadas desde el flujo
de WhatsApp o disparadas a mano, con el resultado —transcript, grabación, datos extraídos y
minutos— de vuelta en la conversación. Prendible/apagable y flexible por agente.

## Qué se hizo

**Investigación primero (y valió la pena).** Antes de escribir código se verificó el contrato
contra la **cuenta real**: 82 assistants, 43 actions y **977 objetos `executed_actions` de
llamadas de producción**. Aparecieron tres errores en la doc de Synthflow que habrían roto la
integración en producción, no en desarrollo:
1. `return_value` **no es un objeto**, es un **string con JSON adentro**.
2. Conviven **dos prefijos** de clave: `extract_info_` (histórico) e `info_extractor_` (el que
   genera hoy la API — confirmado creando y borrando un extractor real).
3. `GET /v2/calls/{call_id}` devuelve un **array paginado**, no el objeto suelto.
Más: el identifier **puede traer espacios**, el valor puede ser escalar/objeto/anidado en dos
niveles, y `api.us`/`api.eu` devuelven **401 con una key válida** (la región importa).

**Hallazgo que cambió el diseño.** Los dos assistants que nos dieron son de **Rentmies**
(inmobiliaria), son `type: inbound` y su `external_webhook_url` ya apunta a Bubble. El workspace
está **compartido con otro producto en producción** → la integración se hizo **aditiva**: no se
muta ningún assistant y no se depende del webhook.

- **Backend**: `lib/synthflow/` (cliente, tipos + normalizador, extractores, firma, pricing) y
  `lib/agent/voiceCall.ts` (agendar, cron con claim atómico, colocar, cerrar, reconciliar) +
  `lib/agent/voiceCallPlan.ts` (puro: cadencia, guardas, textos).
- **Migración `0027`**: 12 columnas de voz en `agents` + tabla `voice_calls` (estado en
  texto+CHECK, índice parcial anti-duplicado, RLS).
- **Rutas**: `/api/cron/voice-calls` (colocar + reconciliar) y `/api/webhooks/synthflow`.
- **Dashboard**: sección **Llamadas** unificada (IA + solicitudes) con búsqueda por teléfono,
  detalle con transcript/audio y cancelación masiva; editor de voz por agente (cadencia, voces
  con preview, extractores); botón *Llamar ahora* y tarjeta en la conversación; nota interna en
  el hilo; filtro "Llamada IA" en Conversaciones; costo en Reportes.
- **Enganche con WhatsApp**: se agenda al **primer inbound** y se cancela al convertir.

## Criterio de aceptación
- [x] Cadencia configurable por agente y por país — `parseVoiceConfig` + `voice_countries`,
      con presets para los dos ejemplos del negocio. Cubierto por tests.
- [x] Extractores ajustables desde el dashboard y sincronizados con Synthflow — `saveVoiceConfig`
      → `createExtractor`/`updateExtractor`/`attachActions`. Contrato de creación **probado
      contra la API real** (se creó y se borró un extractor).
- [x] Los datos extraídos llegan bien con varios agentes en simultáneo — el webhook resuelve el
      agente por `synthflow_call_id` en **nuestra** tabla, no por el payload.
- [x] Disparo manual desde la conversación — `triggerVoiceCall`, respetando país y horario.
- [x] Programadas y realizadas visibles y filtrables; cancelación por multi-selección.
- [x] Resultado como **nota** en la conversación + minutos y costo logueados.
- [x] Conversaciones filtrable por "tuvo llamada con IA".
- [x] typecheck + lint + build + **411/411 tests**.
- [x] **Verificación contra la API real**: el cliente y el normalizador corrieron contra la
      cuenta (200 voces, 79 en español, 34 con preview; una llamada de producción normalizada
      con transcript de 1.326 caracteres, grabación, `answered=true` y datos extraídos anidados).
- [ ] **Una llamada real de punta a punta** — NO se hizo: cuesta plata y suena en un teléfono
      real. Es el último paso manual (ver Pendientes).

## Desviaciones del PRD
- **La knowledge base quedó fuera** (fase 2, como se acordó): se carga desde Synthflow.
- **El cron quedó en `*/5`** en vez de por minuto: "apenas llega" es *dentro de los 5 minutos*.
  Para ventas alcanza —y le da tiempo al bot de WhatsApp a responder primero—. Se documenta cómo
  bajarlo si hiciera falta.
- **La voz no se sincroniza automáticamente al guardar**: es un botón aparte, porque es la única
  escritura remota sobre un assistant de un workspace compartido.

## Decisiones nuevas
- [ADR-0060](../decisions/0060-synthflow-assistant-referenciado-y-override-por-llamada.md) —
  assistant referenciado, prompt y contexto por llamada.
- [ADR-0061](../decisions/0061-webhook-como-aviso-api-como-fuente-de-verdad.md) —
  el webhook es un aviso; la API es la fuente de verdad.
- [ADR-0062](../decisions/0062-extractores-configurables-por-agente.md) —
  extractores por agente y normalización defensiva de `executed_actions`.
- [ADR-0063](../decisions/0063-cadencia-de-llamadas-por-agente.md) —
  cadencia clonada de retargets, sin ventana de 24h.

## Pendientes / deuda técnica
**Para prender (manual, en orden):**
1. Aplicar la migración `0027` en Supabase.
2. Envs en Vercel: `SYNTHFLOW_API_KEY`, `SYNTHFLOW_WORKSPACE_ID`, `SYNTHFLOW_WEBHOOK_SECRET`,
   `SYNTHFLOW_USD_PER_MINUTE` y `VOICE_CALLS_ENABLED=true`.
3. Crear en Synthflow un assistant **`outbound` dedicado** a este agente (los dos actuales son
   `inbound` y son de Rentmies: **no reutilizarlos**) y pegar su `model_id` en el dashboard.
4. Apuntar el `external_webhook_url` de **ese** assistant a `/api/webhooks/synthflow` (opcional:
   sin él, el cron reconcilia igual, solo con más latencia).
5. Configurar cadencia, prompt de voz, voz y extractores; prender `voice_enabled`.
6. **Hacer una llamada de prueba a un número propio** y confirmar la nota en la conversación.

**Deuda / a revisar:**
- La tarifa por minuto es una estimación (`0.20`): ajustarla con la factura real de Synthflow.
- Knowledge base (fase 2) y llamadas **entrantes** (`inbound_call_webhook_url`) sin implementar.
- `voice_calls` duplica mecánica con `retargets`; se aceptó a conciencia (ADR-0063).
- No se probó `PUT /v2/assistants` contra un assistant real (solo lectura): la sincronización de
  voz usa read-modify-write, pero conviene estrenarla sobre un assistant de prueba.

## Archivos principales
- `supabase/migrations/0027_voice_calls.sql`
- `lib/synthflow/{client,types,extractors,signature,pricing}.ts` (+ tests)
- `lib/agent/{voiceCall,voiceCallPlan}.ts` (+ tests)
- `app/api/cron/voice-calls/route.ts` · `app/api/webhooks/synthflow/route.ts`
- `app/dashboard/calls/{page,VoiceCallsPanel,PhoneSearch}.tsx`
- `app/dashboard/agents/VoiceSettings.tsx`
- `app/dashboard/conversations/[id]/VoiceCallsCard.tsx` · `ChatPanel.tsx`
- `docs/25-llamadas-con-ia-synthflow.md` · `docs/decisions/0060..0063`
