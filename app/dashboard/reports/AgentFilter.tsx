"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type ReportAgentOption = { id: string; name: string; brand: string | null };

/**
 * Selector de agente para los Reportes. Navega a `?agent=<id>` (el server
 * component re-consulta cada reporte acotado a ese agente) o a `/dashboard/reports`
 * para el consolidado ("Todos los agentes"). Ver ADR-0053.
 */
export function AgentFilter({
  agents,
  current,
}: {
  agents: ReportAgentOption[];
  /** id del agente activo, o "" para el consolidado (todos). */
  current: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="report-agent" className="text-sm font-medium text-slate-600">
        Agente
      </label>
      <select
        id="report-agent"
        value={current}
        disabled={isPending}
        onChange={(e) => {
          const v = e.target.value;
          startTransition(() =>
            router.push(v ? `/dashboard/reports?agent=${v}` : "/dashboard/reports"),
          );
        }}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
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
