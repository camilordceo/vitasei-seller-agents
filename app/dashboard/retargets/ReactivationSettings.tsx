"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateReactivationSettings } from "../actions";

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 shadow-sm placeholder:font-sans placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";

/**
 * Config del feature de reactivaciones (ON/OFF + UUID de plantilla 7d/15d),
 * editable desde el dashboard. Guarda vía Server Action `updateReactivationSettings`.
 */
export function ReactivationSettings({
  initial,
}: {
  initial: { enabled: boolean; template7d: string | null; template15d: string | null };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(initial.enabled);
  const [t7, setT7] = useState(initial.template7d ?? "");
  const [t15, setT15] = useState(initial.template15d ?? "");

  const dirty = () => {
    setSaved(false);
    setError(null);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateReactivationSettings({ enabled, template7d: t7, template15d: t15 });
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar. Intenta de nuevo.");
      }
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Estado del feature</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Con esto encendido, cada nuevo cliente recibe una plantilla a los 7 y 15 días si no
            compra. Apágalo para detener toda la programación y los envíos.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Activar reactivaciones"
          onClick={() => {
            dirty();
            setEnabled((v) => !v);
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
            enabled ? "bg-emerald-600" : "bg-slate-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <span
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
          enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-slate-400"}`}
          aria-hidden="true"
        />
        {enabled ? "Encendido" : "Apagado"}
      </span>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="t7" className="mb-1 block text-xs font-medium text-slate-600">
            UUID plantilla · día 7
          </label>
          <input
            id="t7"
            value={t7}
            onChange={(e) => {
              dirty();
              setT7(e.target.value);
            }}
            className={inputCls}
            placeholder="UUID de Callbell"
          />
        </div>
        <div>
          <label htmlFor="t15" className="mb-1 block text-xs font-medium text-slate-600">
            UUID plantilla · día 15
          </label>
          <input
            id="t15"
            value={t15}
            onChange={(e) => {
              dirty();
              setT15(e.target.value);
            }}
            className={inputCls}
            placeholder="UUID de Callbell"
          />
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Crea y aprueba las plantillas en Callbell, copia su UUID y pégalo aquí. Si un campo queda
        vacío, esa etapa no se envía.
      </p>

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
