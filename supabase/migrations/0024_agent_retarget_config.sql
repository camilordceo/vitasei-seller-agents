-- ============================================================================
-- Retargets dinámicos por agente — 0024_agent_retarget_config.sql
-- Ver: docs/10-retargeting.md, ADR-0052 (reemplaza el modelo de ADR-0043)
-- ============================================================================
--
-- Antes: 2 seguimientos fijos (1h/8h), con delay GLOBAL por env y solo la GUÍA
-- editable por agente (columnas retarget_instruction_1/2, ADR-0043).
--
-- Ahora: cada agente define CUÁNTOS seguimientos quiere y A QUÉ HORA. La config
-- vive en un jsonb `retarget_config` = array ordenable de etapas:
--   [{ "delayMinutes": 60, "guidance": "..." }, { "delayMinutes": 1380, ... }]
--   · delayMinutes: minutos tras la respuesta del bot en que se dispara la etapa.
--   · guidance:     tono/estrategia editable (null = guía por defecto).
-- Vacío / null = backstop genérico por env (RETARGET_STAGE1/2/3_MS = 1h/8h/23h).
--
-- NOTA ventana 24h: WhatsApp solo entrega mensajes libres dentro de las 24h del
-- último inbound del cliente. Una etapa a ~24h+ cae fuera y se OMITE (out-of-window);
-- para recuperar más tarde está la feature de Reactivaciones (plantillas 7/15d).
--
-- Se lee en consulta aparte (NO en AGENT_COLS) y resiliente a 42703, para NO
-- arriesgar la ruta crítica de inbound si la migración no está aplicada.

-- 1) Config por agente ------------------------------------------------------
alter table agents
  add column if not exists retarget_config jsonb;

comment on column agents.retarget_config is
  'Seguimientos (retargets) por agente: jsonb array [{delayMinutes,guidance}]. NULL/vacío = backstop por env. Ver ADR-0052';

-- Backfill: preserva la guía existente (ADR-0043) mapeada a las etapas 1h/8h.
-- Solo si el agente tenía alguna guía configurada; si no, queda NULL (→ backstop).
update agents
set retarget_config = jsonb_build_array(
      jsonb_build_object('delayMinutes', 60,  'guidance', retarget_instruction_1),
      jsonb_build_object('delayMinutes', 480, 'guidance', retarget_instruction_2)
    )
where retarget_config is null
  and (retarget_instruction_1 is not null or retarget_instruction_2 is not null);

-- 2) Guardar el delay real en cada fila de retarget -------------------------
-- Así el "hace cuánto" del mensaje y la etiqueta del dashboard son exactos y no
-- dependen del ordinal ni de que la config del agente cambie después de agendar.
alter table retargets
  add column if not exists delay_minutes integer;

comment on column retargets.delay_minutes is
  'Minutos tras la respuesta del bot en que se agendó esta etapa (para el texto "hace cuánto" y la UI). Ver ADR-0052';

-- 3) Permitir N etapas (antes solo 1 y 2) -----------------------------------
alter table retargets drop constraint if exists retargets_stage_check;
alter table retargets add constraint retargets_stage_check check (stage >= 1);
