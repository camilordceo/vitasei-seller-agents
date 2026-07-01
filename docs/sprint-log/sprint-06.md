# Sprint 06 — Dashboard (v1 parcial)

- **Fecha / sesión:** 2026-07-01
- **Estado:** v1 entregada (parcial) — conversaciones + resumen. Resto de S6 pendiente.

## Objetivo
Panel interno para ver conversaciones y resultados. El dueño pidió empezar por lo simple:
**ver conversaciones**, **resultados de ventas** (total ventas + # transacciones) y un
**placeholder de costo de tokens** para empezar a medir. Luego pulir (inventario, imágenes,
etc.).

## Qué se hizo
- **`/dashboard` (Resumen):** 3 KPIs — ventas generadas (`sum(orders.total)`), transacciones
  (# órdenes), costo de tokens estimado (tokens reales desde `events_log` × precio placeholder)
  — + lista de conversaciones recientes (contacto, estado, método, última actividad, preview).
- **`/dashboard/conversations/[id]` (Detalle):** hilo de mensajes estilo WhatsApp (inbound
  izquierda / outbound derecha, imágenes con miniatura) + panel lateral con contacto y orden.
- **Datos:** `lib/dashboard/queries.ts` con el cliente **service-role** en server components
  (la llave nunca llega al browser). `format.ts` para COP/fechas es-CO. Sumas en JS (volumen
  v1 bajo).
- **Medición de tokens:** `generateReply` ahora devuelve `usage`; se loguea en
  `events_log.reply_generated`. El KPI de costo lo suma (precio = placeholder ajustable).
- **Acceso:** Basic Auth vía `middleware.ts` (`DASHBOARD_USER`/`DASHBOARD_PASSWORD`). Si el
  password no está seteado, el panel queda abierto (hay que ponerlo en producción).
- **UI Pro Max:** contraste 4.5:1, focus rings, touch targets, `loading`/`error`, mobile-first,
  íconos SVG (sin emojis).

## Criterio de aceptación
- [x] **Ver conversaciones** (lista + detalle en vivo con `force-dynamic`).
- [x] **Resultados de ventas** (total + # transacciones).
- [x] **Placeholder de costo de tokens** (midiendo tokens reales).
- [x] `typecheck` + `build` en verde.
- [ ] Resto de S6 (doc 06): órdenes, productos/catálogo, métricas, realtime, Supabase Auth.

## Desviaciones del PRD
- Auth: Basic Auth simple en vez de Supabase Auth (el dueño pidió empezar simple). Migrar a
  Supabase Auth queda para el pulido.
- Sin realtime v1: el panel es server-rendered (refrescar para actualizar).

## Pendientes / deuda técnica
- Órdenes (cola de logística), productos/catálogo, panel de métricas.
- Realtime sobre `messages`/`conversations`.
- Precio real de tokens (hoy placeholder) y, si crece el volumen, mover sumas a vistas/RPC.
- Filtros/búsqueda en la lista de conversaciones.

## Archivos principales
- `app/dashboard/{layout,page,loading,error,ui}.tsx`,
  `app/dashboard/conversations/[id]/page.tsx`
- `lib/dashboard/{queries,format}.ts`, `middleware.ts`
- `lib/openai/responses.ts` (usage), `lib/agent/processMessage.ts` (log de usage)
