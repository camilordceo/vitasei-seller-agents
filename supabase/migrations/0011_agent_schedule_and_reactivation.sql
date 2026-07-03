-- ============================================================================
-- 0011 — Horario por agente + reactivaciones por agente
--
-- (1) HORARIO: cada agente puede programar cuándo está "activo" (respondiendo).
--     `schedule_enabled=false` ⇒ siempre activo (retrocompatible). El horario se
--     evalúa inline en el flujo (no hay cron que prenda/apague); `enabled` sigue
--     siendo el master manual. Modelo (jsonb `schedule`): ventana diaria +
--     días completos + festivos (unión). Ver ADR-0029.
--
-- (2) REACTIVACIONES por agente: las plantillas 7/15d y el ON/OFF dejan de ser
--     globales (`app_settings`) y viven en cada agente, junto a sus credenciales
--     de Callbell (la plantilla solo existe en ESA cuenta). Se hace backfill del
--     singleton `app_settings` a todos los agentes. `app_settings` queda sin uso
--     (no se dropea aquí). Ver ADR-0030.
--
-- Idempotente: seguro de correr más de una vez.
-- ============================================================================

alter table agents
  add column if not exists schedule_enabled          boolean not null default false,
  add column if not exists schedule_timezone         text    not null default 'America/Bogota',
  add column if not exists schedule                   jsonb   not null default '{}'::jsonb,
  add column if not exists reactivation_enabled       boolean not null default false,
  add column if not exists reactivation_template_7d   text,
  add column if not exists reactivation_template_15d  text;

-- Backfill de reactivación: copia la config global (fila única id=1) a cada agente.
update agents a
set
  reactivation_enabled      = coalesce(s.reactivation_enabled, false),
  reactivation_template_7d  = s.reactivation_template_7d,
  reactivation_template_15d = s.reactivation_template_15d
from app_settings s
where s.id = 1;
