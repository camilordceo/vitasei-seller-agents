# ADR-0034: Solicitudes de llamada por `#llamada`

- **Estado:** Aceptada
- **Fecha:** 2026-07-07
- **Sprint:** 6 (continuación — dashboard multi-marca)

## Contexto
Algunos clientes prefieren que los llamen en vez de cerrar todo por chat (dudas complejas, montos
altos, desconfianza). Hasta ahora el agente no tenía forma de capturar esa intención: si el cliente
pedía una llamada, quedaba enterrado en la conversación y nadie lo veía a tiempo. El equipo necesita
una **cola de trabajo** simple ("¿a quién hay que llamar?") y un **aviso inmediato** al dueño, con el
mismo estilo del aviso de venta.

Ya existía toda la maquinaria reutilizable: tags de flujo por línea en el parser (`#orden-lista`,
`#humano`), el patrón de aviso al dueño por WhatsApp (`notifyOwnerOfSale` + `SALES_NOTIFY_PHONE`), y
las secciones del dashboard (Órdenes) como plantilla de "lista + filtros + detalle".

## Decisión
Nuevo tag de flujo **`#llamada`**: cuando el modelo lo emite, el backend crea una **solicitud de
llamada** (`call_requests`) y **avisa al dueño** por WhatsApp. Es una señal **independiente**: NO
fuerza handoff ni apaga el bot (a diferencia de `#orden-lista`/`#humano`) — el bot sigue atendiendo
normal; solo se registra la solicitud.

Piezas:
- **Migración `0012_call_requests.sql`**: tabla `call_requests` (enum `call_request_status` =
  `pending | done | cancelled`), con `conversation_id`, `contact_id`, `agent_id` (marca), `phone` y
  `note`. Índice **parcial único** `where status = 'pending'` → a lo sumo **una solicitud viva por
  conversación** (red anti-duplicados si el modelo repite el tag). RLS: lectura + update para el
  dashboard; el backend inserta con service_role.
- **Parser** (`lib/agent/tags.ts`): `#llamada` se reconoce como tag de flujo y **se quita** del texto
  que ve el cliente (igual que los demás tags).
- **Flujo** (`processMessage.ts`): `createCallRequestAndNotify` — idempotente (si ya hay una
  `pending`, no crea otra ni re-avisa), **best-effort** (un fallo NUNCA rompe la respuesta), loguea
  `call_requested` / `call_request_notification_sent`. El aviso usa `CALLS_NOTIFY_PHONE` (default
  `573103565492`, el mismo del aviso de venta) y sale por el **mismo Callbell del agente**.
- **Dashboard**: sección nueva **Llamadas** (`/dashboard/calls`) con filtros (Todas / Pendientes /
  Llamadas / Descartadas) y acciones **"Marcar llamado"** / **"Descartar"** / **"Reabrir"** (Server
  Action `setCallRequestStatus`). Entrada en el nav. Cada fila enlaza a la conversación para el
  contexto (no se extraen datos con IA — decisión de mantenerlo barato).

## Consecuencias
- **Bueno:** el equipo ve al instante a quién llamar; el dueño recibe un WhatsApp inmediato; reutiliza
  el parser, el patrón de aviso y el layout de secciones ya probados; no agrega costo de IA (no hay
  llamada extra al modelo); multi-marca por `agent_id`.
- **Malo / atado a futuro:**
  - **El modelo debe aprender a emitir `#llamada`**: el prompt vive por agente en la DB
    (`agents.system_prompt`, editable en el dashboard) — hay que **añadir la instrucción del tag ahí**
    (no en código). Mientras no se agregue, la solicitud nunca se dispara.
  - **Caveat de ventana 24h** (igual que el aviso de venta): el WhatsApp al dueño es un mensaje libre;
    WhatsApp solo lo entrega si el dueño escribió al número del negocio en las últimas 24h. Para
    entrega garantizada, migrar a plantilla (`sendTemplate`).
  - Datos "básicos" a propósito: no se captura horario preferido ni motivo estructurado (se ve
    abriendo la conversación). Si se necesita, se puede sumar una extracción con IA después.

## Alternativas consideradas
- **(a) Extraer nombre/horario con IA por cada `#llamada`:** más datos en la solicitud, pero suma una
  llamada al modelo (costo de tokens) por cada pedido. Descartada por ahora (se prefirió lo básico +
  enlace a la conversación).
- **(b) Tratar la llamada como handoff (`#humano`):** apagaría el bot y reasignaría el equipo, que es
  más disruptivo. La solicitud de llamada no requiere frenar la conversación → se dejó independiente.
- **(c) Guardar la solicitud solo como `events_log`:** sin tabla propia no habría cola con estado
  (pendiente/hecha) ni sección accionable en el dashboard. Se prefirió una tabla de primera clase.
