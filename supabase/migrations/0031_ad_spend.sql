-- 0031 — Gasto REAL en pauta, recibido por API desde el producto de anuncios.
-- Ver ADR-0082, docs/28-api-gasto-en-pauta.md.
--
-- Hasta ahora la inversión del ROAS era una estimación: `chats × agents.cost_per_chat`,
-- un promedio tecleado a mano. Eso sigue existiendo (es el piso cuando no hay dato),
-- pero cuando la plataforma nos dice cuánto se gastó DE VERDAD ese día, manda el dato.
--
-- Grano: día × agente × plataforma × campaña. Es el grano más fino que la API de
-- anuncios entrega de forma estable y el más grueso que todavía deja ver "el martes
-- quemamos plata y no vendimos". Un total mensual no responde eso.
--
-- IDEMPOTENCIA por (agent_id, date, platform, campaign_id): el envío REEMPLAZA, no
-- suma. Meta reexpresa el gasto de los últimos días (ventanas de atribución), así que
-- Roberto va a reenviar los mismos días una y otra vez; con insert-only el gasto se
-- duplicaría cada noche. `campaign_id` es '' (no NULL) cuando el envío viene sin
-- desglose: NULL no colisiona consigo mismo en un índice único y la idempotencia
-- se caería en silencio justo en el caso más común.

create table if not exists public.ad_spend (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  -- Día calendario del reporte de la plataforma (se lee como día de Bogota).
  date date not null,
  platform text not null default 'meta',
  account_id text,
  campaign_id text not null default '',
  campaign_name text,
  -- Gasto del día en `currency`. >= 0: un gasto negativo es un reembolso, y eso
  -- todavía no lo sabemos leer — mejor rechazarlo que promediarlo en silencio.
  spend numeric(14, 4) not null default 0 check (spend >= 0),
  currency text not null,
  impressions bigint,
  clicks bigint,
  -- Leads/conversaciones que REPORTA la plataforma. No reemplazan nuestros chats:
  -- miden otra cosa (clic en el anuncio vs. persona que sí escribió). La brecha
  -- entre los dos es una señal, no un error a corregir.
  leads integer,
  -- 'api' (Roberto) o 'manual' (cargado a mano en el dashboard, si algún día se ofrece).
  source text not null default 'api',
  -- Payload crudo del envío, para poder auditar de dónde salió un número raro.
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ad_spend_unique_key
  on public.ad_spend (agent_id, date, platform, campaign_id);

create index if not exists ad_spend_agent_date_idx
  on public.ad_spend (agent_id, date desc);

comment on table public.ad_spend is
  'Gasto real en pauta por día/agente/plataforma/campaña, recibido por POST /api/ingest/ad-spend. Ver ADR-0082.';
comment on column public.ad_spend.campaign_id is
  'Id de campaña, o cadena vacía cuando el envío es el total del agente ese día (NULL rompería la idempotencia).';
comment on column public.ad_spend.leads is
  'Leads que reporta la plataforma. Referencia: los chats reales salen de conversations.';

-- Service role only (todo el acceso pasa por el server). Sin políticas: RLS activo
-- y sin policies = nadie con anon key lee ni escribe.
alter table public.ad_spend enable row level security;
