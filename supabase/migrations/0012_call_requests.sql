-- ---------------------------------------------------------------------------
-- 0012 — Solicitudes de llamada (#llamada)
--
-- Cuando el cliente pide que lo llamen, el modelo emite el tag `#llamada` (en su
-- propia línea, como `#orden-lista`/`#humano`). El backend lo detecta, lo quita
-- del texto que ve el cliente y crea una `call_requests` (cola de trabajo para el
-- equipo) + avisa al dueño por WhatsApp. NO fuerza handoff ni apaga el bot: es
-- solo una solicitud. Ver ADR-0034.
--
-- `status`: pending (recién pedida) → done (ya llamaron) / cancelled (descartada).
-- El índice parcial garantiza a lo sumo UNA solicitud viva (pending) por
-- conversación: red anti-duplicados si el modelo repite el tag.
-- ---------------------------------------------------------------------------
create type call_request_status as enum ('pending', 'done', 'cancelled');

create table call_requests (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  contact_id       uuid not null references contacts(id) on delete cascade,
  agent_id         uuid references agents(id) on delete set null,  -- marca dueña (multi-agente)
  phone            text not null,                                  -- E.164 sin '+'
  note             text,                                           -- nota manual (opcional)
  status           call_request_status not null default 'pending',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- La lista del dashboard filtra por (status, created_at); el chequeo de duplicado
-- busca por conversación.
create index idx_call_requests_status       on call_requests(status, created_at desc);
create index idx_call_requests_conversation on call_requests(conversation_id);

-- A lo sumo una solicitud VIVA (pending) por conversación.
create unique index idx_call_requests_live on call_requests(conversation_id)
  where status = 'pending';

create trigger trg_call_requests_updated before update on call_requests
  for each row execute function set_updated_at();

-- RLS: el dashboard lee y actualiza (marcar hecha/cancelar); el backend inserta
-- con service_role (bypassa RLS).
alter table call_requests enable row level security;
create policy "auth read call_requests"  on call_requests for select to authenticated using (true);
create policy "auth write call_requests" on call_requests for update to authenticated using (true) with check (true);
