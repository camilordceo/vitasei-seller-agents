# ADR-0033: Horario por agente con franjas horarias por día

- **Estado:** Aceptada
- **Fecha:** 2026-07-04
- **Sprint:** post-5 (operación)

## Contexto

El horario del agente (ADR-0029) tenía tres piezas en UNIÓN: una **ventana diaria única**
(misma hora todos los días), **días completos** activos (24 h) y **festivos**. No se podía decir
"lunes de 20:00 a 23:00" ni dar horas distintas por día. El dueño pierde ventas en **noches y
fines de semana** por no poder programar franjas específicas (ej. activar solo las noches, o
sábados y domingos a ciertas horas) para apalancar la IA 24/7 donde conviene.

El horario se guarda como `jsonb` en `agents.schedule` y se evalúa con una función PURA
(`isScheduleActiveAt`) que alimenta tanto el gate del backend como el preview del editor.

## Decisión

Reemplazar el modelo por uno **por día de semana**: `AgentSchedule = { days, holidays }` donde
`days` es un array de 7 listas de franjas (`ScheduleWindow[]`), índice `0=Dom … 6=Sáb`. Cada día
tiene sus propias franjas "HH:MM–HH:MM"; una franja que cruza medianoche se expresa con la hora
de fin menor que la de inicio (ej. 20:00–08:00). El agente está activo si el momento cae en
alguna franja del día O es festivo. "Todo el día" se representa con la franja `00:00–24:00`
(`parseTimeToMinutes` acepta `24:00` = 1440 como fin del día).

- **Compatibilidad hacia atrás:** `parseAgentSchedule` detecta el formato LEGACY
  (`window` + `fullWeekdays`) y lo **migra** en memoria al modelo por día (la ventana global se
  aplica a todos los días; los `fullWeekdays` quedan como `00:00–24:00`). No hay migración de
  datos: los `jsonb` viejos se leen y se comportan igual; al re-guardar quedan en el formato nuevo.
- **Fail-safe intacto:** sin ninguna franja ni festivo ⇒ activo siempre (nunca silenciar por
  config incompleta). Con al menos una franja/festivo configurado, un día sin franjas queda apagado.
- **UI:** editor por día (`WeekScheduleEditor`) de lunes a domingo, con "+ Franja", "Todo el día",
  "Copiar a todos" y "Apagar" por día. El preview "activo ahora" usa la misma función pura.

## Consecuencias

- **Bueno:** se pueden programar noches, fines de semana y horas distintas por día — justo lo que
  se necesita para no perder ventas fuera de horario de oficina. La lógica sigue siendo pura y
  client-safe (un solo punto de verdad para backend y editor). Sin cambios de esquema ni migración.
- **Trade-off:** una franja que cruza medianoche se evalúa contra el día en que **empieza** (ej.
  "lunes 20:00–08:00" cubre el lunes de madrugada y el lunes de noche, no el martes de madrugada,
  salvo que el martes también tenga franja). Para "todas las noches" se pone la misma franja en los
  7 días (equivalente a la vieja ventana global). Se documenta en la ayuda del editor.
- **Menor:** una franja a medio editar (hora vacía) se **descarta** al leer (`parseAgentSchedule`),
  así que nunca rompe la evaluación.

## Alternativas consideradas

- **Mantener la ventana global y agregar overrides por día.** Dos modelos conviviendo = evaluación
  ambigua y UI confusa. El modelo por día subsume la ventana global (misma franja en los 7 días).
- **Guardar el horario en tablas relacionales (una fila por franja).** Sobra para el volumen v1;
  el `jsonb` + función pura es suficiente y ya estaba en uso.
- **Migrar los datos existentes en una migración SQL.** Innecesario: la lectura tolerante
  (`parseAgentSchedule`) migra al vuelo y evita tocar producción.
