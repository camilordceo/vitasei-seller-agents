-- 0028 — Costo por chat por agente (ROAS). Ver ADR-0065, docs/26.
--
-- Cuánto cuesta traer UNA conversación (pauta / adquisición) en el mercado de ese
-- agente. Con esto el dashboard calcula el retorno: ventas ÷ (chats × costo).
--
-- La moneda vive junto al costo porque el costo por chat es de un mercado, no del
-- proyecto: Colombia factura la pauta en COP y EE.UU. en USD, y sumarlos daría un
-- número falso. Los reportes solo consolidan cuando todo el alcance comparte moneda.
--
-- NULL = sin configurar (≠ 0). El reporte muestra al agente igual, con sus chats y
-- ventas, pero sin inventarle un ROAS.

alter table public.agents
  add column if not exists cost_per_chat numeric(14, 4),
  add column if not exists cost_currency text not null default 'COP';

comment on column public.agents.cost_per_chat is
  'Costo de adquirir una conversación (pauta) en la moneda de cost_currency. NULL = sin configurar.';
comment on column public.agents.cost_currency is
  'Moneda ISO-4217 del costo por chat y de la lectura de retorno de este agente (COP, USD, ...).';
