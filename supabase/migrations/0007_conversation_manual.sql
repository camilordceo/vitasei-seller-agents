-- ---------------------------------------------------------------------------
-- 0007 — Modo manual (pausar la IA en una conversación)
--
-- Un agente humano puede tomar una conversación: la IA deja de responder pero
-- los mensajes del cliente siguen ingresando y viéndose en el dashboard. Ver
-- docs/11-modo-manual.md y ADR-0018.
--
-- `ai_paused` es ORTOGONAL a `status`: una conversación puede estar `active` y
-- `ai_paused = true` (humano al mando, IA en silencio). La ingesta no depende de
-- este flag, así que los inbound se siguen guardando; solo la generación de la
-- respuesta lo respeta.
-- ---------------------------------------------------------------------------
alter table conversations
  add column if not exists ai_paused boolean not null default false;
