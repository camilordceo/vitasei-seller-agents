"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRetargetConfig } from "../actions";
import { DEFAULT_RETARGET_GUIDANCE, MAX_RETARGET_STAGES } from "@/lib/agent/retargetPlan";
import type { AgentRetargetConfig, AgentRetargetStage } from "@/lib/dashboard/queries";

const areaCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

/** Fila de etapa en edición: horas como texto (para poder tipear) + guía. */
interface StageDraft {
  delay: string;
  guidance: string;
}

const BACKSTOP_LABEL = "1h, 8h y 23h";
/** Umbral (horas) a partir del cual una etapa arriesga caer fuera de la ventana 24h. */
const WINDOW_WARN_HOURS = 23;

function toDraft(stages: AgentRetargetStage[]): StageDraft[] {
  return stages.map((s) => ({
    delay: String(Number.isInteger(s.delayHours) ? s.delayHours : s.delayHours.toFixed(2)),
    guidance: s.guidance,
  }));
}

/**
 * Editor de seguimientos (retargets) POR AGENTE: cuántas etapas quiere y a qué hora
 * (delay tras dejar de responder), más la guía de tono/estrategia de cada una. Sin
 * etapas ⇒ se usa el backstop genérico. Las reglas de seguridad (no revelar que es
 * automático, no inventar, sin tags) se aplican SIEMPRE en el backend. Ver ADR-0052.
 */
export function RetargetSettings({ agents }: { agents: AgentRetargetConfig[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState(agents[0]?.agentId ?? "");
  const first = agents.find((a) => a.agentId === selectedId) ?? agents[0];
  const [stages, setStages] = useState<StageDraft[]>(toDraft(first?.stages ?? []));

  const dirty = () => {
    setSaved(false);
    setError(null);
  };

  const selectAgent = (id: string) => {
    const a = agents.find((x) => x.agentId === id);
    setSelectedId(id);
    setStages(toDraft(a?.stages ?? []));
    setSaved(false);
    setError(null);
  };

  const setStage = (i: number, patch: Partial<StageDraft>) => {
    dirty();
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const addStage = () => {
    dirty();
    // Sugerimos la siguiente hora "razonable" según lo que ya haya.
    const suggested = stages.length === 0 ? "1" : stages.length === 1 ? "8" : "23";
    setStages((prev) => [...prev, { delay: suggested, guidance: "" }]);
  };

  const removeStage = (i: number) => {
    dirty();
    setStages((prev) => prev.filter((_, idx) => idx !== i));
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateRetargetConfig(
          selectedId,
          stages.map((s) => ({ delayHours: Number(s.delay), guidance: s.guidance })),
        );
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
        <h3 className="text-sm font-semibold text-slate-700">Seguimientos por agente</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Define <span className="font-medium">cuántos</span> seguimientos quiere cada agente y{" "}
          <span className="font-medium">a qué hora</span> (delay tras dejar de responder), más el
          tono/estrategia de cada uno. Las reglas de seguridad —no revelar que es automático, no
          inventar precios, sin tags— se aplican siempre. Sin etapas = backstop genérico (
          {BACKSTOP_LABEL}).
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

      {stages.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">
          Sin seguimientos configurados. Se usará el <span className="font-medium">backstop
          genérico</span> ({BACKSTOP_LABEL}). Agrega etapas para personalizarlo.
        </div>
      ) : (
        <ul className="space-y-3">
          {stages.map((s, i) => {
            const hours = Number(s.delay);
            const nearWindow = Number.isFinite(hours) && hours >= WINDOW_WARN_HOURS;
            return (
              <li key={i} className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-start gap-3">
                  <div className="w-28 shrink-0">
                    <label htmlFor={`rt-h-${i}`} className={labelCls}>
                      Etapa {i + 1} · horas
                    </label>
                    <input
                      id={`rt-h-${i}`}
                      type="number"
                      inputMode="decimal"
                      min={0.25}
                      step={0.25}
                      value={s.delay}
                      onChange={(e) => setStage(i, { delay: e.target.value })}
                      className={areaCls}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`rt-g-${i}`} className={labelCls}>
                      Guía (tono / estrategia)
                    </label>
                    <textarea
                      id={`rt-g-${i}`}
                      value={s.guidance}
                      onChange={(e) => setStage(i, { guidance: e.target.value })}
                      rows={3}
                      placeholder={DEFAULT_RETARGET_GUIDANCE}
                      className={areaCls}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStage(i)}
                    aria-label={`Quitar etapa ${i + 1}`}
                    className="mt-6 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M6 7h12M9 7V5h6v2m-7 0 1 12h6l1-12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
                {nearWindow ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                    <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>
                      ≈24h o más: puede caer <span className="font-medium">fuera de la ventana de
                      24h</span> de WhatsApp y omitirse. Para recuperar más tarde usa{" "}
                      <span className="font-medium">Reactivaciones</span> (plantillas 7/15 días).
                    </span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {stages.length < MAX_RETARGET_STAGES ? (
          <button
            type="button"
            onClick={addStage}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Agregar seguimiento
          </button>
        ) : (
          <span className="text-xs text-slate-400">Máximo {MAX_RETARGET_STAGES} etapas.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
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
