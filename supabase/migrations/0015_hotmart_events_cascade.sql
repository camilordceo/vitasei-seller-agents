-- ============================================================================
-- hotmart_events: alinear FKs con el resto del esquema (ON DELETE CASCADE)
-- 0015_hotmart_events_cascade.sql
-- ============================================================================
--
-- La migración 0013 creó `hotmart_events` con FKs a `contacts` y `conversations`
-- SIN `on delete cascade` (default NO ACTION/RESTRICT). Todo el resto del esquema
-- (conversations, messages, orders, events_log, retargets, reactivations,
-- call_requests, conversation_labels) sí cascadea. Por esa inconsistencia, borrar
-- un contacto/conversación que tenga un evento de Hotmart asociado fallaba con:
--   ERROR 23503: ... violates foreign key constraint "hotmart_events_contact_id_fkey"
--
-- Se recrean las FKs con la política correcta:
--   - contact_id / conversation_id → ON DELETE CASCADE (consistente con el esquema:
--     al borrar el contacto/conversación se borra también su rastro de Hotmart).
--   - agent_id → ON DELETE SET NULL (borrar un agente no debe bloquear ni perder el
--     evento; el trace queda huérfano de agente pero se conserva).
-- El drop+add va en una sola sentencia por columna (sin ventana sin constraint).

alter table hotmart_events
  drop constraint if exists hotmart_events_contact_id_fkey,
  add constraint hotmart_events_contact_id_fkey
    foreign key (contact_id) references contacts(id) on delete cascade;

alter table hotmart_events
  drop constraint if exists hotmart_events_conversation_id_fkey,
  add constraint hotmart_events_conversation_id_fkey
    foreign key (conversation_id) references conversations(id) on delete cascade;

alter table hotmart_events
  drop constraint if exists hotmart_events_agent_id_fkey,
  add constraint hotmart_events_agent_id_fkey
    foreign key (agent_id) references agents(id) on delete set null;
