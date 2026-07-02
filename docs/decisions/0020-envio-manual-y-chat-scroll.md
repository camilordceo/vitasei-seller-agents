# ADR-0020: Envío manual de mensajes desde el dashboard + chat con scroll propio

- **Estado:** Aceptada
- **Fecha:** 2026-07-02
- **Sprint:** 6 (continuación — dashboard)

## Contexto
El detalle de conversación renderizaba todo el hilo en la página, que crecía sin límite (una
"página larguísima"). Además, un operador humano no tenía forma de **responderle al cliente desde
el dashboard**: solo podía pausar la IA (modo manual, ADR-0018) y escribir por fuera (Callbell).
Se necesitaba un compositor para enviar un mensaje libre por WhatsApp con un botón.

## Decisión
- **Chat con scroll propio:** el hilo pasa a un client component `ChatPanel` con **altura fija**
  (`h-[calc(100vh-13rem)]`) y `overflow-y-auto`, con **auto-scroll al fondo** (último mensaje
  visible) al montar y al cambiar el número de mensajes. El compositor queda anclado abajo.
- **Envío manual:** Server Action `sendManualMessage(conversationId, text)` que reutiliza
  `sendText` (Callbell, `POST /v1/messages/send`). Guarda el outbound en `messages`
  (`direction=outbound`, `role=assistant`, `tags=["manual"]` para distinguirlo del bot) con el
  `callbell_message_uuid`, y loguea `manual_message_sent`. Corre server-side con service-role,
  protegida por el Basic Auth del dashboard (como el resto de acciones).
- **Ventana de 24 h:** se calcula desde el último inbound y se **avisa** si ya pasó (WhatsApp puede
  exigir plantilla), pero **se intenta el envío igual**: Callbell es la fuente de verdad y su error
  se muestra en la UI.
- **No alimenta el contexto de la IA:** el mensaje manual **no** entra al encadenamiento
  `previous_response_id`. Es una intervención humana fuera de banda.
- **Sin cambios en Supabase ni envs nuevas:** reutiliza `messages`/`events_log` y `CALLBELL_API_KEY`.

## Consecuencias
- **Bueno:** el operador responde sin salir del panel; hilos largos son usables; auditoría por
  `events_log`; consistente con el patrón Server Action + service-role.
- **Malo / atado a futuro:**
  - El bot **no "ve"** los mensajes manuales (no van al contexto de OpenAI); si luego responde,
    podría ignorar lo que dijo el humano. Mitigación práctica: usar modo manual al intervenir.
  - `role=assistant` para un mensaje humano (el enum no tiene rol "humano"); se distingue por el
    tag `manual`. Cambiar el enum requeriría migración; se difiere.
  - Enviar **no** pausa la IA automáticamente (lo decide el operador con el toggle de modo manual).
  - Fuera de 24 h no hay plantillas en v1 (límite ya conocido, backlog).

## Alternativas consideradas
- **(a) Rol de mensaje `human` (enum nuevo):** más correcto semánticamente, pero pide migración;
  el tag `manual` es suficiente por ahora.
- **(b) Inyectar el mensaje manual en `previous_response_id`:** complejo y arriesgado; fuera de
  alcance de esta iteración.
- **(c) Auto-pausar la IA al enviar manual:** sorpresivo; se deja al `ManualToggle` explícito.
- **(d) Mantener el hilo en el server component con solo un contenedor scrollable:** no permite el
  auto-scroll al fondo ni co-ubicar el compositor con estado; el client component es más limpio.
