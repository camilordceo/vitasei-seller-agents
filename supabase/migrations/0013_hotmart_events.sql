-- ============================================================================
-- Carritos Abandonados de Hotmart
-- 0013_hotmart_events.sql
-- Ver: docs/17-hotmart-carritos.md, ADR-0035
-- ============================================================================

-- ---------------------------------------------------------------------------
-- hotmart_events: trazabilidad de eventos de Hotmart (carritos abandonados)
-- ---------------------------------------------------------------------------
create table hotmart_events (
  id                  uuid primary key default gen_random_uuid(),
  -- ID único del evento de Hotmart (idempotencia)
  hotmart_event_id    text unique not null,
  -- Tipo de evento (PURCHASE_OUT_OF_SHOPPING_CART, etc.)
  event_type          text not null,
  -- Datos del comprador
  phone               text not null,         -- E.164 sin '+'
  email               text,
  buyer_name          text,
  -- Datos del producto/oferta
  product_id          text,
  product_name        text,
  offer_code          text,
  -- Relaciones
  contact_id          uuid references contacts(id),
  conversation_id     uuid references conversations(id),
  agent_id            uuid references agents(id),
  -- Estado del envío
  message_sent        boolean not null default false,
  message_uuid        text,                  -- callbell_message_uuid si se envió
  send_error          text,                  -- error si falló el envío
  -- Payload crudo para debugging
  raw_payload         jsonb not null,
  created_at          timestamptz not null default now()
);

-- Índices para queries frecuentes
create index idx_hotmart_events_phone on hotmart_events(phone);
create index idx_hotmart_events_created on hotmart_events(created_at);
create index idx_hotmart_events_conversation on hotmart_events(conversation_id);
create index idx_hotmart_events_event_type on hotmart_events(event_type);

-- RLS: el backend usa service_role, el dashboard puede leer
alter table hotmart_events enable row level security;
create policy "auth read hotmart_events" on hotmart_events
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Agregar columna source a conversations para distinguir origen
-- ---------------------------------------------------------------------------
-- Usamos un check constraint en vez de enum para no romper datos existentes
alter table conversations
  add column if not exists source text not null default 'whatsapp'
  check (source in ('whatsapp', 'hotmart', 'manual', 'other'));

-- Índice para filtrar por origen
create index if not exists idx_conversations_source on conversations(source);

-- ---------------------------------------------------------------------------
-- Comentarios
-- ---------------------------------------------------------------------------
comment on table hotmart_events is 'Eventos de carrito abandonado de Hotmart (trazabilidad + idempotencia)';
comment on column hotmart_events.hotmart_event_id is 'ID único del payload de Hotmart — evita duplicados';
comment on column hotmart_events.message_sent is 'true si la plantilla de WhatsApp se envió exitosamente';
comment on column conversations.source is 'Origen de la conversación: whatsapp (inbound), hotmart (carrito abandonado), manual, other';
