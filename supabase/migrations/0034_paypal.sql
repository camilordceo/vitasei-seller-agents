-- ============================================================================
-- PayPal por agente: link de pago automático al cerrar con #paypal
-- 0034_paypal.sql
-- Ver: ADR-0088
-- ============================================================================
--
-- El agente de EE.UU. cierra la venta con el tag `#paypal` (método de pago del
-- agente, ADR-0055). Hasta ahora el link de pago se armaba A MANO por cada
-- cliente. Con esto el backend lo genera solo con la API de PayPal
-- (Invoicing v2): ítems con precio, impuesto (%) y envío de la config del
-- agente, y lo manda por WhatsApp junto a un mensaje configurable.
--
--   · `agents.paypal_config` — credenciales + mensaje + tax/envío, POR agente
--     (cada marca/mercado tiene su cuenta de PayPal).
--   · `orders.payment_link` / `payment_link_id` — el link (invoice) generado
--     para ESA orden: idempotencia (no crear dos invoices por la misma venta)
--     y reenvío del mismo link si el cliente lo vuelve a pedir.

alter table agents
  add column if not exists paypal_config jsonb;

comment on column agents.paypal_config is
  'Config de PayPal del agente: {client_id, client_secret (SECRETO, solo server), sandbox, message ({link} = placeholder), tax_percent, shipping}. NULL = feature apagado. Ver ADR-0088';

alter table orders
  add column if not exists payment_link text,
  add column if not exists payment_link_id text;

comment on column orders.payment_link is
  'Link de pago (invoice de PayPal) generado para esta orden. Si ya existe, se reenvía el mismo en vez de crear otro invoice. Ver ADR-0088';
comment on column orders.payment_link_id is
  'Id del invoice en PayPal (INV2-...) para conciliar el pago en el panel de PayPal.';
