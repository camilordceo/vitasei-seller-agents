import "server-only";
import OpenAI, { toFile } from "openai";
import { env } from "@/lib/env";
import type { FetchedMedia } from "@/lib/callbell/media";
import { fetchMedia } from "@/lib/callbell/mediaFetch";

/**
 * Transcripción de notas de voz (ver docs/15, ADR-0022).
 *
 * `audio.transcriptions.create` sube el archivo (multipart), por eso primero se
 * descargan los bytes con `fetchMedia`. Español fijo (`language: "es"`) para
 * mejorar el acento colombiano. Modelo configurable (`OPENAI_TRANSCRIBE_MODEL`,
 * default `whisper-1`). El texto entra al turno como si el cliente lo escribiera.
 */

/** Descarga la URL del adjunto y la transcribe. Devuelve null si no se pudo bajar. */
export async function transcribeAudioUrl(openai: OpenAI, url: string): Promise<string | null> {
  const media = await fetchMedia(url);
  if (!media) return null;
  return transcribeMedia(openai, media);
}

/** Transcribe bytes ya descargados. Lanza si la API falla (el caller lo maneja). */
export async function transcribeMedia(openai: OpenAI, media: FetchedMedia): Promise<string> {
  const file = await toFile(media.bytes, media.filename, { type: media.contentType });
  const res = await openai.audio.transcriptions.create({
    file,
    model: env.OPENAI_TRANSCRIBE_MODEL,
    language: "es",
  });
  return (res.text ?? "").trim();
}
