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

export interface Transcription {
  text: string;
  /** Duración del audio en segundos (para el costo por minuto). null si el modelo no la da. */
  durationSec: number | null;
}

/** Descarga la URL del adjunto y la transcribe. Devuelve null si no se pudo bajar. */
export async function transcribeAudioUrl(
  openai: OpenAI,
  url: string,
): Promise<Transcription | null> {
  const media = await fetchMedia(url);
  if (!media) return null;
  return transcribeMedia(openai, media);
}

/**
 * Transcribe bytes ya descargados. Lanza si la API falla (el caller lo maneja).
 * Con whisper-1 pedimos `verbose_json` para obtener la `duration` (base del costo
 * por minuto). Otros modelos (gpt-4o-transcribe) no la exponen igual → durationSec
 * queda null y el costo de ese audio se toma como 0 (no rompe).
 */
export async function transcribeMedia(openai: OpenAI, media: FetchedMedia): Promise<Transcription> {
  const file = await toFile(media.bytes, media.filename, { type: media.contentType });
  const model = env.OPENAI_TRANSCRIBE_MODEL;

  if (model.toLowerCase().includes("whisper")) {
    const res = await openai.audio.transcriptions.create({
      file,
      model,
      language: "es",
      response_format: "verbose_json",
    });
    return { text: (res.text ?? "").trim(), durationSec: res.duration ?? null };
  }

  const res = await openai.audio.transcriptions.create({ file, model, language: "es" });
  return { text: (res.text ?? "").trim(), durationSec: null };
}
