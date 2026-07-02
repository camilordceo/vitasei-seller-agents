import "server-only";
import { env } from "@/lib/env";
import {
  type FetchedMedia,
  filenameFor,
  kindFromContentType,
  normalizeContentType,
} from "@/lib/callbell/media";

/**
 * Descarga de adjuntos de Callbell (IO + secreto → server-only). Ver docs/15,
 * ADR-0022. La lógica pura de inferencia vive en `media.ts` (testeable).
 */

/**
 * Descarga un adjunto. Best-effort: devuelve null ante cualquier fallo (URL
 * caída, no-ok, vacío, o más grande que `maxBytes`). Si el host es de Callbell y
 * responde 401/403, reintenta con el bearer de la API.
 */
export async function fetchMedia(
  url: string,
  maxBytes: number = env.MEDIA_MAX_BYTES,
): Promise<FetchedMedia | null> {
  try {
    let res = await fetch(url);
    if ((res.status === 401 || res.status === 403) && /callbell/i.test(url)) {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${env.CALLBELL_API_KEY}` },
      });
    }
    if (!res.ok) return null;

    // Corte temprano por Content-Length si viene.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return null;

    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;

    const contentType = normalizeContentType(res.headers.get("content-type"), url);
    return {
      bytes: new Uint8Array(buf),
      contentType,
      filename: filenameFor(contentType, url),
      kind: kindFromContentType(contentType),
    };
  } catch {
    return null;
  }
}
