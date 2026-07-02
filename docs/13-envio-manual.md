# 13 — Envío manual de mensajes + chat con scroll

Continuación del Sprint 6 (dashboard). Ver **ADR-0020**.

## Chat con scroll propio
El detalle de conversación (`/dashboard/conversations/[id]`) ya no crece sin límite: el hilo vive
en un panel de **altura fija con scroll interno** (`ChatPanel`, client component) que hace
**auto-scroll al último mensaje**. El compositor queda anclado abajo.

## Enviar un mensaje al cliente
En el detalle de conversación, abajo del hilo, hay un **compositor**:
- Escribe el texto y presiona **Enviar** (o **Enter**; **Shift+Enter** hace salto de línea).
- Sale por WhatsApp usando la API de **Callbell** (`sendText`).
- El mensaje queda en el hilo marcado **Manual** (para distinguirlo del bot) y se registra
  `manual_message_sent` en `events_log`.

### Ventana de 24 h
WhatsApp solo permite texto libre dentro de las **24 h** desde el último mensaje del cliente. Si ya
pasó, el compositor **avisa** (arriba, en ámbar) pero deja intentar el envío; si Callbell lo
rechaza, el error se muestra en la UI. Fuera de 24 h con plantillas es backlog (ver `docs/07`).

### Notas
- El mensaje manual **no** entra al contexto de la IA (`previous_response_id`): es una intervención
  humana fuera de banda. Si vas a conversar tú, usa **modo manual** (pausa la IA; ver `docs/11`).
- Enviar **no** pausa la IA por sí solo: usa el botón **Pasar a manual** si quieres silenciar el bot.

## Cómo funciona (técnico)
Server Action `sendManualMessage(conversationId, text)` (`app/dashboard/actions.ts`): carga el
teléfono del contacto, llama a `sendText` (Callbell), guarda el outbound
(`direction=outbound`, `role=assistant`, `tags=["manual"]`, `callbell_message_uuid`) y revalida las
rutas. Service-role, protegida por el Basic Auth del dashboard.

## Supabase
**Nada que aplicar**: reutiliza `messages` y `events_log`; usa la env existente `CALLBELL_API_KEY`.
