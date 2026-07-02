-- ---------------------------------------------------------------------------
-- 0006 — Retargeting (seguimientos automáticos 1h/8h)
--
-- Cuando el bot responde y el cliente deja de responder, se agendan dos
-- seguimientos: uno ~1h después y otro ~8h después (delays configurables por
-- env). Un cron (Vercel Cron, nativo — sin servicios extra, ver ADR-0012/0017)
-- corre cada pocos minutos, toma los seguimientos vencidos y, si la conversación
-- sigue activa y el cliente no respondió, genera un mensaje de seguimiento
-- DINÁMICO con Responses (encadenando `previous_response_id`) y lo envía.
--
-- `anchor_inbound_at` guarda el `last_inbound_at` de la conversación al momento
-- de agendar: si al disparar ese valor cambió, el cliente respondió y el
-- seguimiento se cancela (obsoleto).
-- ---------------------------------------------------------------------------
create type retarget_status as enum (
  'scheduled',   -- agendado, esperando su hora
  'processing',  -- tomado por el worker (claim atómico) — evita doble envío
  'sent',        -- enviado
  'skipped',     -- no se envió (fuera de ventana 24h / sin config / sin texto)
  'cancelled',   -- cancelado (cliente respondió / conversación no activa / reagendado)
  'failed'       -- error al procesar
);

create table retargets (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references conversations(id) on delete cascade,
  contact_id         uuid not null references contacts(id) on delete cascade,
  phone              text not null,                       -- E.164 sin '+'
  stage              smallint not null check (stage in (1, 2)),  -- 1 = ~1h, 2 = ~8h
  status             retarget_status not null default 'scheduled',
  scheduled_at       timestamptz not null,               -- cuándo debe dispararse
  anchor_inbound_at  timestamptz,                        -- last_inbound_at al agendar
  sent_at            timestamptz,
  error              text,                               -- razón de skip/cancel/fail
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- El worker busca por (status, scheduled_at); el cancel busca por conversación.
create index idx_retargets_due          on retargets(status, scheduled_at);
create index idx_retargets_conversation on retargets(conversation_id);

-- A lo sumo un seguimiento VIVO por (conversación, etapa). `scheduleRetargets`
-- cancela los previos antes de insertar, así que esto es una red de seguridad
-- contra duplicados por carreras.
create unique index idx_retargets_live on retargets(conversation_id, stage)
  where status in ('scheduled', 'processing');

create trigger trg_retargets_updated before update on retargets
  for each row execute function set_updated_at();

-- RLS: lectura para el dashboard (autenticados); el backend escribe con service_role.
alter table retargets enable row level security;
create policy "auth read retargets" on retargets for select to authenticated using (true);
