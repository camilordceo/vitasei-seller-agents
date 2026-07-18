/**
 * Costo estimado de las llamadas de voz.
 *
 * Synthflow **no expone el costo por API** (verificado: `/v2/analytics` solo da
 * `duration_metrics.total_minutes`, sin plata; `/v2/analytics/export`,
 * `/v2/credits` y `/v2/usage` responden 404). Así que lo estimamos nosotros a
 * partir de la duración, igual que `lib/openai/pricing.ts` estima el de OpenAI.
 *
 * El default (0.20 USD/min) está en el rango de mercado del modelo pay-as-you-go
 * (voz ~0.09 + LLM ~0.02–0.05 + telefonía ~0.02 → 0.15–0.24). Se ajusta con
 * `SYNTHFLOW_USD_PER_MINUTE` cuando se sepa la tarifa real de la cuenta.
 */

export const DEFAULT_USD_PER_MINUTE = 0.2;

/**
 * Costo de una llamada a partir de su duración en segundos.
 * Se factura el tiempo real (no se redondea a minuto completo): es una
 * estimación para reportes, no una factura.
 */
export function callCostUsd(durationSec: number | null | undefined, usdPerMinute: number): number {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const rate = Number.isFinite(usdPerMinute) && usdPerMinute > 0 ? usdPerMinute : DEFAULT_USD_PER_MINUTE;
  return Number(((durationSec / 60) * rate).toFixed(4));
}

/** Duración legible: `1m 53s`, `47s`. */
export function formatDuration(durationSec: number | null | undefined): string {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return "0s";
  const total = Math.round(durationSec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
