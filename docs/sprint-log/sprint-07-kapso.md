# Sprint 07 — Kapso como segundo proveedor de WhatsApp

- **Fecha / sesión:** 2026-07-16
- **Estado:** Completado a nivel de código y verificación local (typecheck + tests + build).
  Pendiente la prueba contra Kapso real (ver §Pendientes).
- **Rama:** `kapso-update`

## Objetivo

Poder operar una línea en **Kapso** sin apagar Callbell: las dos corriendo **a la vez** y
probables en simultáneo, configurables desde el dashboard. La línea con la que arranca Kapso es
**Hotmart** (carritos abandonados), así que ese flujo tenía que funcionar completo.

## Qué se hizo

**Investigación primero.** Se rastreó la doc de Kapso (`llms-full.txt` + los 3 OpenAPI oficiales,
que son la fuente autoritativa). El hallazgo que definió todo el diseño: **Kapso no es un
proveedor tipo Callbell, es un proxy Meta-compatible** — sus envíos son literalmente la forma de
la Cloud API de Meta con auth `X-API-Key`.

**Debate de arquitectura** (planteado al dueño del producto antes de escribir código):

- *Fork paralelo del backend* — riesgo cero para Callbell, pero duplicaba ~1.500 líneas de lógica
  de negocio (gate, cierre de venta, ventana de 24h, Hotmart) que divergirían en semanas.
- *Puerto + adaptadores* — un cerebro, dos transportes; toca archivos compartidos con lo que hoy
  factura. **Elegida**, mitigando el riesgo (ver abajo).

**Construido:**

- **Puerto de mensajería** (`lib/messaging/`): interfaz `MessagingProvider` + adaptadores de
  Callbell y Kapso. `agents.provider` decide cuál; `providerForAgent()` es el único punto donde se
  resuelve. Se migraron los **6 puntos de envío** (`processMessage`, `retarget`, `reactivation`,
  `videos`, `hotmart/processEvent`, envío manual del dashboard).
- **`lib/kapso/`**: sender (forma de Meta) con reintento ante el **409 in-flight**, parser del
  webhook v2 (suelto y en lote), firma HMAC SHA256, plantillas por nombre+idioma, routing por
  `phone_number_id`, credencial de media.
- **Webhook** `/api/webhooks/kapso` → mismo `ingestInboundMessage` + `runDebouncedReply`.
- **Migración 0026**: `agents.provider` + columnas `kapso_*` + `comment on column` documentando el
  reuso de `callbell_message_uuid` / `template_uuid` como campos "del proveedor".
- **Dashboard**: selector de proveedor con campos condicionales, secretos write-only, proveedor
  visible en la lista de agentes y en el selector de Hotmart.
- **Piezas compartidas** movidas a lugar neutral con re-export (`normalizePhone`, `media.ts`), para
  que Kapso no dependa de Callbell y **nada de lo existente cambiara**.

## Criterio de aceptación

- [x] **Los dos proveedores conviven** — `agents.provider` por agente; `matchAgent`/`matchKapsoAgent`
      filtran por proveedor. Tests: `lib/kapso/routing.test.ts` cubre el caso real de la prueba en
      paralelo (mismo número en dos agentes → cada webhook enruta al suyo y **no** al del otro).
- [x] **Webhook que recibe** — `/api/webhooks/kapso` registrado en el build; parser cubierto por 15
      tests (payload literal de la doc, lote, lote de 1, eco outbound, BSUID sin teléfono).
- [x] **Respuestas** — mismo cerebro; el envío sale por el adaptador del agente. 12 tests fijan la
      forma de los payloads de Meta y el 409.
- [x] **Plantillas** — nombre+idioma con override `nombre:idioma`; variables posicionales
      equivalentes a los `template_values` de Callbell. 8 tests.
- [x] **Hotmart funciona en Kapso** — `processHotmartCartAbandonment` solo cambió el `creds` por el
      `provider` del agente; idempotencia, plantilla por curso, `hotmart_flow`, tag
      `hotmart-recovery` y el contexto de la respuesta (ADR-0051) quedaron intactos.
