# ADR-0053: Reportes filtrables por agente (join por conversación, filtrado en JS)

- **Estado:** Aceptada
- **Fecha:** 2026-07-15
- **Sprint:** —

## Contexto
La plataforma es multi-agente/multi-marca (ADR-0023, migración 0010): cada agente es
un número/marca con su propio catálogo, canal y equipo. Pero la página de **Reportes**
(`/dashboard/reports`) agregaba TODO junto: ventas, conversión, costo IA y conversión
por producto mezclaban las cifras de todos los agentes. No se podía responder "¿cuánto
vendió / cuánto costó / cuánto convirtió **este** agente?".

El modelo lo permite: solo `conversations` lleva `agent_id`; `orders`, `messages` y
`events_log` cuelgan de una conversación (`conversation_id`). Es decir, el agente de un
hecho se obtiene por su conversación. No hay `agent_id` denormalizado en esas tablas.

## Decisión
Agregar un filtro por agente a Reportes sin tocar el esquema:

1. **UI** — selector `AgentFilter` en la cabecera con **"Todos los agentes"** (default,
   consolidado) + un item por agente. Navega por query string (`?agent=<id>`), igual que
   el picker de Inventario; el server component re-consulta cada reporte acotado. Se
   muestra el agente activo en el subtítulo y en el **resumen copiable**. El selector solo
   aparece si hay más de un agente.

2. **Datos** — cada query de reporte (`getSalesReport`, `getConversionReport`,
   `getAiCostReport`, `getProductConversion`) recibe un `agentId?` opcional. Con agente se
   arma el `Set` de sus `conversation_id` (`getAgentConversationIds`, paginado) y se
   **filtra en JS** cada hecho por pertenencia a ese set. En conversión, el `total`
   histórico de conversaciones se cuenta con `.eq("agent_id", …)` para que numerador y
   denominador cuadren. Sin `agentId` el camino es el de siempre (consolidado), sin costo
   extra.

3. De paso, las lecturas de costo IA (`events_log`) pasan a **paginadas** (`fetchAllRows`).
   Es la tabla que más crece (un evento por respuesta) y antes topaba en las 1000 filas
   por defecto de PostgREST, **subcontando** el costo; el corte por agente exige el total
   real.

## Consecuencias
- El dueño ve ventas/conversión/costo IA/conversión por producto **por agente** o
  consolidados, y comparte el resumen ya rotulado con el agente.
- El costo IA consolidado ahora es **exacto** aunque haya >1000 eventos (antes se quedaba
  corto). Las cifras históricas de costo pueden **subir** respecto a lo que se veía.
- Los eventos de `events_log` **sin** `conversation_id` (no atribuibles) no entran en el
  corte por agente; sí siguen contando en el consolidado.
- El filtrado es en JS sobre datos ya traídos: correcto y simple al volumen v1, pero
  escala con el número de conversaciones/órdenes. Si crece mucho, mover el join
  (`orders ⋈ conversations` por `agent_id`) a una vista/RPC en Postgres.

## Alternativas consideradas
- **Denormalizar `agent_id` en `orders`/`messages`/`events_log`** (migración + backfill +
  escribirlo en cada inserción): filtra en la BD sin join, pero es invasivo, duplica una
  fuente de verdad y hay que mantenerlo sincronizado. Innecesario al volumen actual.
- **Filtrar en PostgREST con embed `!inner`** (`orders?...&conversations.agent_id=eq.…`):
  empuja el filtro a la BD, pero complica la paginación y los patrones resilientes ya
  usados (fallbacks por columnas faltantes), y el nombrado del embed es frágil. El set en
  memoria es más legible y consistente con el resto de `queries.ts` (sumas en JS).
