/** Formateadores puros para el dashboard (es-CO). */

export function formatCOP(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : Number(n) || 0;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(v);
}

/**
 * Monto en la moneda que traiga el dato (COP por defecto). `formatCOP` asume
 * pesos; esto se usa donde conviven mercados (órdenes, ROAS por agente) para no
 * pintar dólares con un "$" colombiano.
 */
export function formatMoney(n: number | null | undefined, currency?: string | null): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : Number(n) || 0;
  const code = (currency ?? "COP").toUpperCase();
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "COP" ? 0 : 2,
    }).format(v);
  } catch {
    // Código de moneda inválido en los datos → número + código, sin romper la página.
    return `${formatNumber(Math.round(v))} ${code}`;
  }
}

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO").format(Number(n) || 0);
}

export function formatUsd(n: number | null | undefined): string {
  return `US$ ${(Number(n) || 0).toFixed(2)}`;
}

/** USD con 4 decimales — para costos de IA (fracciones de centavo). */
export function formatUsd4(n: number | null | undefined): string {
  return `US$ ${(Number(n) || 0).toFixed(4)}`;
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

/**
 * Fecha + hora en HORA COLOMBIA (America/Bogota, UTC-5). Importante en el server
 * (Vercel corre en UTC): `formatDateTime` mostraría UTC. Úsalo para analítica de
 * horarios ("¿a qué hora?").
 */
export function formatBogotaDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Solo la hora (HH:mm) en hora Colombia. */
export function formatBogotaTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
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

/**
 * Minutos → "18 min", "5,4 h" o "2,3 días". Para la velocidad de cierre: la
 * unidad crece con la magnitud para no leer "4.320 min".
 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const fmt = (n: number) =>
    new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(n);
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${fmt(hours)} h`;
  return `${fmt(hours / 24)} días`;
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
