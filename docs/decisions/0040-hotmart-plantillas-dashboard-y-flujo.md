# ADR-0040: Plantillas de Hotmart editables en el dashboard + marca de flujo

- **Estado:** Aceptada
- **Fecha:** 2026-07-09
- **Sprint:** post-MVP (mejora sobre ADR-0035)

## Contexto

El flujo de carritos abandonados de Hotmart (ADR-0035) funcionaba, pero:

1. La plantilla de Callbell y el texto del mensaje estaban **fijos en env**
   (`HOTMART_ABANDONED_CART_TEMPLATE_UUID`) y **hardcodeados**
   (`[Plantilla Hotmart: …]`). Cambiarlos exigía tocar código/env y redeploy.
2. Cuando el cliente **respondía** a la plantilla, el bot lo atendía como una
   conversación normal: no tenía forma de saber que venía de un **carrito de
   cursos de Hotmart** y ejecutar ese flujo específico.
3. El "rastro" (`conversations.source`) solo se fijaba al **crear** la
   conversación. Si el cliente ya tenía un chat activo de WhatsApp, la plantilla
   se adjuntaba a ese chat pero quedaba marcado como `whatsapp` — se perdía el
   origen Hotmart.

## Decisión

1. **Plantillas en la base, editables desde el dashboard** (como los videos):
   nueva tabla `hotmart_templates` (`agent_id` NULL = global, `event_type`,
   `product_id` opcional, `name`, `template_uuid`, `message_text`, `enabled`) y
   una sección `/dashboard/hotmart` con CRUD. El webhook resuelve la plantilla
   por (agente, evento, producto) con **el match de agente pesando más que el de
   producto** (el `template_uuid` solo existe en la cuenta de Callbell de ese
   agente). La env `HOTMART_ABANDONED_CART_TEMPLATE_UUID` queda como **fallback**
   (retrocompatibilidad). `message_text` soporta `{{nombre}}`/`{{producto}}`.

2. **Marca `Es flujo hotmart`** que se **anexa al texto que ve la IA** (en
   `gatherPendingContent`), NO al mensaje que se guarda. Así el hilo del panel y
   la extracción de la orden quedan limpios, pero el agente identifica el caso y
   ejecuta el flujo de cursos definido en su system prompt. Solo se anexa si el
   turno ya tiene contenido (texto o imagen): nunca fuerza una respuesta vacía.

3. **Rastro autoritativo `conversations.hotmart_flow`** (boolean): se activa al
   adjuntar la plantilla, tanto en conversaciones **nuevas como existentes**. Es
   la compuerta del marcador (punto 2) y se muestra como badge "Hotmart · Cursos"
   en el detalle. Se conserva `source='hotmart'` para analítica de origen.

## Consecuencias

- **Bueno:** el equipo cambia plantilla y texto sin código ni redeploy. La IA
  reconoce a los clientes de Hotmart y puede seguir un guion de cursos. Rastro
  visible y correcto aun si el cliente ya tenía chat de WhatsApp.
- **Atado a futuro:** para que la IA "haga el flujo de cursos" hay que **describir
  ese flujo en el system prompt del agente** (dato, no código): qué hacer cuando
  ve `Es flujo hotmart`. Es un paso manual en `/dashboard/agents`.
- **Malo/limitación:** el texto ENTREGADO por WhatsApp lo define la plantilla
  aprobada en Meta; `message_text` controla lo que se guarda/muestra y el
  `content.text` de respaldo, no el contenido aprobado.
- **Resiliencia a la migración:** todo cae con gracia si falta la migración 0019
  (tabla/columna ausentes) — el webhook usa el fallback por env y las respuestas
  nunca se rompen. Requiere aplicar `0019_hotmart_templates.sql` en Supabase.

## Alternativas consideradas

- **Persistir "Es flujo hotmart" en `messages.content`** (modificar el inbound
  guardado): descartado — ensucia el hilo del panel para el humano y contamina la
  extracción de la orden. Inyectarlo solo en el input de la IA logra el objetivo
  sin efectos colaterales.
- **Reusar `source` como compuerta** en vez de `hotmart_flow`: descartado —
  `source` solo se fija al crear y sobrescribirlo perdería el origen real de una
  conversación que empezó en WhatsApp. Un flag dedicado sirve a nuevas y
  existentes sin ambigüedad.
- **Config por env o `app_settings` (una sola plantilla)**: descartado — el
  pedido era editarlo fácil desde el panel "como los videos" y poder tener
  variantes por marca/curso.
