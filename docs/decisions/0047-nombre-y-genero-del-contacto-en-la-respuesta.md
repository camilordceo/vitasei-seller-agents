# ADR-0047: Nombre del contacto y trato por género en la respuesta de la IA

- **Estado:** Aceptada
- **Fecha:** 2026-07-10
- **Sprint:** post-MVP

## Contexto

El nombre del cliente ya llega en cada webhook de Callbell
(`payload.contact.name`) y se persiste en `contacts.name` desde el primer
mensaje (`ingestInboundMessage`). Sin embargo, ese dato **no llegaba al modelo**:
la IA generaba la respuesta solo con el texto del turno, así que nunca saludaba
ni trataba al cliente por su nombre, y usaba un género gramatical genérico
(a veces desacertado en un catálogo con muchas clientas mujeres).

Se quería que la IA:
1. respondiera usando el nombre de pila del cliente, y
2. adecuara el género gramatical (femenino/masculino) al cliente.

Restricción del proyecto: mantener la **IA simple** (una sola llamada a Responses
por turno) y **menos servicios externos** (sin librerías de inferencia de género
ni columnas/tablas nuevas).

## Decisión

Anteponer al texto del turno que ve la IA un **bloque de contexto interno** con el
primer nombre del cliente (mismo patrón que la marca `Es flujo hotmart`), NO al
mensaje que se guarda en `messages`. El bloque le pide a la IA dirigirse al
cliente por su nombre cuando sea natural y **deducir el género del propio nombre**
(los nombres de pila en español están fuertemente marcados), con **lenguaje
neutro** como salida ante nombres ambiguos/unisex.

- Módulo puro `lib/agent/contactContext.ts`: `firstName()` (extrae y capitaliza la
  primera secuencia de letras; null si es teléfono/símbolo/emoji o una sola
  inicial) y `prependContactContext()`.
- Se conecta en `generateAndSend` (best-effort: una lectura de `contacts.name`;
  si falla, se genera sin el contexto). Cubre la respuesta automática
  (`runDebouncedReply`) y el reintento manual (`regenerateReply`).
- El `input` **crudo** (sin el contexto) se conserva para `detectProductCategory`,
  que categoriza por palabras clave del cliente.

## Consecuencias

- **Bueno:** la IA saluda/responde por nombre y usa el género correcto sin una
  llamada extra, sin columna nueva y sin migración — el nombre ya estaba en la
  base. Funciona para todos los agentes sin editar su system prompt.
- **Bueno:** el hilo del panel y la extracción de la orden quedan **limpios** (el
  contexto solo vive en el input de la IA, nunca en `messages`).
- **Limitación:** el género es **inferido** por el modelo a partir del nombre. Para
  nombres ambiguos/unisex o perfiles con nombre no-real (apodo, negocio) puede no
  acertar; por eso el bloque exige neutro ante la duda. No hay una fuente de verdad
  editable del género (se puede añadir después una columna si se necesita).
- **Costo:** ~40–60 tokens de input extra por turno (el bloque). Despreciable.
- **Resiliencia:** si la lectura de `contacts.name` falla, la respuesta se genera
  igual sin el contexto (nunca rompe el flujo).

## Alternativas consideradas

- **Inferir el género en código** (librería o diccionario de nombres colombianos):
  descartado — agrega dependencia/infra y datos a mantener para un resultado no
  más fiable que el del modelo con nombres en español. Contra "menos servicios".
- **Columna `gender` en `contacts`** (inferida una vez y/o editable en el
  dashboard): descartado en v1 — exige migración + UI + posiblemente otra llamada
  para inferirla. Queda como evolución si se requiere control manual del trato.
- **Inyectar el nombre solo en el primer turno** y confiar en
  `previous_response_id` para recordarlo: descartado — el `previous_response_id` es
  conveniencia, no estado canónico (se rompe al migrar de cuenta). Inyectar el
  contexto en cada turno es más robusto y evita detectar "el primer turno".
- **Persistir el contexto en `messages.content`**: descartado por el mismo motivo
  que la marca de Hotmart — ensucia el hilo del panel y la extracción de la orden.
