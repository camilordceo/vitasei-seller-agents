"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Rango de fechas exacto (desde/hasta) para la lista de Conversaciones. Convive
 * con los atajos de "Fecha" (7/30/90 días): fijar un rango limpia el atajo y
 * viceversa, porque los dos acotan la MISMA clave de orden (último mensaje del
 * cliente o última respuesta) y mezclarlos daría una ventana ambigua.
 *
 * Las fechas son días calendario en hora Colombia (`YYYY-MM-DD`); el servidor las
 * convierte a instantes con el offset fijo UTC-5. Ambos extremos son INCLUSIVOS.
 */
export function DateRangeFilter({
  from,
  to,
  preserved,
}: {
  from: string;
  to: string;
  /** Filtros activos a conservar (sin `from`/`to`/`range` ni `page`). */
  preserved: Record<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);

  // Si la URL cambia por fuera (otro filtro, "Limpiar filtros", el botón atrás),
  // los inputs siguen a la URL en vez de quedarse con lo último que se tecleó.
  useEffect(() => setFromValue(from), [from]);
  useEffect(() => setToValue(to), [to]);

  function apply(nextFrom: string, nextTo: string) {
    const qs = new URLSearchParams(preserved);
    if (nextFrom) qs.set("from", nextFrom);
    if (nextTo) qs.set("to", nextTo);
    const s = qs.toString();
    startTransition(() =>
      router.push(s ? `/dashboard/conversations?${s}` : "/dashboard/conversations"),
    );
  }

  const dirty = fromValue !== from || toValue !== to;
  const hasRange = Boolean(from || to);
  const inputCls =
    "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Rango
      </span>
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
        disabled={isPending || !dirty}
        onClick={() => apply(fromValue, toValue)}
        className="min-h-[36px] rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-40"
      >
        Aplicar
      </button>
      {hasRange && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setFromValue("");
            setToValue("");
            apply("", "");
          }}
          className="rounded-md px-2 py-1.5 text-sm text-slate-500 underline-offset-2 transition-colors hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          Quitar rango
        </button>
      )}
      {isPending && <span className="text-xs text-slate-400">Cargando…</span>}
    </div>
  );
}
