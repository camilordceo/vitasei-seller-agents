-- ============================================================================
-- 0010 — Multi-agente / multi-marca (enrutamiento dinámico por número)
--
-- Convierte la plataforma de "un solo agente" a "muchos agentes". Cada fila de
-- `agents` es una marca/número con SU propia config de IA (prompt, modelo,
-- vector store), SU canal de Callbell + API key (otras líneas viven en otra
-- cuenta de Callbell) y SU equipo de logística. El webhook enruta cada inbound
-- al agente por `callbell_channel_uuid`/`whatsapp_number`.
--
-- La API key de OpenAI sigue siendo global (env); la de Callbell es por agente.
-- Ver docs/16 y ADR-0023. Idempotente: seguro de correr más de una vez.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- agents
-- ---------------------------------------------------------------------------
create table if not exists agents (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,                 -- ej. "Vitasei CO"
  brand                  text,                           -- ej. "Vitasei"
  country                text,                           -- ej. "CO" | "US" | "MX"
  whatsapp_number        text,                           -- E.164 sin '+' (routing/display)
  callbell_channel_uuid  text,                           -- canal Callbell (routing + envío)
  callbell_api_key       text,                           -- SECRETO (otra cuenta). null => env.CALLBELL_API_KEY
  logistics_team_uuid    text,                           -- equipo de handoff (null => env)
  vector_store_id        text,                           -- catálogo OpenAI (null => env)
  model                  text not null default 'gpt-5.1',
  system_prompt          text not null,
  temperature            numeric(3,2) not null default 0.3,
  enabled                boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_agents_channel on agents(callbell_channel_uuid);
create index if not exists idx_agents_number  on agents(whatsapp_number);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_agents_updated'
  ) then
    create trigger trg_agents_updated before update on agents
      for each row execute function set_updated_at();
  end if;
end $$;

-- RLS: habilitada SIN policy de lectura para `authenticated` (a diferencia de
-- las demás tablas). El `callbell_api_key` es secreto; el dashboard accede vía
-- service-role (que bypassa RLS), nunca con el cliente anónimo/autenticado.
alter table agents enable row level security;

-- ---------------------------------------------------------------------------
-- Seed: el agente actual (Vitasei CO) desde la agent_config activa.
-- Solo si aún no hay agentes (idempotente). Los IDs de enrutamiento
-- (callbell_channel_uuid, callbell_api_key, logistics_team_uuid) quedan NULL:
-- el runtime cae a las env de Vercel hasta que se peguen en el dashboard.
-- ---------------------------------------------------------------------------
insert into agents (name, brand, country, whatsapp_number, model, system_prompt, temperature, vector_store_id, enabled)
select
  'Vitasei CO', 'Vitasei', 'CO', '573332877350',
  coalesce(ac.model, 'gpt-5.1'),
  coalesce(ac.system_prompt, 'Eres el asesor de ventas de Vitasei por WhatsApp.'),
  coalesce(ac.temperature, 0.3),
  ac.vector_store_id,
  true
from (values (1)) as one(x)
left join lateral (select * from agent_config where is_active = true limit 1) ac on true
where not exists (select 1 from agents);

-- ---------------------------------------------------------------------------
-- conversations.agent_id (a qué agente pertenece la conversación)
-- ---------------------------------------------------------------------------
alter table conversations add column if not exists agent_id uuid references agents(id) on delete set null;
create index if not exists idx_conversations_agent on conversations(agent_id);
update conversations
  set agent_id = (select id from agents order by created_at asc limit 1)
  where agent_id is null;

-- ---------------------------------------------------------------------------
-- products.agent_id (catálogo por marca) + unique (agent_id, sku)
-- ---------------------------------------------------------------------------
alter table products add column if not exists agent_id uuid references agents(id) on delete cascade;
update products
  set agent_id = (select id from agents order by created_at asc limit 1)
  where agent_id is null;

-- Antes: `sku` único global. Ahora: único POR agente (dos marcas pueden repetir SKU).
alter table products drop constraint if exists products_sku_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_agent_sku_key') then
    -- Backfill hecho arriba; ahora el agente es obligatorio en el catálogo.
    alter table products alter column agent_id set not null;
    alter table products add constraint products_agent_sku_key unique (agent_id, sku);
  end if;
end $$;
create index if not exists idx_products_agent on products(agent_id);
