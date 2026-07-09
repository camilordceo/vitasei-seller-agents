-- ============================================================================
-- Marca de "agente de Hotmart" (designado desde el dashboard)
-- 0020_agent_hotmart_flag.sql
-- Ver: docs/17-hotmart-carritos.md, ADR-0041
-- ============================================================================
--
-- Hasta ahora el agente que manejaba los eventos de Hotmart se resolvía por la env
-- `HOTMART_AGENT_ID` o "el primer agente activo". Esto agrega una marca POR AGENTE
-- editable desde el dashboard, para poder designar cómodamente qué agente (con su
-- teléfono y su cuenta de Callbell) maneja Hotmart, sin tocar env ni redeploy.
--
-- Es un flag exclusivo: el dashboard prende `hotmart_enabled` en el agente elegido
-- y lo apaga en los demás. El webhook prioriza este agente; si no hay ninguno
-- marcado, cae al fallback (env `HOTMART_AGENT_ID` → primer agente activo).

alter table agents
  add column if not exists hotmart_enabled boolean not null default false;

-- Índice parcial: normalmente hay un solo agente marcado.
create index if not exists idx_agents_hotmart_enabled
  on agents (hotmart_enabled) where hotmart_enabled;

comment on column agents.hotmart_enabled is
  'true = este agente maneja los eventos de Hotmart (carritos abandonados); se designa desde /dashboard/hotmart';
