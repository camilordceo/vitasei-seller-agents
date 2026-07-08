-- ============================================================================
-- Videos por palabra clave
-- 0016_videos.sql
-- Ver: docs/20-videos-por-palabra.md, ADR-0038
-- ============================================================================
--
-- Regla simple: si la RESPUESTA del bot menciona una palabra configurada (ej.
-- "magnesio"), el backend envía un video específico por Callbell después de la
-- respuesta (una sola vez por conversación). El match es case/acento-insensible
-- y por palabra completa (lógica pura en lib/agent/videoMatch.ts).
--
-- `agent_id` NULL = video GLOBAL (aplica a todas las marcas). Con ID = solo esa
-- marca (multi-agente). El backend carga los del agente de la conversación + los
-- globales. `video_url` debe ser una URL PÚBLICA (Callbell la reenvía a WhatsApp;
-- .mp4 recomendado). Requiere cuenta con WhatsApp Business API oficial.

create table videos (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid references agents(id) on delete cascade,  -- NULL = global
  keyword     text not null,          -- palabra/frase disparadora
  video_url   text not null,          -- URL pública del video (.mp4)
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Una palabra por marca (NULL cuenta como una "marca" distinta) — evita duplicados.
create unique index idx_videos_keyword_agent
  on videos (lower(keyword), coalesce(agent_id, '00000000-0000-0000-0000-000000000000'));
create index idx_videos_agent on videos(agent_id);

create trigger trg_videos_updated before update on videos
  for each row execute function set_updated_at();

-- RLS: el dashboard lee/escribe; el backend usa service_role (bypassa RLS).
alter table videos enable row level security;
create policy "auth read videos"  on videos for select to authenticated using (true);
create policy "auth write videos" on videos for all to authenticated using (true) with check (true);

comment on table videos is 'Videos que el bot envía cuando su respuesta menciona una palabra clave';
comment on column videos.agent_id is 'NULL = global (todas las marcas); con ID = solo ese agente';
comment on column videos.keyword is 'Palabra/frase disparadora; el match es case/acento-insensible y por palabra completa';
comment on column videos.video_url is 'URL pública del video (Callbell la reenvía; .mp4 recomendado)';
