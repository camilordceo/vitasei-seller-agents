-- 0029 — Moneda de VENTA del agente. Ver ADR-0068.
--
-- Separada de `cost_currency` (0028) a propósito: esa es la moneda en la que se
-- PAGA la pauta y esta es en la que se VENDE. Hoy coinciden en todos los mercados,
-- pero son decisiones distintas (se puede pagar pauta en USD y facturar en COP) y
-- fusionarlas obligaría a migrar datos el día que se separen.
--
-- Para qué sirve: al filtrar Órdenes por un agente, sus totales se leen en esta
-- moneda. Las órdenes viejas sin `currency` (o con una que no sea de ese mercado)
-- heredan esta como la del agente que las generó.
--
-- Default COP = mercado original (Colombia). Los agentes de EE.UU./México se
-- ajustan desde el editor de agente.

alter table public.agents
  add column if not exists currency text not null default 'COP';

comment on column public.agents.currency is
  'Moneda ISO-4217 en la que este agente VENDE (COP, USD, MXN). Manda en Órdenes al filtrar por el agente. Distinta de cost_currency, que es la moneda de la pauta.';
