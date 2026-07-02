import type OpenAI from "openai";

/**
 * Armado del `input` de Responses — lógica PURA (sin I/O, sin `server-only`).
 *
 * Devuelve un string plano cuando el turno es solo texto (retro-compatible), o un
 * mensaje `user` multimodal (input_text + input_image) cuando hay imágenes, para
 * que el modelo las "vea" en la misma llamada. Ver docs/15, ADR-0022.
 */
export function buildResponsesInput(
  text: string,
  imageDataUrls?: string[],
): string | OpenAI.Responses.ResponseInput {
  const images = imageDataUrls ?? [];
  if (images.length === 0) return text;

  const content: OpenAI.Responses.ResponseInputContent[] = [];
  if (text.length > 0) content.push({ type: "input_text", text });
  for (const url of images) {
    content.push({ type: "input_image", image_url: url, detail: "auto" });
  }
  return [{ role: "user", content }];
}
