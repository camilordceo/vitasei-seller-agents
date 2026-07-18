# ADR-0062: Extractores configurables por agente y normalización defensiva de `executed_actions`

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** 8

## Contexto

De cada llamada queremos sacar datos estructurados —producto, dirección, nombre, método de
pago— y que **cada agente** defina los suyos desde el dashboard, con varios agentes operando en
simultáneo.

Synthflow lo llama **Information Extractor**. Su doc dice que se configura solo desde el panel;
en la práctica **sí hay API** (`POST /v2/actions` + `/v2/actions/attach`), verificada creando y
borrando un extractor real.

El punto delicado no es crearlos: es **leer el resultado**. Analizamos **977 objetos
`executed_actions` de llamadas reales** de esta cuenta y la forma documentada no es la forma
real. La doc muestra:

```json
"return_value": { "user email": null }
```

y lo que llega de verdad es:

```json
"return_value": "{\"telefonocelular\": \"387506619\"}"
```

## Decisión

**1) Configuración por agente.** `agents.voice_extractors` es un jsonb
`[{identifier, type, condition, choices[], examples[], actionId}]`. Al guardar, se sincroniza
con Synthflow: crear los nuevos, actualizar los cambiados, adjuntar al assistant del agente y
desadjuntar los quitados. El `action_id` devuelto se persiste en la fila.

**2) Parser defensivo y aislado** (`lib/synthflow/extractors.ts`, puro y testeado), que asume lo
peor en los cuatro frentes que encontramos en datos reales:

- **`return_value` es un string con JSON adentro** → `JSON.parse` envuelto; si falla, se guarda
  el crudo y se sigue. Nunca tumba el cierre de la llamada.
- **Conviven dos prefijos de clave**: `extract_info_<id>` (histórico) e `info_extractor_<id>`
  (el que genera la API hoy — lo confirmamos creando uno). Se aceptan **ambos**.
- **El identifier puede tener espacios** (`info_extractor_nombre y apellido`) → no se deduce del
  nombre de la clave externa; se lee la clave que viene **dentro** de `return_value`.
- **El valor no siempre es escalar**: se observaron `{}`, `null`, string, número, objeto y
  objeto anidado en dos niveles. Se guarda tal cual en `voice_calls.extracted` (jsonb) y solo se
  aplana para mostrar.

**3) El texto del extractor se sanea antes de enviarlo.** Synthflow advierte que pedir JSON o
usar `{} [] <>` puede dejar la llamada colgada en "in progress" para siempre. El dashboard lo
valida y el cliente lo limpia.

## Consecuencias

**Bueno**
- Cada marca define qué extraer sin tocar código ni el panel de Synthflow.
- El parser está aislado y es puro → se testea con los payloads reales que capturamos, sin red.
- Guardar el jsonb crudo significa que un extractor nuevo funciona sin migración: la UI lo
  muestra genérico.

**Malo / atado**
- Guardar un agente ahora puede llamar a la API de Synthflow (crear/adjuntar acciones) → el
  guardado puede fallar por red. Se maneja con error explícito y reintentable, no silencioso.
- Los `action_id` viven en nuestro jsonb: si alguien borra la acción desde el panel de
  Synthflow, queda un id colgado. Se detecta al sincronizar y se recrea.
- Compartimos workspace con otro producto: las acciones que creamos conviven con las 43 que ya
  existen. Por eso se identifican por `identifier` del agente y solo tocamos las nuestras.

## Alternativas consideradas

- **Configurar los extractores solo en el panel de Synthflow.** Descartada: el requisito es que
  se ajusten desde nuestro dashboard, por agente. Además dejaría el `identifier` fuera de
  nuestro control, y es la clave con la que leemos el resultado.
- **Parsear `collected_variables` en vez de `executed_actions`.** Descartada: es otra feature
  (slot filling del Flow Designer). En los datos reales los extractores **nunca** aparecieron
  ahí. Se guarda igual por si acaso, pero no es la fuente.
- **Mapear cada extractor a una columna tipada** (`producto`, `direccion`, …). Descartada:
  cada agente define los suyos; una columna por campo obliga a migrar cada vez que una marca
  quiere extraer algo nuevo.
