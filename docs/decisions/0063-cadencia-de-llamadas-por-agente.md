# ADR-0063: Cadencia de llamadas por agente — se clona el modelo de retargets, sin ventana de 24h

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** 8

## Contexto

Las llamadas tienen que ser prendibles, apagables y flexibles por agente: *"prendemos para
Colombia y hacemos 1 llamada a los 10 minutos del primer mensaje"*, o *"3 llamadas: una apenas
llega, otra a 24h y otra a 72h"*.

Eso es, punto por punto, el modelo que ya existe para **retargets** (ADR-0052): N etapas
configurables por agente, agendadas en una tabla, procesadas por un cron con claim atómico.
`POST /v2/calls` de Synthflow **no acepta agendamiento** (la llamada sale de inmediato) y su
scheduler propio ("Workflows") no tiene API documentada para dispararse → el agendamiento tiene
que ser nuestro de todos modos.

## Decisión

Se clona la mecánica de retargets en `voice_calls`, con **cuatro diferencias deliberadas**:

1. **Sin ventana de 24h.** Retargets omite etapas que caen fuera de las 24h de WhatsApp. Una
   llamada telefónica no tiene esa restricción: **la etapa de 72h es válida y se ejecuta.**
   Es la diferencia de fondo entre los dos sistemas y la razón de no reusar la tabla.
2. **Ancla en el primer inbound de la conversación**, no en la última respuesta del bot
   ("a los 10 minutos del primer mensaje").
3. **Fuera de horario se difiere, no se omite.** Se reusa `isAgentActiveNow` (ADR-0033): una
   etapa vencida a las 3am vuelve a `scheduled` y sale cuando abre la operación. Un retarget
   fuera de hora es un WhatsApp inoportuno; una llamada fuera de hora es un cliente molesto.
4. **Filtro por país** (`voice_countries`, prefijos E.164): permite prender la feature solo para
   Colombia aunque el agente atienda varios mercados.

Se mantiene idéntico lo que ya está probado: claim atómico `scheduled → processing`, índice
parcial `unique (conversation_id, stage) where status in ('scheduled','processing')`,
`delay_minutes` guardado en la fila, y cancelación en cascada al convertir.

Además: **`voice_stop_when_answered`** (default ON) cancela las etapas restantes si el cliente
ya contestó — el objetivo es hablar con él, no llamarlo tres veces.

## Consecuencias

**Bueno**
- Reusamos una mecánica ya probada en producción (claim atómico, índice parcial anti-duplicado)
  en vez de inventar un scheduler nuevo para algo que **cuesta plata y suena en un teléfono**.
- El agendamiento vive en nuestra base → se ve, se filtra y se cancela desde el dashboard, cosa
  que un scheduler dentro de Synthflow no permitiría.
- La cadencia es dato, no código: cambiarla es editar el agente.

**Malo / atado**
- Dos tablas con mecánica casi igual (`retargets`, `voice_calls`). Se aceptó la duplicación:
  factorizar un "scheduler genérico" acoplaría dos features con guardas y desenlaces distintos
  (una manda texto, la otra hace una llamada con costo y resultado asíncrono).
- Granularidad limitada por el cron: con `*/5`, "apenas llega" es *dentro de los 5 minutos*.
  Aceptable, y para ventas hasta conveniente: le da tiempo al bot de WhatsApp a responder
  primero. Si se quiere más fino, se baja la cadencia del cron.

## Alternativas consideradas

- **Reusar la tabla `retargets` con un campo `channel`.** Descartada: los estados no coinciden
  (una llamada tiene `no_answer`, `duration_sec`, `recording_url`), y la guarda de 24h de
  retargets tendría que volverse condicional justo en el punto más delicado del código.
- **Usar los Workflows de Synthflow para la cadencia.** Descartada: no hay API documentada para
  iniciarlos, la configuración quedaría fuera del dashboard y no podríamos cancelar ni auditar
  desde nuestro lado.
- **Cron por minuto.** Descartada para v1: multiplica invocaciones por 5 para ganar minutos que
  el negocio no necesita. Se documenta cómo bajarlo si hiciera falta.
