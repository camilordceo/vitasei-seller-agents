# ADR-0050: Videos por mercado (país) con precedencia sobre el global

- **Estado:** Aceptada
- **Fecha:** 2026-07-14
- **Sprint:** post-5 (mejora continua)

## Contexto
Al abrir líneas nuevas (magnesio, colágeno) en varios países, el mismo video **no** sirve para
todos: cambian el idioma/acento del locutor, los precios y la moneda que se muestran, las
promesas de envío y los avisos legales. El video de magnesio de Colombia no puede salir en
México ni en EE.UU.

La tabla `videos` (migración 0016) ya tenía `agent_id` (NULL = global) y el backend
(`loadKeywordVideos`) ya cargaba **los del agente + los globales**, pero:

1. El dashboard **siempre** creaba los videos como globales: no había forma de decir "este es el
   de Colombia" sin tocar la BD.
2. `matchVideos` devuelve **todas** las reglas que calzan. Si existía un video global "magnesio"
   y uno de Colombia con la misma palabra —que es exactamente lo que pasa cuando se regionaliza
   un video que ya estaba— el cliente colombiano recibía **los dos**: el suyo y el de otro país.
   El índice único de la BD es por `(lower(keyword), coalesce(agent_id, ...))`, así que permite
   (y debe permitir) que la misma palabra exista en global y en cada mercado.

## Decisión
El **mercado es el agente** (cada agente ya tiene su `country`), y por cada palabra clave se envía
**un solo** video, con precedencia **mercado > global**:

- **Dashboard**: el alta y la edición de un video piden el **mercado** en un `<select>` con los
  agentes **agrupados por país** (más la opción *Global*). La lista muestra el badge del mercado y
  permite filtrar por él.
- **Backend**: `loadKeywordVideos` sigue cargando los videos del agente de la conversación + los
  globales, y ahora aplica `resolveRulesForAgent` (puro, en `lib/agent/videoMatch.ts`): deduplica
  por palabra **normalizada** (case/acento-insensible) quedándose con la regla del agente si
  existe; si no, con la global. Los videos de **otro** agente nunca se cargan.

Se elige el **agente** y no el país "suelto" porque un país puede tener más de una marca/número, y
el envío por Callbell es por agente (su API key + canal).

## Consecuencias
- Cada país puede tener su propio video para la misma palabra, y **regionalizar** un video global
  es agregar el del mercado: el global deja de salir ahí automáticamente, sin borrarlo (sigue
  sirviendo para los países que aún no tienen el suyo).
- Nunca se envían dos videos para la misma palabra en un mismo turno.
- *Global* queda como **fallback explícito**, no como default silencioso: si un video solo aplica a
  un país, hay que asignarle el mercado. Un video global sigue saliendo en todos los países que no
  tengan uno propio para esa palabra — es responsabilidad del equipo no dejar global un video con
  precios o acento de un país.
- La precedencia se calcula en memoria (son pocas reglas por agente): sin cambios de esquema ni
  migración nueva.
- `detectProductCategory` (docs/21) reusa `loadKeywordVideos`, así que también deja de contar dos
  veces la misma palabra.

## Alternativas consideradas
- **Quitar los videos globales** (todo video obligado a un mercado): más estricto, pero obliga a
  duplicar N veces cada video que sí es universal y rompería los videos ya cargados como globales.
- **Un switch por agente "no enviar videos globales"**: más granular, pero suma una columna, una
  migración y una decisión más para el equipo; la precedencia por palabra ya resuelve el caso real.
- **Filtrar por `country` en vez de por `agent_id`**: el envío es por agente (credenciales de
  Callbell propias) y un país puede tener varias marcas; `agent_id` ya existía en la tabla.
- **Resolver la precedencia en SQL** (`distinct on` / vista): más difícil de testear y de degradar
  durante la ventana de migración; la lógica pura ya está cubierta por Vitest.
