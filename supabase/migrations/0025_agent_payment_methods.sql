-- ============================================================================
-- Métodos de pago por agente + fulfillment_method a texto — 0025_agent_payment_methods.sql
-- Ver: docs/03-agente-prompt-y-tags.md, docs/02-supabase-schema.md, ADR-0055
-- ============================================================================
--
-- Antes: los tags de pago estaban cableados (#compra-contra-entrega → cod,
-- #addi → addi) y `fulfillment_method` era un ENUM fijo ('addi','cod','undecided'),
-- iguales para TODOS los agentes.
--
-- Ahora: cada agente define sus métodos de pago según su mercado (Colombia:
-- contra-entrega/addi; EE.UU.: Zelle; etc.) en un jsonb `payment_methods`:
--   [{ "tag": "#zelle", "label": "Zelle", "method": "zelle" }, ...]
--   · tag:    lo que emite el modelo (se detecta, se quita del texto, fija método).
--   · label:  nombre visible (aviso al dueño + reporte "por método").
--   · method: clave guardada en `fulfillment_method` (texto libre).
--
-- Como los métodos ya no son un set fijo, `fulfillment_method` deja de ser enum y
-- pasa a TEXTO libre (mismo criterio que `events_log.source`, ADR-0013). Los
-- agentes existentes (Colombia) conservan contra-entrega/addi con las claves
-- históricas cod/addi para no partir los reportes.
--
-- `payment_methods` se lee en consulta aparte (NO en AGENT_COLS) y resiliente a
-- 42703, para NO arriesgar la ruta crítica de inbound si no está aplicada.

-- 1) Config de métodos de pago por agente -----------------------------------
alter table agents
  add column if not exists payment_methods jsonb not null default '[]'::jsonb;

comment on column agents.payment_methods is
  'Métodos de pago del agente: jsonb array [{tag,label,method}]. El tag se detecta para fijar el método y generar la orden. Ver ADR-0055';

-- Seed: los agentes existentes son de Colombia → contra-entrega + addi (claves
-- históricas cod/addi). Solo los que aún están vacíos (recién creada la columna).
update agents
set payment_methods = jsonb_build_array(
      jsonb_build_object('tag', '#compra-contra-entrega', 'label', 'Contra entrega', 'method', 'cod'),
      jsonb_build_object('tag', '#addi', 'label', 'Addi', 'method', 'addi')
    )
where payment_methods is null
   or jsonb_array_length(payment_methods) = 0;

-- 2) fulfillment_method: ENUM → TEXTO libre ---------------------------------
-- Ambas tablas usan el tipo; se convierten las dos y luego se elimina el tipo.
-- Idempotente: repetir la conversión sobre una columna ya de texto es un no-op.
alter table conversations alter column fulfillment_method drop default;
alter table conversations
  alter column fulfillment_method type text using fulfillment_method::text;
alter table conversations alter column fulfillment_method set default 'undecided';

alter table orders
  alter column fulfillment_method type text using fulfillment_method::text;

drop type if exists fulfillment_method;
