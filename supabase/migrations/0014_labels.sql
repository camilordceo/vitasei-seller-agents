-- ============================================================================
-- Etiquetas de Conversaciones
-- 0014_labels.sql
-- Ver: docs/18-etiquetas-conversaciones.md, ADR-0036
-- ============================================================================

-- ---------------------------------------------------------------------------
-- labels: catálogo de etiquetas disponibles
-- ---------------------------------------------------------------------------
create table labels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#6B7280',  -- hex color para el badge
  -- NULL = global (todas las conversaciones), con ID = solo ese agente
  agent_id    uuid references agents(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Nombre único por agente (NULL cuenta como un "agente" distinto)
create unique index idx_labels_name_agent on labels (name, coalesce(agent_id, '00000000-0000-0000-0000-000000000000'));

-- Índices
create index idx_labels_agent on labels(agent_id);

-- Trigger para updated_at
create trigger trg_labels_updated before update on labels
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- conversation_labels: relación N:M entre conversaciones y etiquetas
-- ---------------------------------------------------------------------------
create table conversation_labels (
  conversation_id  uuid not null references conversations(id) on delete cascade,
  label_id         uuid not null references labels(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (conversation_id, label_id)
);

-- Índices para queries frecuentes
create index idx_conversation_labels_conversation on conversation_labels(conversation_id);
create index idx_conversation_labels_label on conversation_labels(label_id);

-- ---------------------------------------------------------------------------
-- RLS: el backend usa service_role, el dashboard puede leer/escribir
-- ---------------------------------------------------------------------------
alter table labels enable row level security;
alter table conversation_labels enable row level security;

create policy "auth read labels" on labels
  for select to authenticated using (true);
create policy "auth write labels" on labels
  for all to authenticated using (true) with check (true);

create policy "auth read conversation_labels" on conversation_labels
  for select to authenticated using (true);
create policy "auth write conversation_labels" on conversation_labels
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Seed: etiquetas globales por defecto
-- ---------------------------------------------------------------------------
insert into labels (name, color, agent_id) values
  ('No interesado', '#EF4444', null),      -- Rojo
  ('Sin presupuesto', '#F59E0B', null),    -- Amarillo
  ('Llamar después', '#3B82F6', null),     -- Azul
  ('Cliente VIP', '#10B981', null),        -- Verde
  ('Seguimiento', '#F59E0B', null),        -- Amarillo
  ('Comprobante pendiente', '#8B5CF6', null); -- Morado

-- ---------------------------------------------------------------------------
-- Comentarios
-- ---------------------------------------------------------------------------
comment on table labels is 'Catálogo de etiquetas para clasificar conversaciones';
comment on column labels.color is 'Color hex para el badge (#RRGGBB)';
comment on column labels.agent_id is 'NULL = global, con ID = solo para ese agente';
comment on table conversation_labels is 'Relación N:M entre conversaciones y etiquetas';
