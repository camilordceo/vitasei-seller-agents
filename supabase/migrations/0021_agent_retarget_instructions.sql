-- ============================================================================
-- Instrucciones de retarget (seguimientos 1h/8h) editables por agente
-- 0021_agent_retarget_instructions.sql
-- Ver: docs/10-retargeting.md, ADR-0043
-- ============================================================================
--
-- El mensaje de seguimiento (1h y 8h) lo genera el modelo a partir de un
-- "turno-guía" que hasta ahora era fijo (buildRetargetInstruction). Esto lo hace
-- editable POR AGENTE para calibrar el tono/estrategia (más agresivo, más
-- informativo, etc.) desde el dashboard. Solo es la GUÍA: el encabezado interno y
-- las reglas de seguridad (no revelar que es automático, no inventar, sin tags de
-- flujo) se envuelven siempre en el backend y no dependen de este texto.
--
-- NULL = usar la guía por defecto. Se leen en una consulta aparte y resiliente (no
-- se agregan a AGENT_COLS) para no arriesgar la ruta crítica de inbound.

alter table agents
  add column if not exists retarget_instruction_1 text,
  add column if not exists retarget_instruction_2 text;

comment on column agents.retarget_instruction_1 is
  'Guía del seguimiento de ~1h (turno-guía editable; NULL = guía por defecto). Ver ADR-0043';
comment on column agents.retarget_instruction_2 is
  'Guía del seguimiento de ~8h (turno-guía editable; NULL = guía por defecto). Ver ADR-0043';
