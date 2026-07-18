import type { ReactNode } from "react";

/**
 * Kit de componentes del sistema "Silent Sensei" (docs/vitasei-software-design.md §6).
 * Presentacional puro y server-safe: sin hooks, sin datos. Los roles de color son
 * convención: navy = estructura, teal = acción/acento, hairline slate-200.
 */

/** Encabezado de página: h1 Geist + descripción corta + acciones a la derecha. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] text-slate-900 sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

/** Card base: superficie blanca + hairline, radio 16px. */
export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white ${padded ? "p-5" : "overflow-hidden"} ${className}`}
    >
      {children}
    </div>
  );
}

/** Título de sección dentro de una card (17px Geist) con subtítulo opcional. */
export function CardTitle({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-[17px] font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/** Tono del tile de ícono de un KPI. */
export type KpiTone = "teal" | "navy" | "neutral" | "emerald" | "amber" | "rose" | "indigo";

const TILE: Record<KpiTone, string> = {
  teal: "bg-teal-50 text-teal-600",
  navy: "bg-slate-100 text-slate-900",
  neutral: "bg-slate-100 text-slate-500",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  indigo: "bg-indigo-50 text-indigo-600",
};

const BAR: Record<KpiTone, string> = {
  teal: "bg-teal-600",
  navy: "bg-slate-900",
  neutral: "bg-slate-400",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  indigo: "bg-indigo-500",
};

/**
 * KPI del sistema: tile de ícono, label uppercase, valor Geist grande, sub.
 * `progress` (0–100) pinta una barra SOLO si representa una proporción real.
 */
export function Kpi({
  label,
  value,
  sub,
  icon,
  tone = "navy",
  progress,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: KpiTone;
  progress?: number;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      {icon ? (
        <span
          className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${TILE[tone]}`}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1.5 font-display text-[28px] font-semibold leading-none tracking-[-0.03em] ${valueClassName ?? "text-slate-900"}`}
      >
        {value}
      </p>
      {sub ? <p className="mt-2 text-xs leading-relaxed text-slate-500">{sub}</p> : null}
      {progress != null && Number.isFinite(progress) ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${BAR[tone]}`}
            style={{ width: `${Math.max(0, Math.min(100, Math.round(progress)))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Estado vacío estándar: título ≤6 palabras + cuándo aparecerá el dato + acción. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {description ? <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-400">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Avatar de iniciales (contactos, clientes). Determinista por nombre. */
export function InitialsAvatar({
  name,
  size = "h-9 w-9 text-[12px]",
}: {
  name: string | null | undefined;
  size?: string;
}) {
  const initials = getInitials(name);
  return (
    <span
      aria-hidden="true"
      className={`flex ${size} flex-none select-none items-center justify-center rounded-full bg-gradient-to-br from-slate-500 to-slate-800 font-semibold text-white`}
    >
      {initials}
    </span>
  );
}

export function getInitials(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean) return "—";
  if (/^\d+$/.test(clean)) return clean.slice(-2);
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : (parts[0]?.[1] ?? "");
  return `${first}${second}`.toUpperCase();
}

/** Clases compartidas de controles (una sola definición para todo el panel). */
export const btnPrimary =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] bg-slate-900 px-4 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,.16)] transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50";

export const btnAccent =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] bg-teal-600 px-4 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(13,148,136,.3)] transition-colors hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50";

export const btnSecondary =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50";

export const btnSecondarySm =
  "inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50";

export const inputCls =
  "w-full rounded-[10px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";

/** Pill de filtro activa/inactiva (filtros por URL). */
export const pillActiveCls =
  "rounded-full bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
export const pillIdleCls =
  "rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";

/** Header de columna de tabla (11px uppercase). */
export const thCls =
  "pb-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400";
