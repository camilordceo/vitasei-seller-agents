import "server-only";
import { env } from "@/lib/env";
import {
  type FetchedMedia,
  filenameFor,
  kindFromContentType,
  normalizeContentType,
} from "@/lib/messaging/media";

/**
 * Descarga de adjuntos — común a los dos proveedores (IO + secretos → server-only).
 * La lógica pura de inferencia vive en `media.ts`. Ver docs/15, docs/24, ADR-0022.
 */

/**
 * Credencial para descargar un adjunto protegido.
 *
 * `hostPattern` NO es decorativo: acota a qué host se manda la credencial. Sin él,
 * un 401 de una URL ajena haría que le enviáramos la API key del proveedor a un
 * tercero. Cada adaptador pasa el patrón de SU host.
 *
 * OJO — se prueba contra el **hostname**, nunca contra la URL completa. Probarlo
 * contra la URL es explotable: un patrón como `/callbell/i` lo satisface
 * `https://atacante.com/x?next=callbell`, y como la URL del adjunto viene del
 * webhook, bastaría con que el atacante responda 401 para llevarse la API key. Si
 * la URL no parsea, no se manda credencial.
 *
 * `value` admite un thunk para poder resolver el secreto SOLO cuando de verdad se
 * usa (en la rama 401/403). Importa: `env.CALLBELL_API_KEY` lanza si la variable
 * falta, así que evaluarlo por adelantado rompería descargas anónimas que hoy
 * funcionan sin esa env.
 */
export interface MediaAuth {
  header: string;
  value: string | (() => string);
  /** Se compara contra el HOSTNAME de la URL (no contra la URL entera). */
  hostPattern?: RegExp;
}

/** ¿La URL apunta a un host al que sí le podemos mandar la credencial? */
function hostAllowed(url: string, auth: MediaAuth): boolean {
  if (!auth.hostPattern) return true;
  try {
    return auth.hostPattern.test(new URL(url).hostname);
  } catch {
    return false; // URL no parseable → no arriesgamos el secreto
  }
}

export interface FetchMediaOptions {
  maxBytes?: number;
  /** Credencial a usar SOLO si la descarga anónima devuelve 401/403. */
  auth?: MediaAuth | null;
}

/**
 * Descarga un adjunto. Best-effort: devuelve null ante cualquier fallo (URL caída,
 * no-ok, vacío, o más grande que `maxBytes`).
 *
 * Primero intenta **sin credenciales** (la mayoría de los adjuntos son URLs firmadas
 * o públicas) y solo reintenta con `auth` si el proveedor respondió 401/403. Ese
 * orden importa en Kapso: su doc **no especifica** si `media_url` requiere auth (ver
 * docs/24 §Pendientes de verificar), así que funciona en los dos casos sin tener que
 * saberlo de antemano.
 */
export async function fetchMedia(
  url: string,
  options?: FetchMediaOptions,
): Promise<FetchedMedia | null> {
  const maxBytes = options?.maxBytes ?? env.MEDIA_MAX_BYTES;
  const auth = options?.auth ?? null;

  try {
    let res = await fetch(url);

    const needsAuth = res.status === 401 || res.status === 403;
    if (needsAuth && auth && hostAllowed(url, auth)) {
      const value = typeof auth.value === "function" ? auth.value() : auth.value;
      res = await fetch(url, { headers: { [auth.header]: value } });
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
