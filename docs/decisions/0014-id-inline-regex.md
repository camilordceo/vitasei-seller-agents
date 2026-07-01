# ADR-0014: `#ID` inline por regex (token completo como SKU)

- **Estado:** Aceptada
- **Fecha:** 2026-07-01
- **Sprint:** post-S5 (ajustes v1.1 — ver docs/09)

## Contexto
El diseño v1 (docs/03, ADR-0002) asumía tags `#ID:<sku>` en **su propia línea**, con SKUs
tipo `VITA-001`. Pero el catálogo real de Vitasei usa IDs tipo `#ID7948237144230` (columna
`ID` del CSV) y el flujo que ya operaba en **Bubble** hacía un **regex** sobre la respuesta de
la IA buscando esos `#ID` **inline** (no en línea propia, no con dos puntos). El formato v1 no
matchea los datos reales ni el comportamiento probado en producción.

## Decisión
El agente escribe el `#ID` del catálogo **inline** en el mensaje (formato `#ID` + dígitos). El
backend (`lib/agent/tags.ts` → `parseReply`):
- extrae los `#ID` con `/#ID\d+/g` en **cualquier parte** del texto, dedup y en orden;
- el **SKU es el token COMPLETO** (incluye el prefijo `#ID`) → misma clave en `products.sku`
  y en el catálogo del vector store;
- **quita** los `#ID` del `cleanText` (con el espacio previo, para no dejar dobles espacios).

Los tags de **flujo** (`#addi`, `#compra-contra-entrega`, `#orden-lista`, `#humano`) siguen
siendo de **línea propia**. El prompt se actualiza a este formato en la migración `0005`.

## Consecuencias
- Fidelidad total al CSV y al regex que ya funcionaba en Bubble: cero transformación del SKU.
- El gate (`lib/agent/gate.ts`) no cambia: es agnóstico al formato (compara strings contra
  `products.sku`).
- `messages.tags` de las imágenes guarda `[sku]` (el sku ya trae `#ID`), no `#ID:${sku}`.
- Se rompe compatibilidad con el formato viejo `#ID:VITA-001`: quien lo emita ya no genera
  imagen. Aceptable — nadie está en producción con ese formato y el prompt se migra.
- Riesgo bajo de falso positivo: `#ID` sin dígitos (`#ID`) o `#` sueltos no matchean.

## Alternativas consideradas
- **Mantener `#ID:<sku>` en línea propia:** más "limpio" de parsear, pero no matchea los datos
  reales ni el comportamiento de Bubble; obligaría a re-etiquetar todo el catálogo.
- **SKU = solo los dígitos (`7948237144230`):** requiere reconstruir el `#ID` al mostrar y
  transformar en la carga; más superficie de error. Preferimos el token completo (cero
  transformación).