- [x] **Configurable desde el dashboard** — proveedor + credenciales por agente; el selector de
      Hotmart es el interruptor para mover la línea.
- [x] **Sin regresiones en Callbell** — los 251 tests existentes pasan **sin haber modificado
      ninguno**; total 302/302. Typecheck y `next build` limpios.

## Desviaciones del PRD

- **`hotmart_enabled` no necesitó cambios**: se planeó "endurecer para que sea uno solo", pero
  `setHotmartAgent` ya era exclusivo (apaga en todos, prende en uno). Solo se agregó un **aviso**
  en `findHotmartAgentId` para que un empate por edición manual en la base no se resuelva en
  silencio — que es justo el momento peligroso al mover la línea de proveedor.
- **`getAgents` pasó a `select("*")`** en vez de encadenar otro fallback por columna nueva. Con
  columnas llegando por migraciones, `*` es inmune por construcción y son pocos agentes.

## Decisiones nuevas

- **ADR-0056** — Kapso como segundo proveedor: puerto de mensajería y adaptadores (incluye el
  debate fork vs. puerto, el reuso de columnas y el handoff sin equipos).
- **ADR-0057** — Aprovechar la transcripción de audio de Kapso en la ingesta (sin Whisper).
- **ADR-0058** — Mantener nuestro debounce en vez del buffering nativo de Kapso.

## Pendientes / deuda técnica

**Pasos manuales antes de probar** (ver `docs/24` §12):

1. Aplicar la **migración `0026`** en Supabase.
2. Crear el agente con proveedor Kapso + **Phone Number ID** + API key + secreto.
3. **Registrar el webhook** del número en Kapso (`buffer_enabled: false`) apuntando al dominio.
4. Crear/aprobar en Meta la **plantilla de Hotmart** y poner su **nombre** en `/dashboard/hotmart`
   (la de Callbell no sirve: es de otra cuenta).

**A verificar contra tráfico real** (la doc de Kapso es ambigua; el código tolera ambos casos):

- Firma: ¿cuerpo crudo o `JSON.stringify`? Hoy se aceptan los dos.
- Auth de `media_url`: hoy se intenta sin credencial y se reintenta con ella ante 401/403.
- Rate limits de la API de envío: no documentados. Vigilar 429 en ráfagas.

**Deuda:**

- Los nombres `callbell_*` de las columnas ya no describen su contenido (documentado en la base,
  no renombrado). Limpieza futura.
- El "Costo IA" del reporte mostrará **0 en audio** para las líneas de Kapso (su transcripción es
  gratis para nosotros). Es correcto, pero conviene saberlo al leer el cuadro.
- **Ningún workflow con trigger de WhatsApp** debe existir en los números de Kapso: interceptan
  los mensajes antes de que lleguen al webhook.
- Vigilar la **auto-pausa del webhook** de Kapso (≥85% de fallos en 15 min lo desactiva y
  reactivarlo es manual desde su dashboard).

## Archivos principales

- `lib/messaging/` — `types.ts` (puerto), `callbell.ts`, `kapso.ts`, `media.ts`, `mediaFetch.ts`, `phone.ts`
- `lib/kapso/` — `sender.ts`, `types.ts`, `signature.ts`, `templates.ts`, `routing.ts`, `mediaFetch.ts` (+ 5 suites de tests)
- `app/api/webhooks/kapso/route.ts`
- `lib/agent/agents.ts` — `provider`, `providerForAgent`, `selectAgents` (fallback 42703), `resolveKapsoAgentForInbound`
- `lib/agent/processMessage.ts`, `retarget.ts`, `reactivation.ts`, `videos.ts`, `lib/hotmart/processEvent.ts`, `app/dashboard/actions.ts` — los 6 puntos de envío
- `supabase/migrations/0026_agent_provider_kapso.sql`
- `app/dashboard/agents/AgentEditor.tsx`, `app/dashboard/hotmart/*`
- `docs/24-integracion-kapso.md`, `docs/decisions/0056|0057|0058-*.md`
