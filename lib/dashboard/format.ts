/** Formateadores puros para el dashboard (es-CO). */

export function formatCOP(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : Number(n) || 0;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(v);
}

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO").format(Number(n) || 0);
}

export function formatUsd(n: number | null | undefined): string {
  return `US$ ${(Number(n) || 0).toFixed(2)}`;
}

/** Ratio 0..1 → "12,5 %" (es-CO). */
export function formatPercent(ratio: number | null | undefined): string {
  const v = typeof ratio === "number" && Number.isFinite(ratio) ? ratio : 0;
  return new Intl.NumberFormat("es-CO", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(v);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(new Date(iso));
}

/** "2026-07-02" (día key) → "2 jul" corto para ejes/listas. */
export function formatDayKeyShort(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  // Mediodía UTC para evitar cruces de día al formatear.
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}
