# ADR-0054: Conversaciones filtrables por agente

- **Estado:** Aceptada
- **Fecha:** 2026-07-15
- **Sprint:** post-v1 (multi-agente)

## Contexto
Con multi-agente/multi-marca (migración 0010, `conversations.agent_id`), la lista de
`/dashboard/conversations` mezclaba las conversaciones de todas las marcas sin forma de
acotarlas. Reportes ya resolvió el mismo problema con un selector de agente (ADR-0053).
La lista de conversaciones ya usa filtros por URL (fecha, pedido, estado, orden) y
paginación que preservan sus parámetros entre navegaciones.

## Decisión
Agregar un selector **"Todos los agentes" / por agente** a la cabecera de filtros de
Conversaciones, coherente con Reportes. `getRecentConversations` recibe un `agentId?`
opcional y aplica `.eq("agent_id", agentId)` directo sobre `conversations` (a diferencia
de Reportes, aquí la tabla base ya lleva `agent_id`, así que no hace falta el `Set` de
`conversation_id`). El agente viaja en `?agent=<id>` y se **preserva** al cambiar los demás
filtros y al paginar; cambiar de agente vuelve a la página 1. El selector solo aparece si
hay más de un agente. Sin migración.

## Consecuencias
- Filtrado por marca sin costo adicional de consulta (un `eq` sobre columna existente).
- `?agent=` se suma a las dimensiones ya preservadas en los hrefs y en la paginación;
  "Limpiar filtros" también limpia el agente (vuelve al consolidado).
- Ids de agente inexistentes en `?agent=` se ignoran (cae a "todos"), como en Reportes.
- El componente `AgentFilter` de Conversaciones es propio (no el de Reportes) porque debe
  **conservar** los otros filtros activos al navegar, no resetear la ruta.

## Alternativas consideradas
- **Reusar el `AgentFilter` de Reportes:** descartado; ese resetea a `/dashboard/reports?agent=`
  y perdería fecha/pedido/estado/orden de la lista.
- **Pills por agente (como los demás filtros):** un `<select>` escala mejor cuando crece el
  número de marcas y es consistente con el selector ya conocido de Reportes.
