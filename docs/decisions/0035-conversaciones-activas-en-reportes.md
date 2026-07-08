# ADR-0035: Conversión por conversaciones ACTIVAS (no por `created_at`)

- **Estado:** Aceptada
- **Fecha:** 2026-07-08
- **Sprint:** 6 (continuación — reportes)

## Contexto
En Reportes, la sección **Conversión** mostraba "Conversaciones · Hoy = 6" un día en que el
equipo había atendido **26** conversaciones. La causa: `getConversionReport` contaba las
conversaciones por su `created_at` (ver ADR-0019 y `docs/12`). Pero la ingesta
(`lib/agent/processMessage.ts`) reutiliza **una sola conversación activa por (contacto, agente)**
entre días: el `created_at` de una conversación es el **primer contacto de siempre** con ese
número, no una marca de actividad. Así, "Hoy" contaba solo los **leads nuevos** del día (las
conversaciones nacidas hoy) y no las conversaciones **reales** que se atendieron (clientes que
escribieron hoy, aunque su conversación exista desde hace días).

Al mismo tiempo, `getConversionReport` y `getSalesReport` hacían `select(...)` sin paginar. PostgREST
devuelve **máximo 1000 filas** por request: cuando `conversations`/`orders`/`messages` superan ese
tope, la agregación en JS **subcuenta en silencio** (y sin `.order()` el recorte es arbitrario).

## Decisión
- **Contar por actividad, no por creación.** En las ventanas por tiempo (hoy / 7 / 30 días) y en el
  gráfico por día, "Conversaciones" = conversaciones **distintas** que tuvieron al menos un mensaje
  **inbound** (el cliente escribió) en ese periodo. Fuente: tabla `messages` (`direction = inbound`),
  últimos 30 días. Una conversación activa varios días cuenta en cada día, pero **una sola vez por
  ventana** (dedup por `conversation_id`).
- **`total` sigue siendo histórico**: todas las conversaciones vs. las que convirtieron (orden no
  cancelada). Se inyecta como cifra aparte (count exacto) para no traer todo el historial de mensajes.
- **Transacciones** = de las conversaciones activas en el periodo, cuántas tienen una orden no
  cancelada. La tasa queda ≤ 100 %.
- **Nueva función pura** `summarizeConversationActivity` (reemplaza `summarizeConversion`), testeada.
- **Paginación** (`fetchAllRows`, páginas de 1000) en `getConversionReport` (órdenes + inbound) y
  `getSalesReport` (órdenes), para no subcontar al pasar de 1000 filas.

## Consecuencias
- **Bueno:** el número refleja lo que el equipo percibe (26, no 6); la tasa de conversión se vuelve
  honesta (denominador = conversaciones atendidas); los reportes dejan de subcontar al crecer el
  volumen. Lógica de agregación pura y testeada.
- **Malo / atado a futuro:**
  - La actividad se lee de `messages` (más filas que `conversations`); a volumen v1 es aceptable con
    paginación, pero si crece hay que mover la agregación a una **vista/RPC** en Postgres.
  - Las ventanas por tiempo miran solo los **últimos 30 días** (suficiente para hoy/7/30 y el gráfico
    de 14 días); "Total" cubre el histórico por separado.
  - Se pierde de la vista el conteo de **leads nuevos** (conversaciones creadas hoy). Es una métrica
    útil aparte; queda como mejora futura (mostrar "nuevas" junto a "activas"), no se implementa aquí
    para acotar el cambio.

## Alternativas consideradas
- **(a) Usar `conversations.last_inbound_at`** en vez de `messages`: más barato, pero solo refleja la
  actividad **más reciente** (una conversación activa hoy y ayer solo aparecería en hoy) → inservible
  para un gráfico histórico por día. Descartada.
- **(b) Mostrar ambas métricas** (nuevas + activas) ya: más informativo, pero más superficie de UI y
  no era lo que faltaba para corregir el síntoma. Se deja como follow-up.
- **(c) Reescribir a vistas/RPC en Postgres**: prematuro al volumen actual; se hará si el volumen lo
  pide (mismo criterio que ADR-0019).
