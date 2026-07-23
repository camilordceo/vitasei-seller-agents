-- ============================================================================
-- Saludo propio y variables fijas por campaña de llamadas
-- 0033_voice_campaign_greeting_variables.sql
-- Ver: docs/29-resultado-de-llamada-y-campanas.md §2.7, ADR-0086
-- ============================================================================
--
-- El assistant abre la llamada con una frase que necesita un dato:
--
--   "Hola, soy Vanessa de Vitasei. Te llamaba porque estabas interesado en
--    {producto}, ¿tienes un minuto?"
--
-- En una llamada que sale de una conversación de WhatsApp, `{producto}` lo pone
-- la conversación. En una campaña **no hay conversación**: es un número frío de
-- un archivo. Hasta ahora la única forma de llenarlo era que el Excel trajera
-- una columna llamada exactamente `producto` — y nada en la pantalla lo decía.
-- Cuando faltaba, la llamada salía igual y la frase quedaba coja.
--
-- Dos columnas, entonces:
--
--   · `greeting`  — el saludo de ESTA campaña (la lista de colágeno no abre
--     igual que la de magnesio). Vacío = el saludo del agente, como antes.
--   · `variables` — valores fijos para todas sus llamadas (`producto=Colágeno`),
--     para no tener que agregarle una columna repetida al archivo.
--
-- Precedencia al llamar: variables de la fila del archivo > variables fijas de
-- la campaña > lo que aporte la conversación. Lo más específico gana.

alter table voice_campaigns
  add column if not exists greeting text,
  add column if not exists variables jsonb;

comment on column voice_campaigns.greeting is
  'Saludo de apertura de esta campaña, con variables entre llaves ({producto}). Se resuelve en nuestro backend antes de llamar y viaja por llamada. NULL = usa el saludo del agente. Ver ADR-0086';
comment on column voice_campaigns.variables is
  'Variables fijas de la campaña ({"producto":"Colágeno"}) para todas sus llamadas. Las columnas del archivo pisan estas: el dato de la persona manda sobre el general.';
