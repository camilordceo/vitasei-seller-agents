import "server-only";
import type { MediaAuth } from "@/lib/messaging/mediaFetch";

/**
 * Credencial de Kapso para descargar adjuntos.
 *
 * PENDIENTE DE VERIFICAR (ver docs/24 §Pendientes de verificar): la doc de Kapso
 * **no dice** si las URLs `https://api.kapso.ai/media/...` que llegan en el webhook
 * (`message.kapso.media_url`) necesitan autenticación. El único caso documentado con
 * precisión es el `download_url` que devuelve `GET /v24.0/{media_id}` — y ese trae el
 * token embebido y textualmente *"No X-API-Key header is needed"*.
 *
 * Por eso no adivinamos: `fetchMedia` intenta primero **sin credencial** y solo si
 * Kapso responde 401/403 reintenta con la API key del agente. Funciona en los dos
 * escenarios sin depender de aclarar la doc. El `hostPattern` evita que la key salga
 * hacia cualquier host que no sea Kapso.
 */
export function kapsoMediaAuth(apiKey: string): MediaAuth {
  return {
    header: "X-API-Key",
    value: apiKey,
    hostPattern: /(^|\/\/)([^/]*\.)?kapso\.ai\//i,
  };
}
