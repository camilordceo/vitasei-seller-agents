/**
 * Media — lógica PURA (sin I/O, sin `server-only`), testeable directo.
 *
 * Los adjuntos del webhook son URLs (Callbell los manda en `attachments`, Kapso en
 * `message.kapso.media_url`). Estos helpers infieren el content-type, el nombre de
 * archivo y el tipo de media, y arman el data URL base64 para la visión. La descarga
 * real (que usa el secreto del proveedor) vive en `mediaFetch.ts` (server-only).
 *
 * Vivía en `lib/callbell/media.ts` y se movió acá con ADR-0056: nunca tuvo nada de
 * Callbell y ahora lo comparten los dos proveedores (ese módulo lo re-exporta, así
 * que quien ya lo importaba de allí no cambió). Ver docs/15, docs/24, ADR-0022.
 */

export type MediaKind = "image" | "audio" | "video" | "document" | "other";

export interface FetchedMedia {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  kind: MediaKind;
}

const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  amr: "audio/amr",
  mp4: "video/mp4",
  pdf: "application/pdf",
};

const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

/** Extensión (sin punto, minúsculas) del path de una URL, o "" si no hay. */
export function extFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const m = /\.([a-z0-9]+)$/i.exec(path);
    return m ? m[1].toLowerCase() : "";
  } catch {
    // No es una URL absoluta válida: intentar sobre el string crudo.
    const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url);
    return m ? m[1].toLowerCase() : "";
  }
}

/**
 * Content-type efectivo: el header si es útil; si no, se infiere de la extensión
 * de la URL; si nada, `application/octet-stream`.
 */
export function normalizeContentType(header: string | null | undefined, url: string): string {
  const fromHeader = (header ?? "").split(";")[0].trim().toLowerCase();
  if (fromHeader && fromHeader !== "application/octet-stream" && fromHeader.includes("/")) {
    return fromHeader;
  }
  const fromExt = EXT_CONTENT_TYPE[extFromUrl(url)];
  return fromExt ?? (fromHeader || "application/octet-stream");
}

/** Clasifica el media por su content-type (top-level type). */
export function kindFromContentType(contentType: string): MediaKind {
  const top = contentType.split("/")[0];
  if (top === "image") return "image";
  if (top === "audio") return "audio";
  if (top === "video") return "video";
  if (contentType === "application/pdf") return "document";
  return "other";
}

/**
 * Clasifica el media por la EXTENSIÓN de su URL, sin descargarlo.
 *
 * Existe porque Callbell **no manda `type` en el webhook** (confirmado contra
 * payloads reales de producción: las claves son `to/from/text/uuid/status/channel/
 * contact/createdAt` + `attachments`). Sin un tipo, todo mensaje caía en `other` y
 * el adjunto se descartaba en silencio. La extensión sí viene en el path del
 * adjunto (`/uploads/<uuid>.mp3`), así que alcanza para decidir.
 *
 * Devuelve `other` si la extensión no dice nada — el caller decide qué hacer.
 */
export function kindFromUrl(url: string): MediaKind {
  const contentType = EXT_CONTENT_TYPE[extFromUrl(url)];
  return contentType ? kindFromContentType(contentType) : "other";
}

/** Nombre de archivo para subir a OpenAI (la extensión ayuda a detectar el formato). */
export function filenameFor(contentType: string, url: string): string {
  const ext = CONTENT_TYPE_EXT[contentType] || extFromUrl(url) || "bin";
  const base = kindFromContentType(contentType) === "audio" ? "audio" : "media";
  return `${base}.${ext}`;
}

/** Bytes → data URL base64 (para `input_image` de Responses). */
export function toDataUrl(bytes: Uint8Array, contentType: string): string {
  const b64 = Buffer.from(bytes).toString("base64");
  return `data:${contentType};base64,${b64}`;
}
