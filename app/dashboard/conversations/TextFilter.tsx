"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Filtro de texto libre de la lista de Conversaciones (búsqueda por cliente y por
 * palabra clave). Es un `<form>`: se aplica con Enter o con el botón, no en cada
 * tecla — cada búsqueda es una consulta al servidor y buscar letra a letra sería
 * una consulta por pulsación. Navega a `?<paramName>=<texto>` preservando los
 * demás filtros activos (sin `page`, así cambiar la búsqueda vuelve a la página 1).
 * Mismo patrón que `DateRangeFilter`. Ver ADR-0071.
 */
export function TextFilter({
  label,
  ariaLabel,
  paramName,
  placeholder,
  current,
  preserved,
}: {
  /** Texto corto de la columna (izquierda). */
  label: string;
  ariaLabel: string;
  /** Nombre del query param (`q`, `kw`, ...). */
  paramName: string;
  placeholder: string;
  /** Valor activo, o "" sin búsqueda. */
  current: string;
  /** Filtros activos a conservar (sin este `paramName` ni `page`). */
  preserved: Record<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(current);

  // Si la URL cambia por fuera (otro filtro, "Limpiar filtros", el botón atrás),
  // el input sigue a la URL en vez de quedarse con lo último que se tecleó.
  useEffect(() => setValue(current), [current]);

  function apply(next: string) {
    const qs = new URLSearchParams(preserved);
    const trimmed = next.trim();
    if (trimmed) qs.set(paramName, trimmed);
    const s = qs.toString();
    startTransition(() =>
      router.push(s ? `/dashboard/conversations?${s}` : "/dashboard/conversations"),
    );
  }

  const dirty = value.trim() !== current;

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply(value);
      }}
    >
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <input
        type="search"
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        maxLength={60}
        disabled={isPending}
        onChange={(e) => setValue(e.target.value)}
        className="min-w-0 w-64 max-w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={isPending || !dirty}
        className="min-h-[36px] rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-40"
      >
        Buscar
      </button>
      {current && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setValue("");
            apply("");
          }}
          className="rounded-md px-2 py-1.5 text-sm text-slate-500 underline-offset-2 transition-colors hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          Quitar
        </button>
      )}
      {isPending && <span className="text-xs text-slate-400">Cargando…</span>}
    </form>
  );
}
