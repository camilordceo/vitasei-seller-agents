/**
 * Precios de los modelos de IA (USD). Punto único de verdad para el costo real
 * que se muestra en el dashboard. Si cambias de modelo, actualiza acá.
 */

// gpt-5-mini — USD por 1M tokens (fuente: pricing OpenAI).
export const GPT5_MINI_INPUT_PER_1M = 0.25;
export const GPT5_MINI_OUTPUT_PER_1M = 2;

// Transcripción de notas de voz (whisper-1) — USD por minuto de audio.
export const WHISPER_PER_MINUTE = 0.006;

// Estimación de tokens de ENTRADA por imagen (visión). Se usa SOLO para repartir
// el costo de tokens entre "texto" e "imágenes" en el reporte — NO cambia el costo
// total (ese sale del `usage` real de la API). Ajustable si tu mezcla cambia.
export const EST_IMAGE_INPUT_TOKENS = 1000;

/** Costo de una llamada al modelo a partir de sus tokens de entrada/salida. */
export function tokenCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1e6) * GPT5_MINI_INPUT_PER_1M +
    (outputTokens / 1e6) * GPT5_MINI_OUTPUT_PER_1M
  );
}

/** Costo de una transcripción a partir de su duración en segundos. */
export function audioCostUsd(durationSec: number): number {
  return (durationSec / 60) * WHISPER_PER_MINUTE;
}
