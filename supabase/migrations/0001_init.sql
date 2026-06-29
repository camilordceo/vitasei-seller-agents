-- ============================================================================
-- AI Seller Vitasei — Migración inicial
-- Proyecto Supabase: seller-agent-vitasei
-- 0001_init.sql
-- ============================================================================

-- Extensiones
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type conversation_status as enum ('active', 'handed_off', 'closed');
create type message_direction   as enum ('inbound', 'outbound');
create type message_role        as enum ('user', 'assistant', 'system', 'tool');
create type message_type        as enum ('text', 'image', 'audio', 'video', 'document', 'other');
create type fulfillment_method  as enum ('addi', 'cod', 'undecided');
create type order_status        as enum ('pending_handoff', 'handed_off', 'confirmed', 'cancelled');

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------
create table contacts (
  id                      uuid primary key default gen_random_uuid(),
  callbell_contact_uuid   text unique,
  phone                   text not null,           -- E.164 sin '+', ej: 573001234567
  name                    text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index idx_contacts_phone on contacts(phone);
create trigger trg_contacts_updated before update on contacts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table conversations (
  id                            uuid primary key default gen_random_uuid(),
  contact_id                    uuid not null references contacts(id) on delete cascade,
  callbell_conversation_href    text,
  status                        conversation_status not null default 'active',
  fulfillment_method            fulfillment_method  not null default 'undecided',
  openai_previous_response_id   text,                -- encadenar Responses API
  assigned_team_uuid            text,                -- equipo Callbell tras handoff
  last_inbound_at               timestamptz,         -- para ventana 24h
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index idx_conversations_contact on conversations(contact_id);
create index idx_conversations_status   on conversations(status);
create trigger trg_conversations_updated before update on conversations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table messages (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null references conversations(id) on delete cascade,
  direction              message_direction not null,
  role                   message_role not null,
  type                   message_type not null default 'text',
  content                text,                       -- texto (ya limpio de tags si es outbound)
  media_url              text,                       -- para imágenes/archivos
  tags                   jsonb not null default '[]'::jsonb,  -- ['#ID:VITA-001','#addi']
  callbell_message_uuid  text unique,                -- idempotencia
  openai_response_id     text,
  created_at             timestamptz not null default now()
);
create index idx_messages_conversation on messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- products  (gate anti-alucinación + fuente de imagen/precio)
-- El SKU es la join key con el catálogo del vector store.
-- ---------------------------------------------------------------------------
create table products (
  id                     uuid primary key default gen_random_uuid(),
  sku                    text unique not null,       -- el "#ID" (ej: VITA-001)
  name                   text not null,
  description            text,
  price                  numeric(12,2),
  currency               text not null default 'COP',
  image_url              text,                       -- Supabase Storage público
  in_stock               boolean not null default true,
  vector_store_file_id   text,                       -- archivo OpenAI asociado
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_products_sku on products(sku);
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- orders + order_items
-- ---------------------------------------------------------------------------
create table orders (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversations(id) on delete cascade,
  contact_id          uuid not null references contacts(id) on delete cascade,
  status              order_status not null default 'pending_handoff',
  fulfillment_method  fulfillment_method not null,
  shipping_name       text,
  shipping_address    text,
  shipping_city       text,
  shipping_phone      text,
  notes               text,
  total               numeric(12,2),
  currency            text not null default 'COP',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_orders_conversation on orders(conversation_id);
create index idx_orders_status on orders(status);
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();

create table order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  product_id  uuid references products(id),
  sku         text not null,
  name        text,
  qty         integer not null default 1 check (qty > 0),
  unit_price  numeric(12,2),
  created_at  timestamptz not null default now()
);
create index idx_order_items_order on order_items(order_id);

-- ---------------------------------------------------------------------------
-- agent_config  (prompts versionados en DB, como EMA/Catalina)
-- ---------------------------------------------------------------------------
create table agent_config (
  id              uuid primary key default gen_random_uuid(),
  name            text not null default 'vitasei-seller',
  system_prompt   text not null,
  model           text not null default 'gpt-5.1',
  vector_store_id text,
  temperature     numeric(3,2) not null default 0.3,
  version         integer not null default 1,
  is_active       boolean not null default false,
  created_at      timestamptz not null default now()
);
create unique index idx_agent_config_active on agent_config(name) where is_active;

-- ---------------------------------------------------------------------------
-- events_log  (el "log" del loop)
-- ---------------------------------------------------------------------------
create table events_log (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references conversations(id) on delete cascade,
  type             text not null,        -- 'webhook_received','reason','gate_blocked','image_sent','handoff', ...
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index idx_events_conversation on events_log(conversation_id, created_at);
create index idx_events_type on events_log(type);

-- ---------------------------------------------------------------------------
-- catalog_imports  (trazabilidad de cargas de catálogo)
-- ---------------------------------------------------------------------------
create table catalog_imports (
  id                   uuid primary key default gen_random_uuid(),
  filename             text,
  status               text not null default 'processing',  -- processing|completed|failed
  vector_store_file_id text,
  rows_imported        integer default 0,
  error                text,
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS  (activar en todas; el backend usa service_role que las omite)
-- El dashboard accede con usuarios autenticados.
-- ---------------------------------------------------------------------------
alter table contacts        enable row level security;
alter table conversations   enable row level security;
alter table messages        enable row level security;
alter table products        enable row level security;
alter table orders          enable row level security;
alter table order_items     enable row level security;
alter table agent_config    enable row level security;
alter table events_log      enable row level security;
alter table catalog_imports enable row level security;

-- Policy base: usuarios autenticados pueden leer (dashboard).
-- Ajustar a org/roles cuando se defina el modelo de auth de Vitasei.
do $$
declare t text;
begin
  foreach t in array array[
    'contacts','conversations','messages','products','orders',
    'order_items','agent_config','events_log','catalog_imports'
  ]
  loop
    execute format(
      'create policy "auth read %1$s" on %1$s for select to authenticated using (true);', t
    );
  end loop;
end $$;

-- Escrituras del dashboard (ej. editar productos, cerrar conversación):
create policy "auth write products"      on products      for all to authenticated using (true) with check (true);
create policy "auth write conversations" on conversations for update to authenticated using (true) with check (true);
create policy "auth write orders"        on orders        for update to authenticated using (true) with check (true);

-- NOTA: las escrituras del agente (insert messages, crear orders, etc.) las hace
-- el backend con SUPABASE_SERVICE_ROLE_KEY, que bypassa RLS por diseño.
