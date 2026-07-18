"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Búsqueda de una llamada por el teléfono del cliente. Es el caso de uso que
 * pidió el negocio: "si ya se realizó, poder buscar esa llamada por teléfono".
 * Va por query param (`?phone=`) como el resto de filtros del dashboard.
 */
export function PhoneSearch({
  initial,
  params,
}: {
  initial: string;
  params: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== "phone") next.set(k, v);
    }
    const digits = value.replace(/\D/g, "");
    if (digits) next.set("phone", digits);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `/dashboard/calls?${qs}` : "/dashboard/calls"));
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <label htmlFor="phone-search" className="sr-only">
        Buscar por teléfono
      </label>
      <input
        id="phone-search"
        type="search"
        inputMode="tel"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Buscar por teléfono…"
        className="min-h-[40px] w-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      />
      <button
        type="submit"
        disabled={pending}
        className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60"
      >
        {pending ? "Buscando…" : "Buscar"}
      </button>
      {initial ? (
        <button
          type="button"
          onClick={() => {
            setValue("");
            const next = new URLSearchParams();
            for (const [k, v] of Object.entries(params)) {
              if (v && k !== "phone") next.set(k, v);
            }
            const qs = next.toString();
            startTransition(() =>
              router.push(qs ? `/dashboard/calls?${qs}` : "/dashboard/calls"),
            );
          }}
          className="text-sm text-slate-500 underline-offset-2 hover:underline"
        >
          Limpiar
        </button>
      ) : null}
    </form>
  );
}
