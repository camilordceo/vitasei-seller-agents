# ADR-0058: Mantener nuestro debounce en vez del buffering nativo de Kapso

- **Estado:** Aceptada
- **Fecha:** 2026-07-16
- **Sprint:** post-v1 (multi-proveedor)

## Contexto

ADR-0013 definió el debounce: tras un inbound se espera `REPLY_DEBOUNCE_MS` (12s) y solo
responde la tarea del ÚLTIMO mensaje, juntando la ráfaga en una sola llamada a Responses.
Es lo que evita contestar cinco veces a quien escribe cinco líneas seguidas.

Kapso trae **buffering nativo** por conversación (`buffer_enabled`, `buffer_window_seconds`
1–60, `max_buffer_size`): agrupa los mensajes y entrega un lote. Es, en esencia, lo mismo que
hace `runDebouncedReply`. La tentación de apoyarse en él es real —encaja con el principio de
"menos piezas"— y por eso merece una decisión explícita.

## Decisión

Los webhooks de Kapso se registran con **`buffer_enabled: false`** y el debounce lo sigue
haciendo nuestro backend, igual que en Callbell. Aun así, **el parser tolera lotes**
(`unwrapEvents` maneja las dos formas).

## Consecuencias

- **Un solo comportamiento que entender y depurar.** El debounce es el corazón del flujo; si
  Callbell lo hiciera de una forma y Kapso de otra, cualquier "¿por qué contestó dos veces?"
  tendría dos respuestas posibles según la marca. Se mantiene un solo modelo mental.
- No se gana lo que parecía: aunque Kapso agrupara, su ACK de **10 segundos** obliga igual a
  responder 200 rápido y trabajar en background con `waitUntil`. Lo único que desaparecería es
  la guarda de "¿sigo siendo el último mensaje?", que son unas pocas líneas ya escritas y
  probadas.
- `REPLY_DEBOUNCE_MS` (12s) sigue siendo el único lugar donde se ajusta la espera, para todas
  las marcas. Con el buffering de Kapso habría que ajustarlo en dos sitios y encima con techo
  de 60s.
- **El parser tolera lotes a propósito**, aunque hoy no se usen: la doc de Kapso advierte que
  con el buffering encendido **TODOS** los eventos pasan a llegar en lote, *incluso los de un
  solo mensaje*. Si alguien lo activa desde su dashboard, el webhook no se rompe (solo habría
  doble debounce: el suyo y el nuestro → respuestas más lentas, nunca duplicadas). Hay un test
  que cubre el lote de un solo mensaje.
- Queda como optimización futura si algún día el debounce propio estorba.

## Alternativas consideradas

- **Usar el buffering de Kapso y quitar nuestro debounce para esa línea:** menos código en el
  camino de Kapso, pero dos comportamientos distintos conviviendo y una dependencia del
  proveedor en la pieza más delicada del flujo. Además el `waitUntil` no desaparece.
- **Encender el buffering con una ventana corta (1–2s) ADEMÁS del nuestro:** suma latencia sin
  aportar nada, porque nuestro debounce ya agrupa la ráfaga.
- **Ignorar el formato de lote en el parser:** más simple, pero deja una bomba: basta que
  alguien active el buffering en el dashboard de Kapso para que dejemos de leer TODOS los
  mensajes de ese número, en silencio.
