# ADR-0027: Reintento manual de la respuesta de la IA desde el dashboard

- **Estado:** Aceptada
- **Fecha:** 2026-07-03
- **Sprint:** 6 (continuación — dashboard)

## Contexto
Si un error transitorio (OpenAI 4xx/5xx, timeout, fallo de Callbell) tumba la respuesta durante
`runDebouncedReply`, la conversación queda con el mensaje del cliente **sin contestar**: el bot no
reintenta solo (el debounce ya "ganó" y la tarea terminó). El operador veía el mensaje del cliente
en el dashboard pero no tenía forma de **volver a correr el flujo del bot**; solo podía escribir a
mano (ADR-0020), lo que pierde la respuesta con catálogo/`file_search` que el agente habría dado.

## Decisión
- **Reintento = re-correr el MISMO flujo automático**, no uno nuevo. Se agrega
  `regenerateReply(conversationId)` en `lib/agent/processMessage.ts` que reutiliza los helpers
  privados `gatherPendingContent` + `generateAndSend` (el idéntico camino de `runDebouncedReply`),
  pero **sin** el `sleep(REPLY_DEBOUNCE_MS)` ni la guarda de "quién gana": es una acción explícita
  del operador, corre ya.
- **Alcance = mensajes pendientes** (inbound posteriores al último outbound), que es justo lo que
  junta `gatherPendingContent`. En el caso típico —el bot nunca respondió— no hay outbound, así que
  entra todo el hilo. El `previous_response_id` de la conversación aporta el contexto previo.
- **Falla ruidosa (a diferencia de `runDebouncedReply`, que es best-effort/silencioso):**
  `regenerateReply` **lanza** con un mensaje legible en cada caso en que no se puede reintentar
  (conversación inactiva, IA en pausa, contacto sin teléfono, sin mensajes pendientes) para que el
  server action lo propague y el dashboard lo muestre.
- **Server Action `retryReply(conversationId)`** en `app/dashboard/actions.ts`: llama a
  `regenerateReply` y revalida las rutas del dashboard. Corre server-side con service-role,
  protegida por el Basic Auth (como el resto de acciones). No usa `waitUntil`: se **espera** el
  resultado para dar feedback de éxito/error al operador.
- **UI:** botón `RetryButton` (client component, `useTransition`) en el header del detalle, junto al
  `ManualToggle`, con estado "Reintentando…", spinner y mensaje inline. Se **deshabilita** cuando la
  conversación no está activa o la IA está en pausa (con tooltip que explica por qué).
- **Ventana de 24h:** el reintento evalúa la ventana contra el momento actual (`receivedAt =
  Date.now()`), no contra el inbound original: si ya pasaron 24h, el gate no envía (igual que el
  flujo normal).
- **Auditoría:** se loguea `retry_requested` al iniciar; el resto de la telemetría
  (`reply_generated`, `process_error`, etc.) la emite `generateAndSend` sin cambios.
- **Sin migraciones ni envs nuevas.** Reutiliza `messages`/`events_log`/`conversations` y las
  credenciales por agente.

## Consecuencias
- **Bueno:** recupera conversaciones "colgadas" por un error transitorio con un clic, con la
  respuesta rica del agente (catálogo, imágenes, gate); cero duplicación de lógica (mismo camino que
  el flujo automático); consistente con el patrón Server Action + service-role.
- **Malo / atado a futuro:**
  - **Idempotencia de envío:** si el error ocurrió **después** de guardar el outbound pero antes de
    enviarlo a Callbell, ese outbound ya "tapa" los inbound → `gatherPendingContent` no junta nada y
    el reintento avisa "no hay pendientes" en vez de re-enviar. Cubrir ese caso (re-enviar un
    outbound sin `callbell_message_uuid`) queda en backlog.
  - **Doble envío posible** si el operador reintenta mientras una tarea de debounce anterior aún
    corre. Es improbable (el debounce es de 12s y el reintento es manual, tras ver el error), pero
    no hay lock; se acepta por simplicidad (ADR-0007 ya cubre la concurrencia normal).
  - El botón se apaga en pausa/handoff: para reintentar el bot en manual hay que reactivar la IA
    primero (decisión explícita del operador).

## Alternativas consideradas
- **(a) Reutilizar `runDebouncedReply` tal cual desde el dashboard:** arrastra el `sleep(12s)` y la
  guarda de "quién gana"; además es silencioso (no puede reportarle el error al operador). Descartada.
- **(b) "Regenerar" incluso cuando ya hubo respuesta (sobrescribir el último outbound):** es otra
  feature ("regenerar mejor respuesta"), no el caso de error descrito; fuera de alcance.
- **(c) Reintento automático con backoff dentro de `runDebouncedReply`:** útil, pero no cubre fallos
  persistentes ni da control al operador; complementario, se difiere.
