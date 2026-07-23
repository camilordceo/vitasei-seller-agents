-- ============================================================================
-- Resultado de la llamada → orden, y campañas de llamadas masivas
-- 0032_voice_outcome_and_campaigns.sql
-- Ver: docs/29-llamadas-resultado-y-campanas.md, ADR-0083 y ADR-0084
-- ============================================================================
--
-- Dos huecos que dejó la primera versión de las llamadas con IA (docs/25):
--
--  1. **Nadie se enteraba de las ventas.** La llamada extraía datos y los dejaba
--     en `extracted` como texto suelto. Hubo llamadas que cerraron compra y
--     había que abrir el detalle una por una para descubrirlo. Ahora un
--     extractor puede marcarse como "resultado de la llamada" (p.ej.
--     `resultado_llamada` con opciones compra / no interesada) y, cuando cae en
--     una de las opciones de compra, se genera la ORDEN igual que en WhatsApp:
--     con aviso al dueño, cancelación de seguimientos y fila en Órdenes.
--
--  2. **No se podía llamar en frío.** Todo salía de una conversación de
--     WhatsApp. Ahora se sube un CSV/Excel con N números y se llama uno cada X
--     minutos (`voice_campaigns`), reusando el MISMO motor: cron con claim
--     atómico, guardas de país/horario, reconciliación y cierre.
--
-- Consecuencia de (2): una llamada de campaña **no tiene conversación** — es un
-- número frío. Por eso `conversation_id` y `contact_id` pasan a ser opcionales.
-- La conversación se crea SOLO si hay venta (ahí sí hace falta: la orden cuelga
-- de ella), no antes: 100 conversaciones vacías envenenarían los reportes de
-- chats y el ROAS.

-- 1) Resultado de la llamada y orden generada ---------------------------------
alter table voice_calls
  add column if not exists outcome text,
  add column if not exists order_id uuid references orders(id) on delete set null;

comment on column voice_calls.outcome is
  'Valor crudo del extractor marcado como resultado (p.ej. "compra", "no interesada"). NULL = sin extractor de resultado o no se extrajo. Ver ADR-0083';
comment on column voice_calls.order_id is
  'Orden generada por esta llamada (resultado = compra). NULL = no hubo venta. Ver ADR-0083';

create index if not exists idx_voice_calls_outcome on voice_calls (outcome)
  where outcome is not null;

-- 2) Campañas de llamadas masivas ---------------------------------------------
create table if not exists voice_campaigns (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  name text not null,
  -- text + CHECK (no enum) siguiendo ADR-0055/0056: sumar un estado no exige ALTER TYPE.
  status text not null default 'running' check (status in (
    'running', 'paused', 'completed', 'cancelled'
  )),
  -- Ritmo: una llamada cada N minutos. El cron corre cada minuto, así que la
  -- precisión real es ~1 minuto (ver ADR-0084).
  interval_minutes integer not null default 2 check (interval_minutes between 1 and 1440),
  guidance text,
  source_filename text,
  total integer not null default 0,
  starts_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table voice_campaigns is
  'Campañas de llamadas masivas: una lista de números (CSV/Excel) que se llama a ritmo controlado. Ver docs/29 y ADR-0084';
comment on column voice_campaigns.interval_minutes is
  'Minutos entre llamadas. El worker NO coloca la siguiente hasta que pasó este tiempo desde la anterior: si el cron se cae una hora, al volver NO dispara la cola entera de golpe.';
comment on column voice_campaigns.guidance is
  'Objetivo de la campaña; se inyecta en el prompt de voz de cada llamada (como la guía de una etapa).';
comment on column voice_campaigns.status is
  'running = colocando · paused = el operador la detuvo · completed = no quedan pendientes · cancelled = se tumbaron las pendientes.';

create index if not exists idx_voice_campaigns_agent on voice_campaigns (agent_id, created_at desc);

drop trigger if exists trg_voice_campaigns_updated on voice_campaigns;
create trigger trg_voice_campaigns_updated
  before update on voice_campaigns
  for each row execute function set_updated_at();

alter table voice_campaigns enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'voice_campaigns'
      and policyname = 'auth read voice_campaigns'
  ) then
    create policy "auth read voice_campaigns" on voice_campaigns
      for select to authenticated using (true);
  end if;
end $$;

-- 3) `voice_calls` como fila de campaña ---------------------------------------
alter table voice_calls
  add column if not exists campaign_id uuid references voice_campaigns(id) on delete cascade,
  add column if not exists contact_name text,
  add column if not exists variables jsonb;

comment on column voice_calls.campaign_id is
  'Campaña que originó la llamada. NULL = llamada de una conversación (cadencia, manual o pedida).';
comment on column voice_calls.contact_name is
  'Nombre que venía en el archivo de la campaña (Synthflow lo exige en POST /v2/calls).';
comment on column voice_calls.variables is
  'Columnas extra del archivo, tal cual: viajan como custom_variables y se pueden referenciar con {llaves} en el prompt.';

-- Un número frío no tiene conversación ni contacto hasta que compra.
alter table voice_calls alter column conversation_id drop not null;
alter table voice_calls alter column contact_id drop not null;

-- `trigger` gana el valor 'campaign'. Se borra el CHECK anterior buscándolo por
-- definición: el nombre lo generó Postgres y no queremos depender de él.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'voice_calls'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%trigger%'
  loop
    execute format('alter table voice_calls drop constraint %I', c.conname);
  end loop;
end $$;

alter table voice_calls
  add constraint voice_calls_trigger_check
  check (trigger in ('auto', 'manual', 'request', 'campaign'));

-- El worker toma las pendientes de una campaña por orden y mira cuándo salió la
-- última para respetar el ritmo.
create index if not exists idx_voice_calls_campaign
  on voice_calls (campaign_id, status, scheduled_at);
create index if not exists idx_voice_calls_campaign_placed
  on voice_calls (campaign_id, placed_at desc);

-- OJO: el índice parcial `idx_voice_calls_live (conversation_id, stage)` sigue
-- sirviendo tal cual — en un índice UNIQUE los NULL no chocan entre sí, así que
-- mil llamadas de campaña sin conversación conviven sin problema.

-- 4) La conversación puede nacer de una llamada -------------------------------
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'conversations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table conversations drop constraint %I', c.conname);
  end loop;
end $$;

alter table conversations
  add constraint conversations_source_check
  check (source in ('whatsapp', 'hotmart', 'manual', 'other', 'voice'));

comment on column conversations.source is
  'Origen: whatsapp (inbound), hotmart (carrito abandonado), voice (nació de una llamada con IA que cerró venta), manual, other';
