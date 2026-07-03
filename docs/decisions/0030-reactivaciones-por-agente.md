# ADR-0030: Reactivaciones (plantillas 7/15 días) por agente

- **Estado:** Aceptada
- **Fecha:** 2026-07-03
- **Sprint:** 6 (continuación — dashboard multi-marca)

## Contexto
Las reactivaciones (plantillas de WhatsApp a 7 y 15 días para reenganchar a quien no compró) tenían
su config —ON/OFF + los dos UUID de plantilla— **global**, en la fila única `app_settings` (id=1).
Pero el envío ya usa las credenciales de Callbell **por agente** (`agentCallbellCreds`). Como un UUID
de plantilla solo existe en la cuenta de Callbell donde se creó, con varias marcas/líneas el sistema
mandaría el UUID de la marca A con la API key de la marca B → Callbell lo rechaza o envía la plantilla
equivocada. La config debe vivir donde viven las credenciales: en el agente.

## Decisión
- **Mover la config a `agents`** (migración 0011): columnas `reactivation_enabled`,
  `reactivation_template_7d`, `reactivation_template_15d`. Backfill del singleton `app_settings` hacia
  todos los agentes; `app_settings` queda **sin uso** (no se dropea en esta migración).
- **Runtime** (`lib/agent/reactivation.ts` + `agents.ts`):
  - Helper `agentReactivationSettings(agent)` + `loadAgentReactivationSettings(supabase, agentId)`.
  - `scheduleReactivations` recibe `agentId` (disponible en la ingesta) y agenda solo si ESE agente
    tiene el feature ON.
  - `runDueReactivations` deja de leer un flag global; `processReactivationRow` resuelve el agente de
    la conversación y toma de ahí ON/OFF, plantillas y credenciales. Si el agente tiene reactivaciones
    OFF o le falta la plantilla de la etapa, `evaluateReactivation` cae en `skip {no-template}`.
  - (Compuesto con ADR-0029) fuera de horario la fila se **aplaza** (`deferred`).
- **UI** (`app/dashboard/retargets`): un solo recuadro con **selector de agente** (decisión del
  usuario). `getAgentsReactivationConfig()` alimenta el `<select>`; `updateReactivationSettings`
  recibe `agentId` y actualiza esas 3 columnas en la fila `agents`. Las columnas de reactivación
  **no** se editan desde el `AgentEditor` (para no tener dos lugares que las escriban); `agentPatch`
  no las toca.

## Consecuencias
- **Bueno:** arregla el desajuste plantilla↔cuenta (cada línea manda su plantilla con su API key);
  co-ubica la config con las credenciales; el snapshot `reactivations.template_uuid` al enviar sigue
  dejando el histórico correcto; escala a N marcas.
- **Malo / atado a futuro:**
  - **`app_settings` queda huérfana** (sin columnas útiles). Se puede dropear en una migración futura.
  - **Apagar reactivaciones de un agente** con filas ya agendadas ⇒ esas filas terminan en
    `skip {no-template}` (no se reanudan si se vuelve a encender). El caso es raro (cadencia 7/15d) y
    se acepta por simplicidad; agendar de nuevo requiere un nuevo primer contacto.
  - Dos rutas de escritura a la fila `agents` (editor para horario/IA, página de Retargets para
    reactivación) sobre columnas distintas — sin conflicto, pero hay que recordarlo.

## Alternativas consideradas
- **(a) Overrides por agente sobre un default global:** más flexible, pero `app_settings` no tenía
  otras columnas y el default global no aporta (las plantillas son intrínsecamente por cuenta).
  Se prefiere per-agente puro.
- **(b) Config de reactivación dentro del `AgentEditor`:** natural (junto a las credenciales), pero el
  usuario pidió explícitamente un **selector en la página de Retargets**. Se implementó así.
- **(c) Tabla hija `agent_settings`:** innecesaria para 3 columnas; van directo en `agents`.
