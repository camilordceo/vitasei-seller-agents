# ADR-0029: Horario de encendido/apagado por agente (evaluación inline)

- **Estado:** Aceptada
- **Fecha:** 2026-07-03
- **Sprint:** 6 (continuación — dashboard multi-marca)

## Contexto
Se quiere encender la IA en líneas/horarios "muertos" (donde no hay humanos): p. ej. de **8pm a
8am**, **todo el domingo** y **festivos**. Hoy un agente solo tiene `enabled` (on/off manual) sin
noción de horario. Hace falta programar cuándo cada agente responde, y —por decisión del negocio—
que fuera de ese horario se **apague todo** (no responder inbound **ni** enviar seguimientos /
reactivaciones).

## Decisión
- **Evaluación INLINE con función pura, sin cron que prenda/apague.** Se agrega
  `isAgentActiveNow(agent, now)` (puro, client-safe) en `lib/agent/schedule.ts`. Es exacto (no
  depende de la frecuencia del cron), sin carreras, y no toca el `enabled` manual. `enabled` sigue
  siendo el master (`false` ⇒ apagado total); el horario **gatea dentro de** `enabled`.
- **Modelo UNIÓN** (cubre los ejemplos de forma aditiva): activo si el momento cae en la **ventana
  diaria** (una sola, misma hora todos los días; cruza medianoche si `end < start`) **O** el día es
  un **día completo activo** (`fullWeekdays`, ej. domingos) **O** la fecha es un **festivo**
  (`holidays`). Config en la columna `agents.schedule` (jsonb) + `schedule_enabled` +
  `schedule_timezone` (default `America/Bogota`, configurable por agente). Migración 0011.
- **Fail-safe:** `schedule_enabled=false` ⇒ siempre activo (retrocompatible: los agentes existentes
  no cambian de comportamiento). Un `schedule` vacío o una zona horaria inválida ⇒ **activo** (nunca
  silenciar al bot por una configuración incompleta).
- **Tres puntos de gate inline** (decisión del usuario: apagar TODO fuera de horario):
  1. **Respuestas** (`runDebouncedReply`): si el agente está inactivo, el inbound igual se guarda
     (se ve en el dashboard) pero no se genera respuesta; se loguea `reply_skipped {agent-inactive}`.
     `regenerateReply` (reintento manual del operador) **no** se gatea: es acción humana explícita.
  2. **Retargets** (`processRetargetRow`) y **3. Reactivaciones** (`processReactivationRow`): fuera de
     horario se **APLAZAN** (la fila vuelve de `processing` a `scheduled`) para reintentar cuando el
     agente vuelva a estar activo; se loguea `*_deferred {agent-inactive}`. Acotado por la ventana de
     24h (retargets) y `STALE_MS`=3 días (reactivaciones).
- **UI** (`AgentEditor`): fieldset "Horario" con toggle, zona horaria, ventana (`<input type="time">`
  con nota de cruce de medianoche), días completos (checkboxes Dom–Sáb), festivos (textarea + prefill
  "Colombia 2026") y un **preview "activo ahora"** que llama la MISMA función pura del backend.

## Consecuencias
- **Bueno:** exacto y simple (una función pura, sin infra nueva, sin cron adicional); consistente con
  la filosofía del repo (inline, Supabase = fuente de verdad); el preview del dashboard usa el mismo
  código que decide en producción (cero divergencia); retrocompatible.
- **Malo / atado a futuro:**
  - **Ventana diaria ÚNICA** (misma hora todos los días). No hay horas distintas por día de semana
    (p. ej. sábados diferente). Si se necesita, es una extensión del modelo (`window` por día).
  - **Proactivos aplazados vía revert a `scheduled`:** si un agente pasa mucho tiempo inactivo, sus
    filas se reintentan cada 5 min (barato) hasta enviarse o vencer (24h / 3 días). Podrían competir
    por el `limit 50` del sweep si se acumulan muchas; aceptable para el volumen actual.
  - **Festivos manuales por agente** (lista editable con prefill CO-2026). No hay calendario oficial
    automático; el operador mantiene/verifica las fechas.

## Alternativas consideradas
- **(a) Cron que prende/apaga `enabled`:** lo que el usuario mencionó ("cron jobs o lo que sea").
  Descartada: choca con el `enabled` manual (mismo campo), depende de la frecuencia del cron
  (granularidad), y crea carreras entre el flip programado y el manual. La eval inline es exacta y sin
  estado extra.
- **(b) Gatear solo las respuestas inbound (no los proactivos):** más simple, pero el usuario pidió
  explícitamente apagar TODO fuera de horario. Se gatean también retargets y reactivaciones.
- **(c) Cancelar (en vez de aplazar) los proactivos fuera de horario:** perdería nudges válidos; se
  prefiere aplazar para que se envíen cuando el agente vuelve a estar activo.
