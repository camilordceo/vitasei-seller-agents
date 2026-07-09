"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRetargetInstructions } from "../actions";
import { DEFAULT_RETARGET_GUIDANCE } from "@/lib/agent/retargetPlan";
import type { AgentRetargetConfig } from "@/lib/dashboard/queries";

const areaCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

/**
 * Instrucciones de retarget (seguimientos 1h/8h) POR AGENTE. Se elige el agente en
 * el selector y se edita la GUÍA de cada etapa (tono/estrategia). Las reglas de
 * seguridad (no revelar que es automático, no inventar, sin tags) se aplican SIEMPRE
 * en el backend, no dependen de este texto. Vacío = guía por defecto. Ver ADR-0043.
 */
export function RetargetSettings({ agents }: { agents: AgentRetargetConfig[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState(agents[0]?.agentId ?? "");
  const current = agents.find((a) => a.agentId === selectedId) ?? agents[0];
  const [i1, setI1] = useState(current?.instruction1 ?? "");
  const [i2, setI2] = useState(current?.instruction2 ?? "");

  const dirty = () => {
    setSaved(false);
    setError(null);
  };

  const selectAgent = (id: string) => {
    const a = agents.find((x) => x.agentId === id);
    setSelectedId(id);
    setI1(a?.instruction1 ?? "");
    setI2(a?.instruction2 ?? "");
    setSaved(false);
    setError(null);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateRetargetInstructions(selectedId, { instruction1: i1, instruction2: i2 });
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar. Intenta de nuevo.");
      }
    });
  };

  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
        No hay agentes configurados. Crea uno en <span className="font-medium">Agentes</span> para
        calibrar sus seguimientos.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">Instrucciones de los seguimientos</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Calibra el tono/estrategia de cada seguimiento por agente: algo más{" "}
          <span className="font-medium">agresivo</span> (cerrar hoy, oferta) o más{" "}
          <span className="font-medium">informativo</span> (resolver dudas, beneficios). Las reglas
          de seguridad —no revelar que es automático, no inventar precios, sin tags— se aplican
          siempre. Vacío = usar la guía por defecto.
        </p>
      </div>

      <div>
        <label htmlFor="rt-agent" className={labelCls}>
          Agente (marca / línea)
        </label>
        <select
          id="rt-agent"
          value={selectedId}
          onChange={(e) => selectAgent(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:w-auto"
        >
          {agents.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              {a.name}
              {a.brand ? ` · ${a.brand}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rt-1" className={labelCls}>
            Seguimiento ~1 hora
          </label>
          <textarea
            id="rt-1"
            value={i1}
            onChange={(e) => {
              dirty();
              setI1(e.target.value);
            }}
            rows={5}
            placeholder={DEFAULT_RETARGET_GUIDANCE}
            className={areaCls}
          />
        </div>
        <div>
          <label htmlFor="rt-2" className={labelCls}>
            Seguimiento ~8 horas
          </label>
          <textarea
            id="rt-2"
            value={i2}
            onChange={(e) => {
              dirty();
              setI2(e.target.value);
            }}
            rows={5}
            placeholder={DEFAULT_RETARGET_GUIDANCE}
            className={areaCls}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
        >
          {isPending ? "Guardando…" : "Guardar"}
        </button>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Guardado
          </span>
        ) : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </div>
  );
}
