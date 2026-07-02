# 11 — Modo manual (pausar la IA en una conversación)

**PRD (propio).** Permitir que un agente humano tome una conversación: la IA deja
de responder, pero los mensajes del cliente **siguen ingresando y mostrándose en
el dashboard**. Caso típico: el cliente ya compró y logística confirma la entrega
por WhatsApp; no queremos que la IA se meta, pero sí seguir viendo lo que escribe.

## Objetivo y no-objetivos

**Objetivo**
- Un interruptor en el tablero para pasar una conversación a **manual** (y volver
  a **automático**).
- Con la IA en manual: no responde, no agenda ni envía retargets.
- Los inbound del cliente se siguen guardando y viendo en el dashboard (esto ya
  ocurre: la ingesta es independiente del estado).

**No-objetivos (v1)**
- No enviar nada a Callbell al pausar (el agente humano ya escribe desde el inbox
  de Callbell; nuestra IA es la única automatización y se apaga de nuestro lado).
- No tocar el flujo de handoff automático (`#orden-lista`/`#humano`), que es otra
  cosa: reasigna equipo + `bot_end`. Manual es ortogonal y reversible.

## Modelo de datos

`conversations.ai_paused boolean not null default false`.

- Ortogonal a `status` (`active`/`handed_off`/`closed`). Una conversación puede
  estar `active` + `ai_paused = true` (humano al mando, IA en silencio).
- Un `handed_off`/`closed` ya tiene la IA apagada por `status`; `ai_paused` aplica
  sobre todo a conversaciones `active`.

## Cambios de comportamiento

1. **Respuesta (`runDebouncedReply`)**: tras el debounce y cargar el estado, si
   `ai_paused` → no genera; loguea `reply_skipped` (reason `manual-mode`) y sale.
   Como el chequeo ocurre **después** del debounce, pausar durante la ventana de
   ~12s ya evita la respuesta.
2. **Ingesta (`ingestInboundMessage`)**: sin cambios — sigue guardando el inbound
   y marcando el último mensaje. Por eso los mensajes se ven en el dashboard aun
   en manual. (Los mensajes del agente humano llegan como `from: agent/operator`
   y el webhook ya los descarta: no disparan la IA.)
3. **Retargets**: al pausar se cancelan los seguimientos `scheduled` de esa
   conversación. Además el worker revalida `ai_paused` (`evaluateRetarget` →
   cancel `manual-mode`), por si quedara alguno vivo.

## Tablero (dashboard)

- **Detalle de conversación**: botón **Pasar a manual** / **Reactivar IA**
  (Server Action `setConversationManual`) + píldora **Manual** en el encabezado.
- **Listas de conversaciones**: píldora **Manual** cuando `ai_paused`.
- La mutación corre server-side con el cliente service-role y revalida las rutas.
  Queda protegida por el Basic Auth del dashboard (middleware).

## Eventos (`events_log`)

`manual_on` / `manual_off` (auditoría del interruptor) y `reply_skipped`
(reason `manual-mode`) cuando la IA calla por estar en manual.

## Qué hay que aplicar afuera

- **Supabase**: migración `0007_conversation_manual.sql` (agrega `ai_paused`).
- Nada más: no requiere env nuevas ni cambios en Callbell/OpenAI/Vercel.

## Riesgos / notas

- Carrera mínima: si se pausa en el sub-segundo entre que la tarea de respuesta
  ya validó el estado y el envío, una respuesta podría salir igual. Es inherente
  al debounce y aceptable.
- Reactivar (`ai_paused=false`) reanuda la IA en el siguiente inbound; los
  retargets se reagendan con la próxima respuesta del bot.
