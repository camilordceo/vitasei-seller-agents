-- ============================================================================
-- Proveedor de WhatsApp por agente (Callbell | Kapso) — 0026_agent_provider_kapso.sql
-- Ver: docs/24-integracion-kapso.md, docs/02-supabase-schema.md, ADR-0056
-- ============================================================================
--
-- Antes: el backend hablaba SOLO con Callbell. `agents` guardaba únicamente sus
-- credenciales (`callbell_api_key`, `callbell_channel_uuid`) y el envío estaba
-- cableado en el código.
--
-- Ahora: cada agente elige su **proveedor** (`provider`) y guarda las credenciales
-- de ESE proveedor. Los dos conviven en el mismo deploy: una marca puede seguir en
-- Callbell mientras la línea de Hotmart opera en Kapso. El cerebro (debounce, gate,
-- órdenes, retargets, reactivaciones, Hotmart) es el MISMO para ambos; lo único que
-- cambia es el transporte.
--
-- Kapso es un proxy Meta-compatible, así que sus identificadores son los de Meta:
--   · kapso_phone_number_id → Meta Phone Number ID. Va en el path del envío
--     (`/v24.0/{phone_number_id}/messages`) y es el campo por el que se ENRUTA el
--     inbound (viaja top-level en todos sus webhooks). Es el análogo de
--     `callbell_channel_uuid`.
--   · kapso_api_key        → SECRETO. Header `X-API-Key` (por proyecto de Kapso).
--   · kapso_webhook_secret → SECRETO. `secret_key` de la firma HMAC SHA256.
--   · kapso_template_language → las plantillas de Kapso se referencian por
--     nombre + idioma (Callbell usa un uuid), así que hace falta un idioma default.
--
-- Idempotente: seguro de correr más de una vez.
--
-- ORDEN DE DESPLIEGUE: da igual. El código tolera que esta migración no esté
-- aplicada (`selectAgents` reintenta sin estas columnas ante 42703 → `provider`
-- llega undefined → 'callbell' → el comportamiento de hoy). Ver ADR-0056.

-- 1) Proveedor -------------------------------------------------------------
-- TEXTO y no enum, mismo criterio que `fulfillment_method` (ADR-0055) y
-- `events_log.type` (ADR-0013): agregar un tercer proveedor no debe requerir un
-- ALTER TYPE. El CHECK acota los valores válidos sin la rigidez del enum.
alter table agents
  add column if not exists provider text not null default 'callbell';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agents_provider_check') then
    alter table agents add constraint agents_provider_check
      check (provider in ('callbell', 'kapso'));
  end if;
end $$;

comment on column agents.provider is
  'Proveedor de WhatsApp del agente: callbell (histórico, default) | kapso. Decide el adaptador de envío y qué webhook lo enruta. Ver ADR-0056';

-- 2) Credenciales de Kapso --------------------------------------------------
alter table agents
  add column if not exists kapso_api_key           text,
  add column if not exists kapso_phone_number_id   text,
  add column if not exists kapso_webhook_secret    text,
  add column if not exists kapso_template_language text;

comment on column agents.kapso_api_key is
  'SECRETO — API key del proyecto de Kapso (header X-API-Key). null => env.KAPSO_API_KEY';
comment on column agents.kapso_phone_number_id is
  'Meta Phone Number ID: path de envío + enrutamiento del inbound (análogo a callbell_channel_uuid)';
comment on column agents.kapso_webhook_secret is
  'SECRETO — secret_key con el que Kapso firma el webhook (HMAC SHA256). null => env.KAPSO_WEBHOOK_SECRET';
comment on column agents.kapso_template_language is
  'Idioma por defecto de las plantillas de Kapso (es, es_CO, en_US…). null => env o "es"';

-- Enrutamiento del inbound de Kapso: mismo patrón que idx_agents_channel.
create index if not exists idx_agents_kapso_phone_number
  on agents(kapso_phone_number_id);

-- Los agentes existentes son de Callbell: el default los cubre, pero lo dejamos
-- explícito por si alguna fila quedó con null de una corrida parcial.
update agents set provider = 'callbell' where provider is null;

-- 3) Documentar el REUSO de columnas ----------------------------------------
-- Estas columnas nacieron con nombre de Callbell y ahora guardan el valor del
-- proveedor que corresponda. Se reusan (en vez de renombrar o duplicar) porque el
-- dato cumple exactamente la misma función y los espacios de nombres no chocan:
-- un `wamid…` de Kapso jamás colisiona con un uuid de Callbell. Renombrarlas
-- tocaría ~15 archivos de la ruta crítica sin ganar nada funcional. Ver ADR-0056.
comment on column messages.callbell_message_uuid is
  'Id del mensaje EN EL PROVEEDOR: uuid en Callbell, wamid en Kapso. Clave de idempotencia del webhook. El nombre es histórico (ADR-0056)';
comment on column conversations.callbell_conversation_href is
  'Referencia de la conversación en el proveedor: href en Callbell, conversation id en Kapso. Solo trazabilidad. Nombre histórico (ADR-0056)';
comment on column agents.reactivation_template_7d is
  'Referencia de plantilla DEL PROVEEDOR: uuid en Callbell, nombre (opcionalmente "nombre:idioma") en Kapso. Ver ADR-0056';
comment on column agents.reactivation_template_15d is
  'Referencia de plantilla DEL PROVEEDOR: uuid en Callbell, nombre (opcionalmente "nombre:idioma") en Kapso. Ver ADR-0056';
comment on column hotmart_templates.template_uuid is
  'Referencia de plantilla DEL PROVEEDOR del agente: uuid en Callbell, nombre (opcionalmente "nombre:idioma") en Kapso. Ver ADR-0056';
