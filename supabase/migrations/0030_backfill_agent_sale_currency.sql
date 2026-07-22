-- 0030 — Backfill de la moneda de VENTA de cada mercado. Ver ADR-0079.
--
-- Por qué existe esta migración de DATOS (y no solo de esquema):
-- la 0029 creó `agents.currency` como `not null default 'COP'`, así que los cuatro
-- agentes nacieron diciendo "vendo en pesos colombianos" — incluidos los de México
-- y EE.UU. Como el editor tenía la moneda de la PAUTA en otro bloque del formulario
-- (y su ayuda decía "la de este mercado"), se configuró esa y la de venta quedó en
-- el default. Resultado: Reportes sumaba USD 96 como 96 pesos mientras el ROAS,
-- que leía la otra columna, mostraba una cifra distinta en la MISMA pantalla.
--
-- El mapeo lo decidió el dueño del negocio (no se deduce del nombre: Hotmart MX
-- cobra en dólares aunque su público sea mexicano):
--   Vitasei CO      → COP
--   Vitasei Mexico  → MXN
--   Vitasei USA     → USD
--   Hotmart (MX)    → USD
--
-- Es idempotente y no toca agentes que no estén en la lista. `cost_currency` (la
-- moneda de la pauta) solo se alinea donde NO hay costo por chat configurado: ahí
-- el valor no significa nada y dejarlo desalineado dispararía el aviso de desfase
-- de Reportes sobre un campo que nadie usó.

update public.agents set currency = 'MXN' where name = 'Vitasei Mexico';
update public.agents set currency = 'USD' where name = 'Vitasei USA';
update public.agents set currency = 'USD' where name = 'Hotmart (MX)';
update public.agents set currency = 'COP' where name = 'Vitasei CO';

update public.agents
   set cost_currency = currency
 where cost_per_chat is null
   and cost_currency is distinct from currency;
