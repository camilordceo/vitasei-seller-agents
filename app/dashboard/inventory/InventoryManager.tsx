"use client";

import { useMemo, useState, useTransition } from "react";
import { updateProductImage } from "../actions";
import type { ProductRow } from "@/lib/dashboard/queries";
import { EmptyState, btnSecondarySm, inputCls } from "../ui-kit";

/**
 * Vista de administrador del catálogo (rediseño docs/27): grid de cards con la
 * foto grande (es el dato crítico — es lo que el bot manda por WhatsApp),
 * búsqueda y filtros de calidad del catálogo (sin imagen / sin stock), y
 * edición del link de imagen inline con vista previa.
 */

type Filter = "all" | "no-image" | "no-stock";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "no-image", label: "Sin imagen" },
  { value: "no-stock", label: "Sin stock" },
];

/** Imagen del producto. Si no hay link o está roto, placeholder explícito. */
function ProductImage({ url, alt }: { url: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="flex h-40 w-full items-center justify-center bg-slate-50">
        <div className="text-center">
          <svg
            className="mx-auto h-7 w-7 text-slate-300"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <rect x="3.5" y="5" width="17" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="M5 18l5-5 3 3 3-3 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="mt-1.5 text-[11px] font-medium text-slate-400">
            {broken ? "Link de imagen roto" : "Sin imagen"}
          </p>
        </div>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className="h-40 w-full bg-white object-contain"
    />
  );
}

/** Miniatura para la vista previa del editor. */
function Thumb({ url, alt }: { url: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-center text-[9px] leading-tight text-slate-400">
        link roto
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      onError={() => setBroken(true)}
      className="h-12 w-12 rounded-lg border border-slate-200 bg-white object-cover"
    />
  );
}

function formatPrice(price: number | null, currency: string): string {
  if (price == null) return "—";
  try {
    return `${price.toLocaleString("es-CO")} ${currency}`;
  } catch {
    return `${price} ${currency}`;
  }
}

export function InventoryManager({ products: initial }: { products: ProductRow[] }) {
  const [products, setProducts] = useState<ProductRow[]>(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === "no-image" && p.imageUrl) return false;
      if (filter === "no-stock" && p.inStock) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    });
  }, [products, query, filter]);

  const startEdit = (p: ProductRow) => {
    setEditingId(p.id);
    setEditUrl(p.imageUrl ?? "");
    setError(null);
  };

  const save = (id: string) => {
    startTransition(async () => {
      try {
        await updateProductImage(id, editUrl);
        setProducts((prev) =>
          prev.map((x) => (x.id === id ? { ...x, imageUrl: editUrl.trim() || null } : x)),
        );
        setEditingId(null);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar el link.");
      }
    });
  };

  if (products.length === 0) {
    return (
      <EmptyState
        title="Este agente no tiene productos"
        description="Carga el catálogo desde Agentes → (agente) → Cargar catálogo y los productos aparecerán aquí."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: búsqueda + filtros de calidad del catálogo */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o SKU…"
          className={`${inputCls} sm:max-w-xs`}
          aria-label="Buscar producto"
        />
        <div className="inline-flex gap-0.5 rounded-[11px] bg-slate-100 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={
                filter === f.value
                  ? "rounded-lg bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  : "rounded-lg px-3.5 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs tabular-nums text-slate-400">
          {filtered.length} de {products.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Ningún producto coincide"
          description={
            query
              ? `No hay resultados para “${query}” con este filtro.`
              : "No hay productos con este filtro."
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const editing = editingId === p.id;
            return (
              <li
                key={p.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
              >
                <div className="relative border-b border-slate-100">
                  <ProductImage url={p.imageUrl} alt={p.name} />
                  {!p.inStock ? (
                    <span className="absolute left-3 top-3 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                      Sin stock
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold leading-snug text-slate-900">{p.name}</p>
                    <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600">
                      {p.sku}
                    </span>
                  </div>
                  <p className="font-display text-lg font-semibold tracking-tight text-teal-700">
                    {formatPrice(p.price, p.currency)}
                  </p>

                  {editing ? (
                    <div className="mt-1 space-y-2.5">
                      <input
                        type="url"
                        inputMode="url"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        placeholder="https://…/imagen-nueva.jpg (vacío = quitar imagen)"
                        className={inputCls}
                        aria-label="Nuevo link de imagen"
                        autoFocus
                      />
                      {editUrl.trim() ? (
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-slate-400">Vista previa</span>
                          <Thumb url={editUrl.trim()} alt="Vista previa" />
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => save(p.id)}
                          disabled={isPending}
                          className="inline-flex min-h-[36px] items-center rounded-[10px] bg-teal-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50"
                        >
                          {isPending ? "Guardando…" : "Guardar cambios"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          disabled={isPending}
                          className={btnSecondarySm}
                        >
                          Cancelar
                        </button>
                      </div>
                      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
                    </div>
                  ) : (
                    <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                      {p.imageUrl ? (
                        <a
                          href={p.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 truncate text-xs text-slate-400 underline decoration-slate-200 underline-offset-2 transition-colors hover:text-teal-700 hover:decoration-teal-400"
                          title={p.imageUrl}
                        >
                          {p.imageUrl.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">Sin link de imagen</span>
                      )}
                      <button
                        onClick={() => startEdit(p)}
                        disabled={isPending}
                        className={btnSecondarySm}
                      >
                        Cambiar imagen
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
