"use client";

import { type FormEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOrder } from "../actions";
import type { OrderEditInput } from "./types";
import type { FulfillmentMethod, OrderStatus } from "@/lib/supabase/types";
import { formatCOP } from "@/lib/dashboard/format";

/** Estado de una fila de ítem en el editor (valores como string para inputs). */
interface ItemRow {
  key: string;
  name: string;
  sku: string;
  qty: string;
  unitPrice: string;
}

export interface OrderEditorInitial {
  status: OrderStatus;
  method: FulfillmentMethod;
  shippingName: string;
  shippingAddress: string;
  shippingCity: string;
  shippingPhone: string;
  notes: string;
  total: number | null;
  items: Array<{ name: string; sku: string; qty: number; unitPrice: number | null }>;
}

const STATUS_OPTIONS: Array<{ value: OrderStatus; label: string }> = [
  { value: "pending_handoff", label: "Pendiente de handoff" },
  { value: "handed_off", label: "Con logística" },
  { value: "confirmed", label: "Confirmada (venta cerrada)" },
  { value: "cancelled", label: "Cancelada" },
];

const METHOD_OPTIONS: Array<{ value: FulfillmentMethod; label: string }> = [
  { value: "cod", label: "Contra entrega" },
  { value: "addi", label: "Addi" },
  { value: "undecided", label: "Sin definir" },
];

const inputCls =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

