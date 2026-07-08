# 17 — PRD: Conversaciones "activas" en Reportes (fix del gráfico de conversión)

Corrige el gráfico y las cifras de **Conversión** en Reportes, que mostraban muchas menos
conversaciones de las reales (p. ej. **6 en vez de 26** en un día). Ver **ADR-0035**.

## Problema (síntoma)
En `/dashboard/reports`, sección **Conversión**, "Conversaciones · Hoy" mostró **6** un día con
**26** conversaciones atendidas. El gráfico por día (conversaciones vs. transacciones) quedaba
igual de bajo. El equipo no puede confiar en la tasa de conversión si el denominador está mal.

## Investigación (causa raíz)
1. **Se contaba por `created_at` de la conversación, no por actividad.**
   `getConversionReport` (`lib/dashboard/queries.ts`) agregaba las conversaciones por su fecha de
   creación. Pero la ingesta (`lib/agent/processMessage.ts`) mantiene **una sola conversación
   activa por (contacto, agente)** y la **reutiliza entre días**: el `created_at` es el primer
   contacto de siempre con ese número. Resultado: "Hoy" contaba solo los **leads nuevos** del día,
   no las conversaciones **reales** atendidas (clientes que ya existían y volvieron a escribir).
   - Evidencia: simulación con 26 conversaciones activas hoy (6 nuevas + 20 recurrentes) →
     el conteo viejo da **6**, el nuevo da **26**.

2. **Riesgo latente: tope de 1000 filas de PostgREST.**
   `getConversionReport` y `getSalesReport` hacían `select(...)` sin paginar. Al pasar de 1000
   filas en `conversations`/`orders`/`messages`, la suma en JS **subcuenta en silencio**. No era la
   causa del 6-vs-26 (comprobado por la lógica), pero habría corrompido los reportes al crecer.

### Descartado / cuestionado
- **Zona horaria:** `bogotaDayKey` convierte bien a `America/Bogota` (UTC-5); no era el problema.
- **`created_at` sin default:** la columna tiene `default now()`; siempre se puebla.
- **Callbell cuenta distinto:** el "26" del equipo = clientes que escribieron hoy = actividad
  inbound. Es justo lo que ahora medimos.

## Solución
- **Conversaciones por actividad:** en hoy / 7 / 30 días y en el gráfico por día, "Conversaciones" =
  conversaciones **distintas** con al menos un **inbound** (mensaje del cliente) en el periodo.
  Fuente: `messages` (`direction = inbound`), últimos 30 días. Dedup por `conversation_id`
  (una conversación activa varios días cuenta una vez por ventana, pero aparece en cada día).
- **Transacciones por fecha de orden:** órdenes **no canceladas** contadas por su `created_at` —
  la **misma fuente** que "Órdenes generadas por día" (`summarizeOrders`), para que ambos cuadros
  coincidan. Antes se contaban por la actividad de la conversación, así que una compra vieja aparecía
  como transacción "hoy" si el cliente volvía a escribir. Tasa = transacciones / conversaciones.
- **Total** = histórico (todas las conversaciones vs. todas las órdenes no canceladas); no cambia.
- **Paginación** (`fetchAllRows`, páginas de 1000) en las consultas de reportes.
- **UI:** el subtítulo aclara qué es cada barra y que Total es histórico.

### Segundo ajuste (transacciones)
En la primera versión las transacciones se contaban por la conversación que convirtió y se
atribuían al día de **actividad** de la conversación → una compra del 4 jul aparecía como "1 hoy"
si el cliente volvía a escribir, sin cuadrar con el cuadro de órdenes. Se corrigió a **órdenes no
canceladas por `orders.created_at`** (misma base que "Órdenes generadas"). Ver ADR-0035.

## Archivos
- `lib/dashboard/report.ts` — nueva función pura `summarizeConversationActivity` (reemplaza
  `summarizeConversion`).
- `lib/dashboard/queries.ts` — `getConversionReport` (actividad + paginado), `getSalesReport`
  (paginado), helper `fetchAllRows`.
- `lib/dashboard/report.test.ts` — tests de la nueva función (dedup por ventana, actividad
  multi-día, conversión, total histórico).
- `app/dashboard/reports/page.tsx` — texto aclaratorio.
- `docs/12-ordenes-y-reportes.md`, `docs/decisions/0035-...md`, `CHANGELOG.md`.

## Criterio de aceptación
- En un día con N conversaciones atendidas, "Conversaciones · Hoy" muestra **N** (no solo los leads
  nuevos). Verificado con simulación (26 → 26) y 15 tests de la función pura (138 en total, verdes).
- `typecheck` y `test` en verde.

## Qué NO hace (v1)
- No agrega un contador separado de **leads nuevos** (conversaciones creadas hoy). Es una mejora
  útil y barata, pero se deja como follow-up para acotar el cambio (ver ADR-0035, alternativa b).
- No mueve la agregación a vistas/RPC en Postgres (se hará si el volumen lo pide).
