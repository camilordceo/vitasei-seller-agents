# ADR-0046: Lecturas del dashboard en vivo (desactivar el Data Cache de Next en el service client)

- **Estado:** Aceptada
- **Fecha:** 2026-07-10
- **Sprint:** 6 (reportes/órdenes) — mantenimiento

## Contexto
Una orden creada por el agente (webhook) aparecía en su **detalle**
(`/dashboard/orders/<id>`) pero **no** en la **lista** (`/dashboard/orders`) ni en
**Reportes** (`/dashboard/reports`). Ejemplo real: la orden de "Beatriz"
(`3050fc4e-…`, `pending_handoff`, Addi, creada hoy) existía y se veía en su detalle,
pero el reporte contaba "5 en total" (sin ella), con "Pendiente de handoff: 0" y
"Addi: 0", y no salía en el gráfico de "Órdenes generadas".

Causa: en **Next 14 (App Router)** los `fetch` GET se **cachean por defecto** (Data
Cache). `supabase-js` lee vía `fetch`, así que las consultas con **URL estable**
(lista de órdenes `order=created_at.desc`, agregados de reportes `select …`) se
servían desde ese cache — una foto vieja de antes de que la orden existiera. En
cambio:
- El **detalle** consulta `id=eq.<uuid>`: URL única por orden → nunca fue cache hit → fresca.
- La **conversión** cuenta actividad con `created_at=gte.<ahora-30d>` (timestamp
  rodante, precisión de ms): URL distinta cada render → nunca cachea → por eso el
  reporte SÍ mostraba la actividad de hoy (30 conversaciones) aunque las órdenes
  estuvieran viejas.

`export const dynamic = "force-dynamic"` (ya presente en las páginas) fuerza el
**render** dinámico, pero NO desactiva de forma fiable este Data Cache **por-fetch**
en 14.x. Solo se "arreglaba" de rebote cuando un humano **editaba** una orden, porque
`saveOrder` llama `revalidatePath("/dashboard/orders")` + `"/dashboard/reports"`; el
agente, al crear la orden por webhook, no purga nada. Emparenta con ADR-0045 (los
reportes "seguían bien" porque cuentan por mensajes inbound, de URL rodante).

## Decisión
El **service client** (`lib/supabase/server.ts`) pasa un `global.fetch` que fija
`cache: "no-store"` en toda petición. Así **todas** las lecturas de servidor
(dashboard + webhook) van en vivo a Supabase y ninguna entra al Data Cache de Next.

## Consecuencias
- El dashboard siempre refleja el estado real: una orden creada por el agente aparece
  de inmediato en lista, reportes y gráficos (coherente con la intención de
  `force-dynamic` = "siempre en vivo").
- Cada carga del dashboard pega a Supabase (sin cache). Volumen v1 bajo / uso interno
  → aceptable. Si algún agregado pesa (p. ej. `events_log` del costo IA), se moverá a
  una vista/RPC o a un cache **explícito** con invalidación por evento, no al Data
  Cache implícito.
- El backend del agente también lee en vivo (deseable: responde a mensajes recién
  llegados; evita leer catálogo/estado viejo por el mismo cache).
- No cambia el modelo de escritura: los `insert/update` (POST/PATCH) nunca se
  cacheaban.

## Alternativas consideradas
- **`revalidatePath` desde el webhook** tras crear la orden: arregla solo órdenes, no
  otras lecturas viejas (productos, conversaciones), y acopla el backend a rutas del
  dashboard. Menos robusto que leer en vivo.
- **`export const fetchCache = "force-no-store"` en cada página**: hay que repetirlo y
  recordarlo en cada ruta nueva; se olvida fácil. El fix en el client cubre todo en un
  punto.
- **Subir a Next 15** (donde `fetch` es `no-store` por defecto): cambio mayor, fuera de
  alcance para un fix puntual.
