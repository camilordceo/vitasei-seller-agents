# ADR-0005: Validación y parsing defensivo del webhook de Callbell

- **Estado:** Aceptada
- **Fecha:** 2026-06-28
- **Sprint:** 1

## Contexto
El endpoint `POST /api/webhooks/callbell` recibe el evento `message_created`. Dos
incógnitas al momento de construirlo:

1. **Mecanismo de firma:** la doc de Callbell (`04-integracion-callbell.md`) deja como
   TODO confirmar el mecanismo exacto de firma; solo asume un secret compartido por
   header/query. Endurecer la firma está planificado para el Sprint 7.
2. **Shape exacto del payload:** los nombres de campo de `message_created` (cómo viene
   el teléfono, cómo se distingue inbound de outbound, dónde va el `uuid`) no están
   confirmados contra un webhook real.

Además, Callbell hace health-checks y exige **siempre** un `200 {"status":"ok"}`; si el
endpoint no responde ~10 min, alerta al admin. No podemos romper ante un payload raro.

## Decisión
- **Secret opcional en dev, exigido en prod:** si `CALLBELL_WEBHOOK_SECRET` está
  configurado, se valida (header `x-callbell-secret` o `?secret=`); si no coincide,
  respondemos `200 {"status":"ok"}` igual (no filtrar información). Si la variable NO
  está configurada (dev local), no se bloquea.
- **Parsing defensivo:** tipos con campos opcionales y fallbacks (`lib/callbell/types.ts`).
  Un mensaje se considera *outbound* solo si `from` lo indica explícitamente
  (`user/operator/bot/...`); ante la duda se trata como inbound para no descartar
  mensajes reales del cliente.
- **Log del payload crudo:** `events_log.webhook_received` guarda el body completo de
  Callbell. El primer mensaje real revela el shape verdadero para refinar el parser.
- **Cualquier error de parseo o ping sin JSON** → `200 ok` sin encolar.

## Consecuencias
- El webhook nunca tumba a Callbell ni filtra info ante secret inválido.
- Tenemos trazabilidad para confirmar el shape real sin desplegar cambios de código.
- **Deuda:** endurecer la firma (HMAC si Callbell lo soporta) y ajustar el parser con el
  payload real quedan para el Sprint 1 (cierre con mensaje real) / Sprint 7 (hardening).
- Riesgo acotado: un payload outbound con `from` inesperado podría colarse como inbound;
  el gate y la idempotencia posteriores lo contienen, y el log permite detectarlo.

## Alternativas consideradas
- **Tipado estricto del payload:** descartado — sin un webhook real confirmado, un campo
  inesperado rompería el endpoint (y dispararía la alerta de Callbell).
- **Rechazar (4xx) ante secret inválido o payload raro:** descartado — Callbell espera
  `200` siempre; un 4xx genera ruido/alertas y filtra que el endpoint existe.
