# ADR-0045: Orden de la lista de conversaciones por actividad (inbound/outbound)

- **Estado:** Aceptada
- **Fecha:** 2026-07-10
- **Sprint:** 6

## Contexto

La lista de `/dashboard/conversations` (y las 8 recientes de la home) ordenaba por
`conversations.updated_at`. Ese campo **no lo escribe la aplicación**: lo pone el trigger de BD
`set_updated_at` en cada UPDATE. Cuando ese trigger queda desalineado (p. ej. al recrear el
esquema), una conversación de un **cliente recurrente** —que la ingesta reutiliza entre días—
conserva el `updated_at` de su creación y **no sube** en la lista aunque el cliente acabe de
escribir. Resultado: las conversaciones activas de hoy no aparecían, mientras los reportes seguían
bien (cuentan por mensajes inbound, no por `updated_at`) y el bot seguía respondiendo.

Además, se pidió poder **ver la lista de dos maneras** según el caso: por el último mensaje del
**cliente** (a quién atender) o por la **última respuesta** nuestra (a quién le escribimos de
últimas / seguimiento).

## Decisión

1. Ordenar por la **actividad real**, no por `updated_at`:
   - `last_inbound_at` (la ingesta lo fija explícitamente en **cada** inbound), y
   - `last_outbound_at` (nuevo), el momento del último mensaje **saliente**.
   `updated_at` e `id` quedan solo como desempate estable para la paginación.
2. `last_outbound_at` lo mantiene un **trigger sobre `messages`**
   (`trg_messages_bump_last_outbound`), no el código: cubre los ~8 caminos de envío (respuesta,
   imágenes, retarget, reactivación, video, hotmart, envío manual) sin tocar cada `insert`. Mismo
   patrón que `set_updated_at`. Migración `0023` (columna + backfill + índice + trigger).
3. La UI expone un toggle **"Orden: Último del cliente / Última respuesta"** (`?sort=inbound|outbound`,
   default `inbound`). El filtro de fecha y la hora mostrada siguen la misma clave.
4. El código es **resiliente** a que falte la migración 0023: si la columna no existe (42703),
   reintenta sin ella y ordena por `last_inbound_at`, para no romper el dashboard entre el deploy y
   la migración.

## Consecuencias

- La lista vuelve a reflejar lo más reciente aunque el trigger de `updated_at` esté caído, porque
  `last_inbound_at`/`last_outbound_at` no dependen de él.
- Un timestamp extra por conversación, mantenido por trigger (una escritura barata por outbound;
  ya escribíamos la fila del mensaje de todos modos).
- Las conversaciones creadas a mano (sin inbound/outbound) quedan al final (NULLS LAST) en su
  dirección; es lo esperado.
- Mantener `updated_at` con su trigger sigue siendo recomendable (lo usan otras vistas), pero ya
  **no** es crítico para que la lista funcione.

## Alternativas consideradas

- **Mantener `last_outbound_at` desde el código** en cada punto de envío: frágil (8 lugares, fácil
  olvidar uno) → se descartó a favor del trigger único.
- **Derivar el "último outbound" en JS** cruzando `messages` en cada carga: obliga a traer todo
  para ordenar/paginar bien; no escala y complica la paginación por `range()`.
- **Seguir ordenando por `updated_at`** y solo arreglar el trigger en la BD: no da el toggle
  inbound/outbound pedido y deja la lista atada a un trigger que ya falló una vez.
