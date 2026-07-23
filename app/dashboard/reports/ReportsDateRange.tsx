"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Rango de fechas de los Reportes (ADR-0087). Dos formas de elegir la ventana, y
 * son EXCLUYENTES entre sí:
 *  - Atajos ("14 / 30 / 90 días") → escriben `?range=` y limpian el rango a medida.
 *  - Rango exacto Desde/Hasta → escribe `?from&to` y limpia el atajo.
 * "Todo" quita ambos y vuelve al histórico. El agente seleccionado se conserva.
 *
 * Con un rango activo, TODA la página (series y agregaciones) se recalcula dentro de
 * él; solo las tarjetas móviles "Hoy / 7 / 30 días" siguen siendo relativas a hoy.
 */
const PRESETS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Todo" },
  { value: "14d", label: "14 días" },
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
];

const activeCls =
  "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
const idleCls =
  "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60";

export function ReportsDateRange({
  agent,
  preset,
  from,
  to,
}: {
  /** id del agente activo (para conservarlo al cambiar de fecha), o "". */
  agent: string;
  /** Atajo activo: "all" | "14d" | "30d" | "90d" | "custom". */
  preset: string;
  /** Rango exacto activo (YYYY-MM-DD), o "" si no hay. */
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);

  // Si la URL cambia por fuera (atajo, "Todo", botón atrás), los inputs la siguen.
  useEffect(() => setFromValue(from), [from]);
  useEffect(() => setToValue(to), [to]);

  function go(params: Record<string, string>) {
    const qs = new URLSearchParams();
    if (agent) qs.set("agent", agent);
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const s = qs.toString();
    startTransition(() =>
      router.push(s ? `/dashboard/reports?${s}` : "/dashboard/reports"),
    );
  }

  const isCustom = preset === "custom";
  const dirty = fromValue !== from || toValue !== to;
  const inputCls =
    "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60";

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Fecha
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={isPending}
            onClick={() => go(p.value === "all" ? {} : { range: p.value })}
            className={!isCustom && preset === p.value ? activeCls : idleCls}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>Desde</span>
          <input
            type="date"
            aria-label="Desde esta fecha"
            value={fromValue}
            max={toValue || undefined}
            disabled={isPending}
            onChange={(e) => setFromValue(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>Hasta</span>
          <input
            type="date"
            aria-label="Hasta esta fecha"
            value={toValue}
            min={fromValue || undefined}
            disabled={isPending}
            onChange={(e) => setToValue(e.target.value)}
            className={inputCls}
          />
        </label>
        <button
          type="button"
          disabled={isPending || !dirty || (!fromValue && !toValue)}
          onClick={() => go({ from: fromValue, to: toValue })}
          className="min-h-[36px] rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-40"
        >
          Aplicar
        </button>
        {isCustom && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setFromValue("");
              setToValue("");
              go({});
            }}
            className="rounded-md px-2 py-1.5 text-sm text-slate-500 underline-offset-2 transition-colors hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Quitar rango
          </button>
        )}
        {isPending && <span className="text-xs text-slate-400">Cargando…</span>}
      </div>
    </div>
  );
}
