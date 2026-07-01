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

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
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
