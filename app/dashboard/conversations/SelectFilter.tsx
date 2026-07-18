"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Filtro genérico de la lista de Conversaciones basado en un `<select>`. Navega a
 * `?<paramName>=<value>` (o quita el parámetro para "todos") PRESERVANDO los demás
 * filtros activos que llegan en `preserved` (sin `page`, así cambiar el filtro
 * vuelve a la página 1). Mismo patrón que `AgentFilter` (ADR-0053); se usa para
 * Etiqueta y Producto.
 */
export function SelectFilter({
  label,
  ariaLabel,
  paramName,
  current,
  allLabel,
  options,
  preserved,
}: {
  /** Texto corto de la columna (izquierda). */
  label: string;
  ariaLabel: string;
  /** Nombre del query param (`tag`, `product`, ...). */
  paramName: string;
  /** Valor activo, o "" para todos. */
  current: string;
  /** Opción vacía ("Todas las etiquetas", "Todos los productos"). */
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  /** Filtros activos a conservar (sin este `paramName` ni `page`). */
  preserved: Record<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <select
        aria-label={ariaLabel}
        value={current}
        disabled={isPending}
        onChange={(e) => {
          const v = e.target.value;
          const qs = new URLSearchParams(preserved);
          if (v) qs.set(paramName, v);
          const s = qs.toString();
          startTransition(() =>
            router.push(s ? `/dashboard/conversations?${s}` : "/dashboard/conversations"),
          );
        }}
        className="min-w-0 max-w-[16rem] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {isPending && <span className="text-xs text-slate-400">Cargando…</span>}
    </div>
  );
}
