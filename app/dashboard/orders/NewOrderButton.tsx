"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createManualOrder } from "../actions";

/**
 * Botón "Nueva orden" de la sección Órdenes: crea una orden manual "de cero" para
 * registrar ventas que no pasaron por el bot (históricas, por teléfono) y verlas
 * en métricas. Pide nombre + teléfono (opcionales) para el contacto y abre el
 * editor donde se completan ítems/envío/total. Ver ADR-0032.
 */
const inputCls =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

export function NewOrderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const orderId = await createManualOrder({ name, phone });
        router.push(`/dashboard/orders/${orderId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo crear la orden. Intenta de nuevo.");
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
        Nueva orden
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Nueva orden manual</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cerrar"
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="mo-name" className={labelCls}>
            Nombre del cliente
          </label>
          <input
            id="mo-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="Ej: María Elena"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="mo-phone" className={labelCls}>
            Teléfono (opcional)
          </label>
          <input
            id="mo-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="numeric"
            className={`${inputCls} font-mono`}
            placeholder="573001234567"
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Se crea la orden y se abre el editor para agregar ítems, envío y total.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60"
        >
          {isPending ? "Creando…" : "Crear y editar"}
        </button>
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </form>
  );
}
