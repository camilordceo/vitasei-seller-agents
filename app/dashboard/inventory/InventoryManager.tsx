"use client";

import { useMemo, useState, useTransition } from "react";
import { updateProductImage } from "../actions";
import type { ProductRow } from "@/lib/dashboard/queries";

const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400";

/** Miniatura del `image_url`. Si no hay o el link está roto, muestra un placeholder. */
function Thumb({ url, alt, size = "h-14 w-14" }: { url: string | null; alt: string; size?: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div
        className={`flex ${size} shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-center text-[10px] leading-tight text-slate-400`}
      >
        sin imagen
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
      className={`${size} shrink-0 rounded-md border border-slate-200 bg-white object-cover`}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const withImage = useMemo(() => products.filter((p) => p.imageUrl).length, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  }, [products, query]);

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
      <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
        Este agente no tiene productos cargados. Cárgalos desde{" "}
        <span className="font-medium">Agentes → (agente) → Cargar catálogo</span>.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o SKU…"
          className={`sm:max-w-xs ${inputCls}`}
          aria-label="Buscar producto"
        />
        <span className="text-xs text-slate-400">
          {products.length} productos · {withImage} con imagen
        </span>
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {filtered.map((p) => (
          <li key={p.id} className="flex flex-wrap items-start gap-3 p-3">
            <Thumb url={p.imageUrl} alt={p.name} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-800">{p.name}</span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                  {p.sku}
                </span>
                {!p.inStock && (
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    Sin stock
                  </span>
                )}
                <span className="text-xs text-slate-400">{formatPrice(p.price, p.currency)}</span>
              </div>

              {editingId === p.id ? (
                <div className="mt-2 space-y-2">
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
                  {editUrl.trim() && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Vista previa:</span>
                      <Thumb url={editUrl.trim()} alt="preview" size="h-12 w-12" />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => save(p.id)}
                      disabled={isPending}
                      className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
                    >
                      {isPending ? "Guardando…" : "Guardar"}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={isPending}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    {error && <span className="text-xs text-rose-600">{error}</span>}
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {p.imageUrl ? (
                    <a
                      href={p.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 max-w-full truncate text-xs text-indigo-600 underline decoration-slate-300 underline-offset-2 hover:decoration-indigo-500"
                      title={p.imageUrl}
                    >
                      {p.imageUrl}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">Sin link de imagen</span>
                  )}
                </div>
              )}
            </div>

            {editingId !== p.id && (
              <button
                onClick={() => startEdit(p)}
                disabled={isPending}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
              >
                Cambiar imagen
              </button>
            )}
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="p-4 text-sm text-slate-400">Ningún producto coincide con “{query}”.</li>
        )}
      </ul>
    </div>
  );
}
