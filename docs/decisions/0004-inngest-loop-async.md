# ADR-0004: Procesar mensajes con Inngest (loop async), no inline en el webhook

- **Estado:** Aceptada
- **Fecha:** 2026-06-29
- **Sprint:** diseño (pre-0)

## Contexto
Callbell hace health-checks y espera 200 rápido; si el endpoint tarda, alerta al admin. El
razonamiento con LLM + file_search tarda segundos. No se puede hacer inline en el webhook.

## Decisión
El webhook valida, responde `200 {"status":"ok"}` y encola un evento en **Inngest**. Una función
Inngest corre el loop (SENSE→REASON→PROPOSE→GATE→ACT→LOG) con concurrency por `conversation_id`.

## Consecuencias
- Webhook siempre rápido; el trabajo pesado corre en background con retries.
- Concurrency por conversación evita respuestas pisadas si el cliente manda varios mensajes.
- Encaja con el patrón de loop engineering (Inngest + Supabase) ya conocido.

## Alternativas consideradas
- **Procesar inline:** riesgo de timeouts y alertas de Callbell. Descartado.
- **Cola propia (Supabase + cron):** más plomería; Inngest da retries/concurrency de fábrica.
