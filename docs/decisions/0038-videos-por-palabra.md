# ADR-0038: Videos por palabra clave en la respuesta del bot

- **Estado:** Aceptada
- **Fecha:** 2026-07-08
- **Sprint:** 6 (continuación — contenido)

## Contexto
El equipo quiere enviar videos educativos/de producto después de que el bot responde, cuando su
respuesta menciona ciertos temas (ej. si el bot habla de "magnesio", mandar el video de magnesio).
Debe configurarse sin tocar código (una sección en el dashboard) y funcionar con la API de Callbell.

## Decisión
- **Nueva tabla `videos`** (`keyword`, `video_url`, `enabled`, `agent_id` nullable = global) — migración
  `0016`. Índice único por `(lower(keyword), agent_id)` para no duplicar palabras.
- **Match contra la RESPUESTA del bot** (`parsed.cleanText`), no contra el mensaje del cliente: el
  usuario lo pidió así ("si se responde con una de esas palabras"). Lógica **pura** en
  `lib/agent/videoMatch.ts`: **case- y acento-insensible**, por **palabra completa** (con `\p{L}`/`\p{N}`),
  y **preservando la ñ** (en español "año" ≠ "ano"). Testeada (9 casos).
- **Envío por Callbell** con `sendVideo`: `type: "document"` + `content: { url }` — así lo documenta
  Callbell para video (WhatsApp infiere el tipo por la extensión; solo `image` admite caption). Requiere
  cuenta con **WhatsApp Business API oficial** (la que ya usa Vitasei).
- **Idempotente por conversación**: antes de enviar se verifica que no exista ya un `messages` de
  `type: video` con ese `media_url` en la conversación → cada video se manda **una sola vez**
  (satisface "después de la primera respuesta").
- **Best-effort**: `sendKeywordVideos` nunca lanza; loguea `keyword_video_sent`/`keyword_video_failed`.
  Se invoca al final de la rama de respuesta NORMAL (no en handoff). No altera el costo de IA.
- **Sección `/dashboard/videos`**: agregar palabra + URL, activar/desactivar y eliminar (server actions
  `createVideo`/`setVideoEnabled`/`deleteVideo`).

## Consecuencias
- **Bueno:** configurable sin deploy; una llamada extra a Callbell solo cuando hay match; idempotente;
  lógica de match pura y testeada; consistente con el patrón sección + server actions + service-role.
- **Malo / atado a futuro:**
  - El video se da por **URL pública** (no hay upload en v1): Callbell necesita una URL alcanzable.
    Subir el archivo (a Supabase Storage) queda como follow-up.
  - No hay caption junto al video (Callbell no lo soporta para video); el video sigue a la respuesta
    que ya trae texto.
  - El match es por substring de palabra completa; no hay sinónimos ni stemming (suficiente para
    nombres de producto). Si se necesita, se amplía luego.
  - Requiere aplicar la migración `0016` en Supabase.

## Alternativas consideradas
- **(a) Match contra el mensaje del CLIENTE**: descartado — el usuario lo pidió sobre la respuesta del
  bot (es el bot quien "recomienda magnesio").
- **(b) Que el modelo emita un tag `#video-magnesio`**: más frágil (depende del prompt) y menos
  configurable por el equipo; el match por palabra en el texto ya enviado es determinista.
- **(c) Enviar el video en CADA respuesta con la palabra**: descartado — spamearía; se limita a una vez
  por conversación (idempotencia por `media_url`).
- **(d) Upload del archivo en el dashboard**: útil, pero más superficie (storage, límites de tamaño);
  se difiere. URL pública cubre el v1.
