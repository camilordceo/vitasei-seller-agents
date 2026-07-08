# 20 — Videos por palabra clave

Envía un video automáticamente cuando la **respuesta del bot** menciona una palabra configurada
(ej. "magnesio" → video de magnesio). Configurable desde el dashboard, sin tocar código. Ver
**ADR-0038**.

## Qué hace
- Sección **`/dashboard/videos`**: el equipo agrega pares **palabra → URL de video**, y puede
  activarlos/desactivarlos o eliminarlos.
- En el **backend**, después de que el bot envía su respuesta normal, si el texto menciona una de
  esas palabras, se envía el video correspondiente por Callbell — **una sola vez por conversación**.

## Cómo funciona (backend)
1. Tras enviar la respuesta (rama normal, no handoff) en `generateAndSend`, se llama a
   `sendKeywordVideos` con el texto que vio el cliente (`parsed.cleanText`).
2. Se cargan los videos habilitados del agente + los globales (`agent_id null`).
3. `matchVideos` (puro, testeado) empareja **case- y acento-insensible**, por **palabra completa**,
   preservando la ñ (año ≠ ano).
4. Por cada match: si ese video **no** se envió antes en la conversación (idempotencia por
   `media_url` en `messages`), se manda por Callbell y se guarda el `messages` (type `video`) +
   evento `keyword_video_sent`. Best-effort: un fallo se loguea (`keyword_video_failed`) y no rompe
   la respuesta.

## Callbell (envío de video)
`sendVideo` usa `POST /v1/messages/send` con:
```json
{ "to": "57...", "from": "whatsapp", "type": "document", "content": { "url": "https://…/magnesio.mp4" } }
```
Callbell manda video/audio/documento como `type: "document"` (WhatsApp reconoce el video por la
extensión). Solo `image` admite caption. **Requiere cuenta con WhatsApp Business API oficial**
(la que ya usa Vitasei). Doc: <https://docs.callbell.eu/api/reference/messages_api/post_send_messages/>.

## Datos (migración 0016)
Tabla `videos`: `keyword`, `video_url`, `enabled`, `agent_id` (NULL = global). Índice único por
`(lower(keyword), agent_id)`. **Requiere aplicar `0016_videos.sql` en Supabase.**

## Archivos
- `supabase/migrations/0016_videos.sql`, `lib/supabase/types.ts` (tabla `videos`).
- `lib/callbell/sender.ts` (`sendVideo` + tipo `document`).
- `lib/agent/videoMatch.ts` (puro) + `lib/agent/videoMatch.test.ts`.
- `lib/agent/videos.ts` (carga + envío idempotente), enganchado en `lib/agent/processMessage.ts`.
- `lib/dashboard/queries.ts` (`getVideos`), `app/dashboard/actions.ts`
  (`createVideo`/`setVideoEnabled`/`deleteVideo`).
- `app/dashboard/videos/page.tsx` + `VideosManager.tsx`, link en `app/dashboard/layout.tsx`.

## Qué NO hace (v1)
- No sube el archivo de video: se da por **URL pública** (Callbell la reenvía). Upload → follow-up.
- No manda caption junto al video (Callbell no lo soporta para video); el video sigue a la respuesta.
- No hay sinónimos/stemming: match por palabra completa (suficiente para nombres de producto).

## Cómo probar
1. Aplicar `0016_videos.sql` en Supabase.
2. En `/dashboard/videos`, agregar `magnesio` + una URL `.mp4` pública.
3. Escribirle al bot algo que lo lleve a mencionar "magnesio" en su respuesta → debe llegar el video
   justo después del mensaje (y no repetirse en esa conversación).
