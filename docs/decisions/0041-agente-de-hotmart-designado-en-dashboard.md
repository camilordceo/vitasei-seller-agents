# ADR-0041: Agente de Hotmart designado desde el dashboard

- **Estado:** Aceptada
- **Fecha:** 2026-07-09
- **Sprint:** post-MVP (sigue a ADR-0035 / ADR-0040)

## Contexto

Los eventos de Hotmart (carritos abandonados) no traen canal de Callbell (son
pre-conversación), así que no se pueden enrutar por canal como el inbound de
WhatsApp. Hasta ahora el agente que los manejaba se resolvía por la env
`HOTMART_AGENT_ID` o "el primer agente activo". Eso no permite **elegir
cómodamente** un agente nuevo (con su propio teléfono y su cuenta de Callbell)
para Hotmart sin tocar variables de entorno y redeployar.

## Decisión

Agregar una marca **por agente** `agents.hotmart_enabled` (migración 0020) que se
designa desde el dashboard (`/dashboard/hotmart` → selector "Agente de Hotmart").
Es **exclusiva**: al elegir un agente se apaga la marca en los demás. El webhook
resuelve el agente de Hotmart con esta prioridad:

1. Agente marcado (`hotmart_enabled = true`) — autoritativo, editable en el panel.
2. `HOTMART_AGENT_ID` (env) — override legado.
3. Primer agente activo — último recurso (comportamiento previo).

Los envíos usan las credenciales de Callbell de **ese** agente
(`agentCallbellCreds`), y la resolución de plantilla ya prioriza el match por
agente, así que la plantilla debe existir en la cuenta de Callbell del agente
designado (o ser global con un UUID válido en esa cuenta).

## Consecuencias

- **Bueno:** se cambia el agente de Hotmart (a otro teléfono / otra marca) desde el
  panel, sin env ni redeploy. Consistente con `reactivation_enabled` (per-agente).
- **Seguridad de la ruta crítica:** la marca NO se agrega a `AGENT_COLS` (que se
  carga en cada inbound de WhatsApp); se lee en una consulta aparte y resiliente
  (`findHotmartAgentId`). Si falta la columna (migración 0020 sin aplicar) o falla,
  devuelve null y se usa el fallback — el inbound normal jamás se rompe.
- **Limitación (a futuro):** un solo agente de Hotmart a la vez. Si hicieran falta
  varios (p. ej. distintas cuentas de Hotmart por marca), habría que enrutar por
  `product.id` del evento hacia el agente/plantilla — no está en este alcance.
- Requiere aplicar `0020_agent_hotmart_flag.sql` en Supabase.

## Alternativas consideradas

- **Seguir solo con `HOTMART_AGENT_ID` (env):** descartado — cambiar de agente exige
  editar env y redeploy; nada visible ni cómodo en el panel.
- **Poner el control en el editor de Agentes** (toggle por agente): válido, pero el
  selector único en `/dashboard/hotmart` es más discoverable y co-locado con la
  config de Hotmart, y modela mejor "cuál es EL agente de Hotmart".
- **Enrutar por producto** (`product.id` → agente): más flexible, pero excede lo
  pedido (un agente nuevo). Queda anotado como extensión futura.
