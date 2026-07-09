-- ============================================================================
-- Plantillas de Hotmart editables desde el dashboard + marca de flujo
-- 0019_hotmart_templates.sql
-- Ver: docs/17-hotmart-carritos.md, ADR-0040
-- ============================================================================
--
-- Hasta ahora el carrito abandonado usaba UNA plantilla fija por env
-- (`HOTMART_ABANDONED_CART_TEMPLATE_UUID`) y un texto hardcodeado. Esta tabla
-- lleva esa configuración a la base de datos para poder cambiarla desde el
-- dashboard (igual que los videos): el UUID de la plantilla de Callbell y el
-- texto del mensaje (con placeholders {{nombre}} y {{producto}}).
--
-- `agent_id` NULL = plantilla GLOBAL (todas las marcas). Con ID = solo esa marca
-- (los `template_uuid` viven en la cuenta de Callbell de cada agente, así que el
-- match por agente pesa MÁS que el de producto). `product_id` NULL = aplica a
-- todos los productos de ese evento; con valor = plantilla específica de un curso.

create table hotmart_templates (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid references agents(id) on delete cascade,  -- NULL = global
  -- Evento de Hotmart que dispara esta plantilla (por ahora solo carrito abandonado).
  event_type    text not null default 'PURCHASE_OUT_OF_SHOPPING_CART',
  -- Producto de Hotmart (id numérico como texto). NULL = aplica a todos.
  product_id    text,
  -- Nombre amigable para reconocerla en el dashboard.
  name          text not null,
  -- UUID de la plantilla APROBADA en Callbell. NULL = no se envía (solo se registra el evento).
  template_uuid text,
  -- Texto del mensaje: se guarda en `messages` y se manda como `content.text`.
  -- Soporta {{nombre}} y {{producto}} (se reemplazan por los datos del comprador).
  message_text  text,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Búsqueda del webhook: plantillas habilitadas de un evento (se ordena/prioriza en JS).
create index idx_hotmart_templates_lookup on hotmart_templates (event_type, enabled);
create index idx_hotmart_templates_agent on hotmart_templates (agent_id);

create trigger trg_hotmart_templates_updated before update on hotmart_templates
  for each row execute function set_updated_at();

-- RLS: el dashboard lee/escribe (authenticated); el backend usa service_role (bypassa RLS).
alter table hotmart_templates enable row level security;
create policy "auth read hotmart_templates"  on hotmart_templates for select to authenticated using (true);
create policy "auth write hotmart_templates" on hotmart_templates for all    to authenticated using (true) with check (true);

comment on table hotmart_templates is 'Plantillas de Hotmart (carrito abandonado) editables desde el dashboard';
comment on column hotmart_templates.agent_id is 'NULL = global (todas las marcas); con ID = solo ese agente (su cuenta de Callbell)';
comment on column hotmart_templates.product_id is 'Producto de Hotmart (id como texto); NULL = aplica a todos los productos del evento';
comment on column hotmart_templates.template_uuid is 'UUID de la plantilla aprobada en Callbell; NULL = no se envía';
comment on column hotmart_templates.message_text is 'Texto guardado/enviado; soporta {{nombre}} y {{producto}}';

-- ---------------------------------------------------------------------------
-- Marca de "flujo hotmart" en la conversación
-- ---------------------------------------------------------------------------
-- Rastro autoritativo de que la conversación viene de un carrito abandonado de
-- Hotmart (cursos). Se activa al adjuntar la plantilla, tanto en conversaciones
-- NUEVAS como EXISTENTES (a diferencia de `source`, que solo se fija al crear).
-- Es la compuerta para (1) inyectar "Es flujo hotmart" en el mensaje que ve la
-- IA cuando el cliente responde y (2) mostrar el badge en el panel.
alter table conversations
  add column if not exists hotmart_flow boolean not null default false;

create index if not exists idx_conversations_hotmart_flow
  on conversations (hotmart_flow) where hotmart_flow;

comment on column conversations.hotmart_flow is 'true si la conversación entró por el flujo de Hotmart (carrito abandonado de cursos)';
