-- ============================================================================
-- Llamadas con IA (Synthflow) — 0027_voice_calls.sql
-- Ver: docs/25-llamadas-con-ia-synthflow.md, ADR-0060/0061/0062/0063
-- ============================================================================
--
-- El agente vendía solo por WhatsApp. Ahora puede LLAMAR: cada agente tiene su
-- propia IA de voz (prompt, saludo, voz, assistant de Synthflow y número saliente)
-- y una cadencia configurable de llamadas — p.ej. "1 llamada a los 10 min del
-- primer mensaje" o "3 llamadas: al llegar, a 24h y a 72h".
--
-- Mecánica clonada de `retargets` (ADR-0052/0063): agendar N etapas, cron con
-- claim atómico, índice parcial que impide duplicar una etapa viva. Diferencias
-- deliberadas (ver ADR-0063):
--   · SIN ventana de 24h: una llamada a las 72h es válida (WhatsApp no aplica).
--   · Ancla en el PRIMER inbound de la conversación, no en la respuesta del bot.
--   · Fuera del horario del agente se DIFIERE (no se omite): nadie debe recibir
--     una llamada de ventas a las 3am.
--
-- Todas las columnas nuevas de `agents` se leen en consultas APARTE (NO en
-- AGENT_COLS) y resilientes a 42703, para no arriesgar la ruta crítica de
-- inbound si esta migración aún no está aplicada.

-- 1) Config de voz por agente -----------------------------------------------
alter table agents
  add column if not exists voice_enabled boolean not null default false,
  add column if not exists synthflow_api_key text,
  add column if not exists synthflow_model_id text,
  add column if not exists synthflow_from_number text,
  add column if not exists voice_id text,
  add column if not exists voice_name text,
  add column if not exists voice_prompt text,
  add column if not exists voice_greeting text,
  add column if not exists voice_config jsonb,
  add column if not exists voice_countries jsonb,
  add column if not exists voice_extractors jsonb,
  add column if not exists voice_stop_when_answered boolean not null default true;

comment on column agents.voice_enabled is
  'Prende/apaga la IA de llamadas del agente. OFF por defecto: prender exige además VOICE_CALLS_ENABLED. Ver ADR-0063';
comment on column agents.synthflow_api_key is
  'SECRETO. API key de Synthflow del agente; NULL usa SYNTHFLOW_API_KEY del entorno.';
comment on column agents.synthflow_model_id is
  'Assistant (model_id) de Synthflow que ejecuta la llamada. Se REFERENCIA, no se muta. Ver ADR-0060';
comment on column agents.synthflow_from_number is
  'Numero saliente en E.164 CON + (convencion de Synthflow, distinta a la interna sin +).';
comment on column agents.voice_prompt is
  'Prompt de VOZ del agente, separado del de WhatsApp. Viaja por llamada en POST /v2/calls. Ver ADR-0060';
comment on column agents.voice_config is
  'Cadencia de llamadas: jsonb array [{delayMinutes,guidance}]. NULL/vacio = no se agenda nada. Ver ADR-0063';
comment on column agents.voice_countries is
  'Prefijos E.164 permitidos, p.ej. ["57"]. NULL/vacio = todos los paises. Ver ADR-0063';
comment on column agents.voice_extractors is
  'Extractores por agente: jsonb array [{identifier,type,condition,choices,examples,actionId}]. Ver ADR-0062';
comment on column agents.voice_stop_when_answered is
  'Si el cliente ya contesto, cancela las etapas restantes. El objetivo es hablar con el, no llamarlo 3 veces.';

-- 2) Tabla de llamadas -------------------------------------------------------
-- `status` es TEXT + CHECK (no enum) siguiendo ADR-0055/0056: agregar un estado
-- no exige ALTER TYPE. No se reusa `retarget_status` porque una llamada tiene
-- desenlaces propios (no_answer) y datos propios (duracion, grabacion).
create table if not exists voice_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  phone text not null,

  -- Agendamiento (espejo de `retargets`)
  stage smallint not null default 1 check (stage >= 1),
  delay_minutes integer,
  trigger text not null default 'auto' check (trigger in ('auto', 'manual', 'request')),
  status text not null default 'scheduled' check (status in (
    'scheduled', 'processing', 'placed', 'completed', 'no_answer',
    'failed', 'cancelled', 'skipped'
  )),
  scheduled_at timestamptz not null default now(),
  anchor_inbound_at timestamptz,

  -- Ciclo de vida real de la llamada
  placed_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,

  -- Datos de Synthflow (fuente de verdad = GET /v2/calls/{id}, ver ADR-0061)
  synthflow_call_id text unique,
  synthflow_model_id text,
  call_status text,
  end_call_reason text,
  duration_sec integer,
  cost_usd numeric(8, 4),
  transcript text,
  recording_url text,
  summary text,
  extracted jsonb,

  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table voice_calls is
  'Llamadas con IA (Synthflow): programadas, en curso y realizadas. Ver docs/25 y ADR-0060..0063';
comment on column voice_calls.synthflow_call_id is
  'call_id de Synthflow. UNIQUE: es la llave de idempotencia del cierre (webhook y reconciliacion entran por el mismo camino). Ver ADR-0061';
comment on column voice_calls.extracted is
  'Datos extraidos ya normalizados {identifier: valor}. Valor puede ser escalar u objeto anidado. Ver ADR-0062';
comment on column voice_calls.cost_usd is
  'Costo estimado = duration_sec/60 * SYNTHFLOW_USD_PER_MINUTE. Synthflow NO expone costo por API.';
comment on column voice_calls.trigger is
  'auto = cadencia del agente; manual = boton en la conversacion; request = pedido con #llamada.';

-- Cron: buscar vencidas. Igual que idx_retargets_due.
create index if not exists idx_voice_calls_due on voice_calls (status, scheduled_at);
create index if not exists idx_voice_calls_conversation on voice_calls (conversation_id);
-- Busqueda por telefono del cliente en la seccion Llamadas.
create index if not exists idx_voice_calls_phone on voice_calls (phone);
-- Reconciliacion: llamadas colocadas sin desenlace.
create index if not exists idx_voice_calls_open on voice_calls (status, placed_at)
  where status = 'placed';

-- Una sola etapa viva por conversacion: si dos ejecuciones intentan agendar la
-- misma etapa, la segunda choca contra el indice en vez de duplicar la llamada.
create unique index if not exists idx_voice_calls_live
  on voice_calls (conversation_id, stage)
  where status in ('scheduled', 'processing');

drop trigger if exists trg_voice_calls_updated on voice_calls;
create trigger trg_voice_calls_updated
  before update on voice_calls
  for each row execute function set_updated_at();

alter table voice_calls enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'voice_calls'
      and policyname = 'auth read voice_calls'
  ) then
    create policy "auth read voice_calls" on voice_calls
      for select to authenticated using (true);
  end if;
end $$;
