"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type ConvoAgentOption = { id: string; name: string; brand: string | null };

/**
 * Selector de agente para Conversaciones. Navega a `?agent=<id>` (o quita el
 * parámetro para "Todos los agentes") PRESERVANDO los demás filtros activos
 * (fecha/pedido/estado/orden) que llegan en `preserved`. Cambiar de agente
 * vuelve a la página 1 (no se copia `page`). Mismo patrón que Reportes (ADR-0053).
 */
export function AgentFilter({
  agents,
  current,
  preserved,
}: {
  agents: ConvoAgentOption[];
  /** id del agente activo, o "" para todos. */
  current: string;
  /** Filtros activos a conservar (range/order/status/sort). Sin `page` ni `agent`. */
  preserved: Record<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Agente
      </span>
      <select
        id="convo-agent"
        aria-label="Filtrar por agente"
        value={current}
        disabled={isPending}
        onChange={(e) => {
          const v = e.target.value;
          const qs = new URLSearchParams(preserved);
          if (v) qs.set("agent", v);
          const s = qs.toString();
          startTransition(() =>
            router.push(s ? `/dashboard/conversations?${s}` : "/dashboard/conversations"),
          );
        }}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
      >
        <option value="">Todos los agentes</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.brand ? ` · ${a.brand}` : ""}
          </option>
        ))}
      </select>
      {isPending && <span className="text-xs text-slate-400">Cargando…</span>}
    </div>
  );
}
