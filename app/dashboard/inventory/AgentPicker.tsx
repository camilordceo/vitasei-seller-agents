"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type AgentOption = { id: string; name: string; brand: string | null };

/**
 * Selector de agente para el inventario. Navega a `?agent=<id>` (server component
 * re-consulta los productos de ese agente). El catálogo es por agente.
 */
export function AgentPicker({ agents, current }: { agents: AgentOption[]; current: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="inv-agent" className="text-sm font-medium text-slate-600">
        Agente
      </label>
      <select
        id="inv-agent"
        value={current}
        disabled={isPending}
        onChange={(e) =>
          startTransition(() => router.push(`/dashboard/inventory?agent=${e.target.value}`))
        }
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
      >
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
