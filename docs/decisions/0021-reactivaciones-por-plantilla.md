# ADR-0021: Reactivaciones por plantilla (7/15 días), apagables desde el dashboard

- **Estado:** Aceptada
- **Fecha:** 2026-07-02
- **Sprint:** 6 (continuación — crecimiento/conversión)

## Contexto
Muchos clientes escriben, no compran ese día y se enfrían. Reengancharlos por WhatsApp fuera de la
ventana de 24h **solo se puede con plantillas aprobadas** (costo bajo, ≈ US$0,015 c/u). Se quiere:
programar automáticamente al primer contacto dos envíos de plantilla (7 y 15 días), cancelarlos si
la persona compra, **poder apagar todo el feature** (aún sin aprobación del dueño), **cambiar el
UUID de plantilla** fácil, y **contabilizar costo**. Es distinto de los retargets 1h/8h (ADR-0017):
esos son mensajes DINÁMICOS dentro de 24h; estos son PLANTILLAS fuera de 24h, anclados al primer
contacto y cancelados por conversión (no por respuesta del cliente).

## Decisión
- **Mecanismo separado** de los retargets: nueva tabla **`reactivations`** (reusa el enum
  `retarget_status`, mismo patrón: `scheduled_at`, claim atómico `scheduled→processing`, índice
  único parcial de "vivos"). No se mezcla con `retargets` para no tocar el flujo ya aprobado.
- **Config en DB, editable desde el dashboard:** tabla **`app_settings`** (fila única) con
  `reactivation_enabled` (**OFF por defecto**), `reactivation_template_7d`, `reactivation_template_15d`.
  Server Action `updateReactivationSettings`. El ON/OFF y los UUID **no** son env (deben cambiarse
  sin re-deploy).
- **Programar al primer contacto:** en `ingestInboundMessage`, al crear una **conversación nueva**,
  si el feature está ON, se agendan las dos etapas (7d/15d, delays por env). Best-effort.
- **Cancelar al comprar:** cuando se crea una orden (`#orden-lista`) se cancelan las reactivaciones
  pendientes de esa conversación. Además, guarda en el send-time: `evaluateReactivation` cancela si
  hay orden no cancelada, y salta si no hay plantilla, si el cliente escribió hace < 24h (activo) o
  si venció hace > 3 días (p. ej. tras un apagón).
- **Envío por plantilla:** `sendTemplate` (Callbell `POST /messages/send` con `template_uuid`,
  `optin_contact:true`, `content.text`). El cron existente (`/api/cron/retargets`, cada 5 min)
  procesa retargets **y** reactivaciones (`Promise.allSettled`, independientes). No se agrega cron.
- **Costo:** constante `REACTIVATION_COST_USD = 0.015`; se guarda `cost_usd` por fila al enviar y se
  totaliza en el dashboard (sección Retargets → Reactivaciones).

## Consecuencias
- **Bueno:** feature aislado y **apagable** sin re-deploy; no toca los retargets aprobados; reusa
  cron, claim atómico y patrones existentes; costo medible por fila; lógica pura testeada (7 tests).
- **Malo / atado a futuro:**
  - La(s) plantilla(s) deben crearse y **aprobarse en Callbell/Meta** y pegar su UUID (paso manual).
  - `content.text`/`template_values`: se envía el nombre del contacto como texto; si la plantilla
    tiene otras variables hay que mapearlas (hoy no). **Requiere una prueba real** al encender.
  - Se programa por **conversación nueva** (un cliente que vuelve en otra conversación reinicia el
    ciclo); aceptable para reengagement.
  - Si el feature estuvo apagado mucho tiempo, las filas viejas se **saltan** (`stale`) en vez de
    dispararse en masa al reencender.
  - El costo (US$0,015) es un supuesto configurable en código, no el cobro real de Meta.

## Alternativas consideradas
- **(a) Extender `retargets` con una columna `kind`:** menos tablas, pero mezcla dos flujos con
  disparadores, cancelación y envío distintos, y ensucia el feature ya aprobado. Descartada.
- **(b) ON/OFF por env (`REACTIVATION_ENABLED`):** no cumple "apagable desde el dashboard sin
  re-deploy". Se dejó en DB (`app_settings`); las env solo ajustan los delays.
- **(c) Cron nuevo dedicado:** innecesario; el de 5 min alcanza para timing de días. Evita tocar
  `vercel.json` y el límite de crons.
- **(d) Anclar al primer contacto del CONTACTO (no de la conversación):** más difícil de razonar;
  por conversación es más simple y reengancha bien.
