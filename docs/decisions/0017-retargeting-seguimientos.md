# ADR-0017: Retargeting — seguimientos automáticos 1h/8h con Responses

- **Estado:** Aceptada
- **Fecha:** 2026-07-02
- **Sprint:** post-6 (feature)

## Contexto

Muchos clientes escriben, reciben respuesta y se quedan a mitad del embudo sin
volver a responder. Queremos recuperarlos con seguimientos ("retargets") a las
~1h y ~8h de dejar de responder. El mensaje debe ser **dinámico** (no un template
fijo): que la IA retome la conversación con el contexto real, sin revelar que es
un seguimiento automático.

Restricciones del proyecto que condicionan el diseño:
- La respuesta normal corre inline con `waitUntil` (ADR-0012/0013). Un
  `waitUntil` NO sirve para esperar 1–8h: la función serverless muere mucho antes.
- Principio del repo: **menos servicios externos** (se quitó Inngest). Nada de
  colas ni workers dedicados si el propio stack ya lo resuelve.
- Ventana de 24h de WhatsApp: fuera de ella un mensaje libre requiere template
  (fuera de v1).

## Decisión

**Disparo con Vercel Cron (nativo), generación dinámica con Responses encadenado.**

1. **Agendar (`retargets`):** cuando el bot responde y NO es handoff (dentro de
   ventana), se insertan dos filas en `retargets` (etapa 1 ≈ 1h, etapa 2 ≈ 8h),
   con `anchor_inbound_at = last_inbound_at`. Delays configurables por env
   (`RETARGET_STAGE1_MS`/`RETARGET_STAGE2_MS`).
2. **Cancelar:** cuando el cliente responde (ingesta), se cancelan los
   seguimientos `scheduled` de esa conversación. La siguiente respuesta reagenda.
   Cada respuesta del bot también cancela los previos antes de reagendar.
3. **Disparar (`/api/cron/retargets`, cada 5 min):** toma los `scheduled` vencidos
   con un **claim atómico** (`scheduled → processing`, evita doble envío si dos
   ejecuciones se solapan) y por cada uno evalúa guardas (`evaluateRetarget`):
   conversación activa, el cliente no respondió desde que se agendó (el `anchor`
   sigue igual), hay `previous_response_id`, y estamos dentro de la ventana 24h.
4. **Generar + enviar:** **una sola** `responses.create` encadenando
   `previous_response_id` (el modelo ve todo el contexto) con una **instrucción
   interna** que le pide retomar la charla y **NO revelar** que es automático. Se
   reusa el mismo pipeline: parser de tags, gate anti-alucinación de `#ID`, envío
   por Callbell (texto + imágenes) y encadenado del `previous_response_id`.

Los **tags de flujo** (`#orden-lista`/`#humano`/`#addi`/`#cod`) en un seguimiento
se quitan del texto y **no se accionan**: un retarget solo retoma la conversación;
cerrar orden o handoff ocurre en un turno normal cuando el cliente responde.

## Consecuencias

- **A favor:** sin infraestructura nueva (Vercel Cron es parte del stack); sigue
  siendo "IA simple" (1× Responses por seguimiento); reusa gate/sender/parser;
  robusto ante carreras (claim atómico + índice único parcial de "vivos" + ancla).
- **En contra / atado a futuro:**
  - El cron necesita un plan de Vercel que permita ejecuciones frecuentes; con
    granularidad de 5 min un seguimiento puede dispararse hasta ~5 min tarde
    (irrelevante para 1h/8h).
  - No hay reintento propio de un envío fallido (queda `failed` + log). Se puede
    añadir después.
  - Encadenar `previous_response_id` depende de la retención de OpenAI (~30 días);
    a 1–8h no es problema.
  - Fuera de ventana 24h el seguimiento se **salta** (no se envía). Cuando haya
    templates, la etapa fuera de ventana podría usarlos.

## Alternativas consideradas

- **`waitUntil` con sleep largo:** imposible; la función no vive horas.
- **Inngest / cola dedicada:** ya se descartó por el principio de menos servicios
  (ADR-0012). Vercel Cron cubre el caso sin dependencias nuevas.
- **pg_cron + función SQL:** movería la lógica (Responses/Callbell) fuera de la
  app; más difícil de mantener y testear que un route handler en el mismo repo.
- **Template fijo de seguimiento:** descartado por el requisito de mensaje
  dinámico con contexto.
