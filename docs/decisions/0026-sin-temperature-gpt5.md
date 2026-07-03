# ADR-0026: No enviar `temperature` (modelos GPT-5 / o-series lo rechazan)

- **Estado:** Aceptada
- **Fecha:** 2026-07-03
- **Sprint:** —  (fix operativo, migración a gpt-5-mini)

## Contexto
Tras cambiar el modelo del agente a **`gpt-5-mini`**, TODAS las respuestas (nuevas y viejas)
fallaban con:

```
400 Unsupported parameter: 'temperature' is not supported with this model.
```

Los modelos de la familia **GPT-5 / o-series** (razonadores) solo admiten la temperatura por
defecto y devuelven 400 si se pasa una explícita. Nuestra llamada a `responses.create` mandaba
`temperature: agent.temperature`, así que el error tumbaba cada respuesta (`process_error`) y el
bot quedaba mudo para todo el mundo.

## Decisión
**Dejar de enviar `temperature`** a OpenAI. Se quita de `responses.create` (flujo normal +
seguimientos) y del plumbing de `generateReply`. La extracción de orden (`extractOrder`) nunca
lo mandó, así que no cambia. La columna `agents.temperature` y su campo en el dashboard **se
conservan** (para no romper el esquema/UI), pero **ya no se usan** para llamar al modelo.

## Consecuencias
- **Bueno:** desbloquea todas las respuestas con `gpt-5-mini` (y cualquier modelo GPT-5/o-series).
- **Malo:** se pierde el control de temperatura. Es intrínseco al modelo elegido, no una pérdida
  real de capacidad: estos modelos no la exponen. El campo "Temperatura" del dashboard queda
  informativo/inerte (candidato a quitar en una limpieza futura).
- **Si se vuelve a un modelo que sí la soporta** (p.ej. gpt-4o): habría que reintroducir el
  parámetro condicionado al modelo. No se hace ahora para no reintroducir el 400.

## Alternativas consideradas
- **Enviar `temperature` solo si el modelo la soporta (allowlist/heurística por nombre):** más
  frágil (la lista de modelos cambia) y justo el tipo de lógica que reintroduce el fallo. Se
  descarta; si hace falta, se retoma cuando exista un caso real de modelo con temperatura.
- **Fijar `temperature: 1` (el default):** algunos endpoints igual rechazan el parámetro
  explícito aunque sea el default. Omitirlo es lo seguro.