function num(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Previsualiza el total sumando qty × precio de los ítems con precio. */
function previewTotal(items: ItemRow[]): number | null {
  let total = 0;
  let any = false;
  for (const it of items) {
    const price = num(it.unitPrice);
    if (price != null) {
      const qty = Math.max(1, Math.floor(num(it.qty) ?? 1));
      total += qty * price;
      any = true;
    }
  }
  return any ? total : null;
}

export function OrderEditor({
  orderId,
  initial,
}: {
  orderId: string;
  initial: OrderEditorInitial;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<OrderStatus>(initial.status);
  const [method, setMethod] = useState<FulfillmentMethod>(initial.method);

  // El método es texto libre por agente (ADR-0055): si el de la orden no está entre
  // los conocidos (ej. "zelle"), se agrega como opción para no perderlo al editar.
  const methodOptions = METHOD_OPTIONS.some((o) => o.value === initial.method)
    ? METHOD_OPTIONS
    : [...METHOD_OPTIONS, { value: initial.method, label: initial.method }];
  const [shippingName, setShippingName] = useState(initial.shippingName);
  const [shippingAddress, setShippingAddress] = useState(initial.shippingAddress);
  const [shippingCity, setShippingCity] = useState(initial.shippingCity);
  const [shippingPhone, setShippingPhone] = useState(initial.shippingPhone);
  const [notes, setNotes] = useState(initial.notes);
  const [total, setTotal] = useState(initial.total != null ? String(initial.total) : "");
  const [recompute, setRecompute] = useState(false);

  const keyCounter = useRef(0);
  const nextKey = () => `k${keyCounter.current++}`;
  const [items, setItems] = useState<ItemRow[]>(() =>
    initial.items.map((it) => ({
      key: nextKey(),
      name: it.name,
      sku: it.sku,
      qty: String(it.qty),
      unitPrice: it.unitPrice != null ? String(it.unitPrice) : "",
    })),
  );

  const dirty = () => {
    setSaved(false);
    setError(null);
  };

  const updateItem = (key: string, patch: Partial<ItemRow>) => {
    dirty();
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  };
  const addItem = () => {
    dirty();
    setItems((prev) => [...prev, { key: nextKey(), name: "", sku: "", qty: "1", unitPrice: "" }]);
  };
  const removeItem = (key: string) => {
    dirty();
    setItems((prev) => prev.filter((it) => it.key !== key));
  };

  const computed = previewTotal(items);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: OrderEditInput = {
      status,
      method,
      shippingName,
      shippingAddress,
      shippingCity,
      shippingPhone,
      notes,
      total: num(total),
      recomputeTotal: recompute,
      items: items.map((it) => ({
        sku: it.sku,
        name: it.name,
        qty: Math.max(1, Math.floor(num(it.qty) ?? 1)),
        unitPrice: num(it.unitPrice),
      })),
    };
    startTransition(async () => {
      try {
        await saveOrder(orderId, payload);
        setSaved(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Estado y método */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="status" className={labelCls}>
            Estado
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => {
              dirty();
              setStatus(e.target.value as OrderStatus);
            }}
            className={inputCls}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="method" className={labelCls}>
            Método de pago/entrega
          </label>
          <select
            id="method"
            value={method}
            onChange={(e) => {
              dirty();
              setMethod(e.target.value as FulfillmentMethod);
            }}
            className={inputCls}
          >
            {methodOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Envío */}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-slate-700">Datos de envío</legend>
        <div>
          <label htmlFor="sname" className={labelCls}>
            Nombre
          </label>
          <input
            id="sname"
            value={shippingName}
            onChange={(e) => {
              dirty();
              setShippingName(e.target.value);
            }}
            className={inputCls}
            placeholder="Nombre de quien recibe"
          />
        </div>
        <div>
          <label htmlFor="sphone" className={labelCls}>
            Teléfono
          </label>
          <input
            id="sphone"
            value={shippingPhone}
            onChange={(e) => {
              dirty();
              setShippingPhone(e.target.value);
            }}
            className={inputCls}
            placeholder="573001234567"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="saddr" className={labelCls}>
            Dirección
          </label>
          <input
            id="saddr"
            value={shippingAddress}
            onChange={(e) => {
              dirty();
              setShippingAddress(e.target.value);
            }}
            className={inputCls}
            placeholder="Calle 00 # 00-00, barrio"
          />
        </div>
        <div>
          <label htmlFor="scity" className={labelCls}>
            Ciudad
          </label>
          <input
            id="scity"
            value={shippingCity}
            onChange={(e) => {
              dirty();
              setShippingCity(e.target.value);
            }}
            className={inputCls}
            placeholder="Bogotá"
          />
        </div>
      </fieldset>

      {/* Ítems */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Ítems</h3>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Agregar ítem
          </button>
        </div>

        {items.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            Sin ítems. Agrega uno si la orden debía incluir productos.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div
                key={it.key}
                className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2 sm:grid-cols-[1fr_9rem_4.5rem_8rem_auto]"
              >
                <input
                  aria-label="Nombre del producto"
                  value={it.name}
                  onChange={(e) => updateItem(it.key, { name: e.target.value })}
                  className={inputCls}
                  placeholder="Producto"
                />
                <input
                  aria-label="SKU / #ID"
                  value={it.sku}
                  onChange={(e) => updateItem(it.key, { sku: e.target.value })}
                  className={`${inputCls} font-mono`}
                  placeholder="#ID / SKU"
                />
                <input
                  aria-label="Cantidad"
                  inputMode="numeric"
                  value={it.qty}
                  onChange={(e) => updateItem(it.key, { qty: e.target.value })}
                  className={inputCls}
                  placeholder="1"
                />
                <input
                  aria-label="Precio unitario"
                  inputMode="numeric"
                  value={it.unitPrice}
                  onChange={(e) => updateItem(it.key, { unitPrice: e.target.value })}
                  className={inputCls}
                  placeholder="Precio unit."
                />
                <button
                  type="button"
                  onClick={() => removeItem(it.key)}
                  aria-label="Quitar ítem"
                  className="inline-flex h-11 w-11 items-center justify-center self-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M7 7l1 13h8l1-13" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Total */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={recompute}
            onChange={(e) => {
              dirty();
              setRecompute(e.target.checked);
            }}
            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-teal-500"
          />
          Recalcular el total desde los ítems
          {recompute ? (
            <span className="ml-auto font-semibold text-slate-900">{formatCOP(computed)}</span>
          ) : null}
        </label>
        {!recompute ? (
          <div className="mt-3">
            <label htmlFor="total" className={labelCls}>
              Total (COP)
            </label>
            <input
              id="total"
              inputMode="numeric"
              value={total}
              onChange={(e) => {
                dirty();
                setTotal(e.target.value);
              }}
              className={inputCls}
              placeholder="Total en pesos"
            />
            {computed != null && num(total) !== computed ? (
              <p className="mt-1 text-xs text-slate-400">
                Suma de ítems: {formatCOP(computed)}.{" "}
                <button
                  type="button"
                  onClick={() => {
                    dirty();
                    setTotal(String(computed));
                  }}
                  className="font-medium text-slate-600 underline hover:text-slate-900"
                >
                  Usar este valor
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Notas */}
      <div>
        <label htmlFor="notes" className={labelCls}>
          Notas (logística)
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => {
            dirty();
            setNotes(e.target.value);
          }}
          rows={3}
          className={inputCls}
          placeholder="Detalles de entrega, referencias, etc."
        />
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60"
        >
          {isPending ? "Guardando…" : "Guardar cambios"}
        </button>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Cambios guardados
          </span>
        ) : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </form>
  );
}
