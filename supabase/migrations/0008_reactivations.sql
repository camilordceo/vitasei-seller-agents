-- ---------------------------------------------------------------------------
-- 0008 — Reactivaciones por plantilla (7 y 15 días) + app_settings
--
-- Nuevo feature CLAVE, apagable desde el dashboard (aún sin aprobación): cuando
-- un cliente llega por primera vez (se crea una conversación) se agendan dos
-- envíos de PLANTILLA de WhatsApp — a 7 y 15 días — para reactivar a quien no
-- compró ese día, a un costo mucho menor (plantilla ≈ US$0,015 c/u). El mismo
-- cron de retargets (cada 5 min) toma las vencidas y las envía con la API de
-- Callbell (fuera de la ventana de 24h se requiere plantilla aprobada).
--
-- Se cancelan si la persona termina comprando (se crea una orden). Reusa el enum
-- `retarget_status` (0006). Ver docs/14 y ADR-0021.
-- ---------------------------------------------------------------------------

-- Config editable desde el dashboard (una sola fila, id = 1).
create table app_settings (
  id                         smallint primary key default 1 check (id = 1),
  reactivation_enabled       boolean not null default false,  -- OFF hasta aprobación
  reactivation_template_7d   text,                            -- UUID plantilla Callbell (día 7)
  reactivation_template_15d  text,                            -- UUID plantilla Callbell (día 15)
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
insert into app_settings (id) values (1) on conflict (id) do nothing;
create trigger trg_app_settings_updated before update on app_settings
  for each row execute function set_updated_at();

-- Envíos de plantilla programados.
create table reactivations (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  contact_id       uuid not null references contacts(id) on delete cascade,
  phone            text not null,                              -- E.164 sin '+'
  stage            smallint not null check (stage in (1, 2)),  -- 1 = 7d, 2 = 15d
  status           retarget_status not null default 'scheduled',
  scheduled_at     timestamptz not null,                       -- cuándo debe dispararse
  template_uuid    text,                                       -- plantilla usada (snapshot al enviar)
  sent_at          timestamptz,
  cost_usd         numeric(8,4),                               -- costo del envío (control de costos)
  error            text,                                       -- razón de skip/cancel/fail
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- El worker busca por (status, scheduled_at); el cancel busca por conversación.
create index idx_reactivations_due          on reactivations(status, scheduled_at);
create index idx_reactivations_conversation on reactivations(conversation_id);

-- A lo sumo una reactivación VIVA por (conversación, etapa): red de seguridad
-- contra duplicados por carreras.
create unique index idx_reactivations_live on reactivations(conversation_id, stage)
  where status in ('scheduled', 'processing');

create trigger trg_reactivations_updated before update on reactivations
  for each row execute function set_updated_at();

-- RLS: lectura para el dashboard (autenticados); el backend escribe con service_role.
alter table app_settings  enable row level security;
alter table reactivations enable row level security;
create policy "auth read app_settings"  on app_settings  for select to authenticated using (true);
create policy "auth read reactivations" on reactivations for select to authenticated using (true);
