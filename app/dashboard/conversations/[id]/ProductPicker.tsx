"use client";

import { useEffect, useRef, useState } from "react";
import { searchAgentProducts } from "../../actions";
import { formatMoney } from "@/lib/dashboard/format";
import type { ProductPick } from "../types";

/**
 * Buscador del catálogo del agente para adjuntar la foto de un producto al chat
 * sin volver a subirla. Solo lista productos CON imagen: los demás no sirven aquí.
 */
export function ProductPicker({
  conversationId,
  onPick,
  onClose,
}: {
  conversationId: string;
  onPick: (product: ProductPick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ProductPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Búsqueda con debounce; `cancelled` evita que una respuesta vieja pise a una nueva.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await searchAgentProducts(conversationId, query);
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "No se pudo buscar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [conversationId, query]);

  return (
    <div className="mb-2 rounded-[10px] border border-slate-200 bg-white p-2.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Buscar producto por nombre o SKU…"
          aria-label="Buscar producto del inventario"
          className="h-11 flex-1 rounded-[10px] border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar buscador"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mt-2 max-h-64 overflow-y-auto">
        {loading ? (
          <ul className="space-y-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 rounded-lg p-2">
                <div className="h-12 w-12 animate-pulse rounded-lg bg-slate-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
                </div>
              </li>
            ))}
          </ul>
        ) : error ? (
          <p className="px-1 py-6 text-center text-sm text-rose-600">{error}</p>
        ) : rows.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-slate-400">
            {query
              ? "Ningún producto con imagen coincide con esa búsqueda."
              : "El catálogo de este agente no tiene productos con imagen."}
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map((p) => (
              <li key={p.sku}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.imageUrl ?? ""}
                    alt=""
                    loading="lazy"
                    className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {p.name}
                    </span>
                    <span className="block truncate font-mono text-xs text-slate-400">
                      {p.sku}
                      {p.inStock ? "" : " · sin stock"}
                    </span>
                  </span>
                  {p.price != null ? (
                    <span className="shrink-0 text-sm tabular-nums text-slate-600">
                      {formatMoney(p.price, p.currency)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
