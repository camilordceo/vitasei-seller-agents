"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Búsqueda de órdenes por teléfono, nombre o ciudad + filtro por producto.
 * Navega por query params (`?q=`, `?sku=`) preservando los demás filtros, igual
 * que los filtros de Conversaciones. Cambiar cualquiera vuelve a la página 1.
 */
export function OrderSearch({
  q,
  sku,
  products,
  preserved,
}: {
  q: string;
  sku: string;
  products: Array<{ sku: string; name: string }>;
  /** Filtros activos a conservar (sin `q`/`sku` ni `page`). */
  preserved: Record<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState(q);

  // Sigue a la URL cuando cambia por fuera (limpiar filtros, botón atrás).
  useEffect(() => setText(q), [q]);

  function go(next: { q?: string; sku?: string }) {
    const qs = new URLSearchParams(preserved);
    const nextQ = next.q ?? q;
    const nextSku = next.sku ?? sku;
    if (nextQ.trim()) qs.set("q", nextQ.trim());
    if (nextSku) qs.set("sku", nextSku);
    const s = qs.toString();
    startTransition(() => router.push(s ? `/dashboard/orders?${s}` : "/dashboard/orders"));
  }

  const inputCls =
    "min-h-[38px] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: text });
        }}
      >
        <input
          type="search"
          aria-label="Buscar por teléfono, nombre o ciudad"
          placeholder="Teléfono, nombre o ciudad"
          value={text}
          disabled={isPending}
          onChange={(e) => setText(e.target.value)}
          className={`${inputCls} w-64 max-w-full`}
        />
        <button
          type="submit"
          disabled={isPending}
          className="min-h-[38px] rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-40"
        >
          Buscar
        </button>
      </form>

      {products.length > 0 && (
        <select
          aria-label="Filtrar por producto"
          value={sku}
          disabled={isPending}
          onChange={(e) => go({ sku: e.target.value })}
          className={`${inputCls} max-w-[18rem]`}
        >
          <option value="">Todos los productos</option>
          {products.map((p) => (
            <option key={p.sku} value={p.sku}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {isPending && <span className="text-xs text-slate-400">Cargando…</span>}
    </div>
  );
}
