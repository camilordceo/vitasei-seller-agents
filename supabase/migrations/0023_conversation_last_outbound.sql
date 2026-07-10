-- ============================================================================
-- conversations.last_outbound_at — momento de la ÚLTIMA respuesta (outbound)
-- 0023_conversation_last_outbound.sql
-- Ver: docs/decisions/0045-orden-conversaciones-por-actividad.md
-- ============================================================================
--
-- La lista del dashboard puede ordenarse por "último del cliente"
-- (`last_inbound_at`, que la ingesta ya fija en cada inbound) o por "última
-- respuesta". Para esto último necesitamos un timestamp del último mensaje
-- SALIENTE por conversación. En vez de tocar los ~8 puntos del código que
-- insertan outbound (respuesta, imágenes, retarget, reactivación, video,
-- hotmart, envío manual), lo mantiene UN trigger sobre `messages` — el mismo
-- patrón de `set_updated_at`. Así ningún camino de envío se queda sin marcar.

-- 1) Columna.
alter table conversations add column if not exists last_outbound_at timestamptz;

comment on column conversations.last_outbound_at is
  'Momento del último mensaje SALIENTE (bot/agente). Lo mantiene el trigger '
  'trg_messages_bump_last_outbound sobre messages. Usado para ordenar la lista '
  'del dashboard por "última respuesta".';

-- 2) Backfill desde el historial de mensajes (para que el orden sea correcto
--    también con los datos existentes).
update conversations c
set last_outbound_at = m.max_out
from (
  select conversation_id, max(created_at) as max_out
  from messages
  where direction = 'outbound'
  group by conversation_id
) m
where m.conversation_id = c.id
  and (c.last_outbound_at is null or c.last_outbound_at < m.max_out);

-- 3) Índice para el orden desc.
create index if not exists idx_conversations_last_outbound_at
  on conversations(last_outbound_at desc);

-- 4) Trigger: al insertar un mensaje SALIENTE, sube last_outbound_at de la
--    conversación (nunca lo baja). Cubre TODOS los caminos de envío sin tocar
--    cada insert del código. El `when (new.direction = 'outbound')` evita
--    overhead en los inbound.
create or replace function bump_conversation_last_outbound()
returns trigger language plpgsql as $$
begin
  update conversations
    set last_outbound_at = new.created_at
    where id = new.conversation_id
      and (last_outbound_at is null or last_outbound_at < new.created_at);
  return new;
end; $$;

drop trigger if exists trg_messages_bump_last_outbound on messages;
create trigger trg_messages_bump_last_outbound
  after insert on messages
  for each row
  when (new.direction = 'outbound')
  execute function bump_conversation_last_outbound();
