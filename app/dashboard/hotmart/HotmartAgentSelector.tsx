"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setHotmartAgent } from "../actions";
import type { AgentOption } from "./HotmartTemplatesManager";

const selectCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:w-auto";

/**
 * Designa qué agente (marca / línea con su cuenta de Callbell) maneja los eventos
 * de Hotmart. Los carritos abandonados se envían por la cuenta de Callbell de ESE
 * agente, así que la plantilla debe existir en esa cuenta. Ver ADR-0041.
 */
export function HotmartAgentSelector({
  agents,
  current,
}: {
  agents: AgentOption[];
  current: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(current ?? "");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await setHotmartAgent(selected || null);
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar. Intenta de nuevo.");
      }
    });
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-700">Agente de Hotmart</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        Qué agente (marca / línea) maneja los carritos abandonados. La plantilla se envía por la
        cuenta de Callbell de ese agente, así que su UUID debe existir en esa cuenta.
      </p>

      {agents.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          No hay agentes. Crea uno en <span className="font-medium">Agentes</span> para asignarlo.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            aria-label="Agente que maneja Hotmart"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setSaved(false);
              setError(null);
            }}
            className={selectCls}
          >
            <option value="">— Ninguno (usar fallback: env / primer agente) —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.brand ? ` · ${a.brand}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={isPending || selected === (current ?? "")}
            className="inline-flex h-11 items-center rounded-md bg-slate-900 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
          >
            {isPending ? "Guardando…" : "Guardar"}
          </button>
          {saved && <span className="text-sm font-medium text-emerald-700">Guardado</span>}
          {error && <span className="text-sm text-rose-600">{error}</span>}
        </div>
      )}
    </section>
  );
}
