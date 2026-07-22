# 0072 — Guardar la config de voz ANTES de sincronizar con Synthflow

- Estado: aceptada
- Fecha: 2026-07-22

## Contexto

`saveVoiceConfig` sincronizaba los extractores con Synthflow **antes** de escribir en
Supabase, para poder persistir en la misma escritura los `action_id` que devuelve su API
(ADR-0062). El costo de ese orden apareció en operación: apagar las llamadas de un agente
—que no tiene absolutamente nada que ver con la API de Synthflow— quedaba secuestrado por
ella. Con 4 extractores son 5 llamadas HTTP (4 `PUT /actions` + `POST /actions/attach`), y
el cliente no tenía timeout: si Synthflow tardaba o se colgaba, la server action se quedaba
esperando hasta que la función serverless moría, la base nunca se escribía y el operador
veía "Guardando…" y luego el checkbox otra vez prendido. El feature quedaba efectivamente
imposible de apagar desde el dashboard, que es justo lo que uno necesita que funcione
cuando algo se está portando mal.

## Decisión

1. **Supabase primero, sincronización después.** La intención del operador se persiste
   siempre; la sincronización pasa a ser mejor esfuerzo posterior. Si los `action_id`
   cambian (extractor nuevo o recreado), se hace un segundo `update` chico solo de
   `voice_extractors`.
2. **Apagar no habla con Synthflow.** La sincronización solo corre si
   `voiceEnabled === true`. Para dejar de llamar no hay nada que negociar con su API.
3. **Timeout de 30s por petición** en el cliente de Synthflow (`AbortSignal.timeout`), con
   un `SynthflowError` legible. Un cuelgue de su lado ya no se lleva puesta la petición
   entera del dashboard.

## Consecuencias

- Apagar las llamadas es instantáneo y no puede fallar por causas externas.
- Ventana breve en la que la fila tiene extractores sin `action_id` mientras se sincroniza.
  Es inofensiva: el `action_id` solo se usa para actualizar en vez de recrear, y quien
  agenda llamadas mira `voice_enabled`, no los extractores.
- Un guardado con Synthflow caído ahora devuelve el aviso amarillo en vez de morir mudo.

## Alternativas consideradas

- **Mantener el orden y meter la sincronización en background (`waitUntil`).** Resolvía el
  bloqueo pero perdía el aviso al operador cuando la sincronización falla, que es
  información que sí quiere ver al guardar.
- **Botón aparte para sincronizar extractores.** Más control, un paso más que recordar;
  contradice que el guardado los sincronice (ADR-0062). Descartada por ahora.
