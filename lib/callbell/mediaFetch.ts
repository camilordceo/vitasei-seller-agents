import "server-only";
import { env } from "@/lib/env";
import { fetchMedia as fetchMediaWithAuth, type MediaAuth } from "@/lib/messaging/mediaFetch";
import type { FetchedMedia } from "@/lib/messaging/media";

/**
 * Descarga de adjuntos de CALLBELL. Desde ADR-0056 la mecánica común vive en
 * `lib/messaging/mediaFetch.ts`; acá solo queda la credencial propia de Callbell.
 * El comportamiento es el mismo de siempre: se intenta la descarga anónima y, si el
 * host de Callbell responde 401/403, se reintenta con el bearer de la API.
 * Ver docs/15, ADR-0022.
 */

/**
 * Credencial de Callbell para adjuntos protegidos. El valor es un thunk: `env`
 * lanza si la variable falta y solo debe evaluarse si de verdad hace falta.
 */
export function callbellMediaAuth(): MediaAuth {
  return {
    header: "Authorization",
    value: () => `Bearer ${env.CALLBELL_API_KEY}`,
    hostPattern: /callbell/i,
  };
}

/** Descarga un adjunto de Callbell. Best-effort: null ante cualquier fallo. */
export function fetchMedia(
  url: string,
  maxBytes: number = env.MEDIA_MAX_BYTES,
): Promise<FetchedMedia | null> {
  return fetchMediaWithAuth(url, { maxBytes, auth: callbellMediaAuth() });
}
