"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setHotmartAgent } from "../actions";
import type { AgentOption } from "./HotmartTemplatesManager";
import { providerLabel } from "@/lib/messaging/types";

const selectCls =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 sm:w-auto";

/**
 * Designa qué agente (marca / línea) maneja los eventos de Hotmart. Los carritos
 * abandonados se envían por la cuenta del PROVEEDOR de ese agente, así que la
 * plantilla debe existir allí. Es también el interruptor para mover la línea de
 * Callbell a Kapso: se elige el agente de Kapso y los siguientes carritos salen por
 * ahí (volver atrás es el mismo clic al revés). Ver ADR-0041, ADR-0056.
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
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Agente de Hotmart</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        Qué agente (marca / línea) maneja los carritos abandonados. La plantilla se envía por la
        cuenta del <strong>proveedor</strong> de ese agente, así que debe existir allí: en Callbell
        se identifica por UUID; en Kapso, por nombre. Cambiar de agente aquí mueve la línea de un
        proveedor al otro.
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
                {a.brand ? ` · ${a.brand}` : ""} [{providerLabel(a.provider)}]
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={isPending || selected === (current ?? "")}
            className="inline-flex h-11 items-center rounded-md bg-slate-900 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
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
