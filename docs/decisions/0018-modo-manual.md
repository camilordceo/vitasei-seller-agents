# ADR-0018: Modo manual — pausar la IA con un flag ortogonal al estado

- **Estado:** Aceptada
- **Fecha:** 2026-07-02
- **Sprint:** post-6 (feature)

## Contexto

Necesitamos que un agente humano pueda tomar una conversación (p. ej. logística
confirmando una compra) sin que la IA responda, pero **sin perder** los mensajes
del cliente: deben seguir viéndose en el dashboard. El handoff automático
(`#orden-lista`/`#humano`) ya apaga el bot, pero es un flujo específico (reasigna
equipo en Callbell + `bot_end`) y no siempre aplica; queremos control manual
explícito y reversible desde el tablero.

## Decisión

Un flag booleano **`conversations.ai_paused`**, ortogonal a `status`.

- **Respuesta:** `runDebouncedReply` salta la generación si `ai_paused` (loguea
  `reply_skipped` reason `manual-mode`). El chequeo va **después** del debounce,
  así pausar durante la ventana ya evita la respuesta.
- **Ingesta:** sin cambios. Ya es independiente del estado, así que los inbound se
  guardan igual y se ven en el dashboard. Los mensajes del agente humano llegan
  como `from: agent/operator` y el webhook ya los descarta (no disparan la IA).
- **Retargets:** al pausar se cancelan los `scheduled`; el worker además revalida
  `ai_paused` (`evaluateRetarget` → cancel `manual-mode`).
- **Tablero:** Server Action `setConversationManual` (service-role, protegida por
  el Basic Auth del dashboard) + botón "Pasar a manual"/"Reactivar IA" y píldora
  "Manual". Loguea `manual_on`/`manual_off`.

## Consecuencias

- **A favor:** cambio mínimo y ortogonal; no toca el handoff ni la ingesta; no
  requiere env nuevas ni cambios en Callbell/OpenAI. Reversible con un clic.
- **En contra / atado a futuro:**
  - No notificamos a Callbell al pausar (no `bot_end`, no reasignación). El agente
    humano escribe desde el inbox de Callbell; si en el futuro se quiere marcar el
    estado del bot en Callbell, se añade aquí.
  - Carrera mínima: pausar en el sub-segundo entre la validación del estado y el
    envío puede dejar salir una última respuesta (inherente al debounce).

## Alternativas consideradas

- **Nuevo valor `manual` en el enum `conversation_status`:** chocaría con la
  lógica que compara `status === 'active'` (respuesta y retargets) y mezclaría dos
  ejes (¿está viva? / ¿la atiende un humano?). Un booleano los mantiene separados.
- **Reusar `handed_off`:** arrastra la semántica de handoff (equipo + `bot_end`) y
  no es lo que queremos para una pausa manual reversible.
- **Ruta API dedicada para el toggle:** quedaría fuera del Basic Auth del
  dashboard; la Server Action hereda esa protección y revalida las vistas.
