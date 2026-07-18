"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateReactivationSettings } from "../actions";
import type { AgentReactivationConfig } from "@/lib/dashboard/queries";

const inputCls =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

/**
 * Config de reactivaciones POR AGENTE (ON/OFF + UUID de plantilla 7d/15d). Se elige
 * el agente en el selector; las plantillas viven en SU cuenta de Callbell. Guarda
 * vía Server Action `updateReactivationSettings`. Ver ADR-0030.
 */
export function ReactivationSettings({ agents }: { agents: AgentReactivationConfig[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState(agents[0]?.agentId ?? "");
  const current = agents.find((a) => a.agentId === selectedId) ?? agents[0];
  const [enabled, setEnabled] = useState(current?.enabled ?? false);
  const [t7, setT7] = useState(current?.template7d ?? "");
  const [t15, setT15] = useState(current?.template15d ?? "");
  const [img7, setImg7] = useState(current?.image7d ?? "");
  const [img15, setImg15] = useState(current?.image15d ?? "");

  const dirty = () => {
    setSaved(false);
    setError(null);
  };

  const selectAgent = (id: string) => {
    const a = agents.find((x) => x.agentId === id);
    setSelectedId(id);
    setEnabled(a?.enabled ?? false);
    setT7(a?.template7d ?? "");
    setT15(a?.template15d ?? "");
    setImg7(a?.image7d ?? "");
    setImg15(a?.image15d ?? "");
    setSaved(false);
    setError(null);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateReactivationSettings(selectedId, {
          enabled,
          template7d: t7,
          template15d: t15,
          image7d: img7,
          image15d: img15,
        });
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar. Intenta de nuevo.");
      }
    });
  };

  if (agents.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
        No hay agentes configurados. Crea uno en <span className="font-medium">Agentes</span> para
        configurar sus reactivaciones.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      {/* Selector de agente */}
      <div>
        <label htmlFor="react-agent" className={labelCls}>
          Agente (marca / línea)
        </label>
        <select
          id="react-agent"
          value={selectedId}
          onChange={(e) => selectAgent(e.target.value)}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 sm:w-auto"
        >
          {agents.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              {a.name}
              {a.brand ? ` · ${a.brand}` : ""}
              {a.enabled ? " — ON" : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">
          Las plantillas son de la cuenta de Callbell de ese agente. Configura cada línea por separado.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Estado del feature</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Con esto encendido, cada nuevo cliente de este agente recibe una plantilla a los 7 y 15
            días si no compra. Apágalo para detener su programación y envíos.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Activar reactivaciones de este agente"
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
        <TemplateStageFields
          idBase="react-7"
          title="Día 7"
          uuid={t7}
          onUuid={(v) => {
            dirty();
            setT7(v);
          }}
          image={img7}
          onImage={(v) => {
            dirty();
            setImg7(v);
          }}
        />
        <TemplateStageFields
          idBase="react-15"
          title="Día 15"
          uuid={t15}
          onUuid={(v) => {
            dirty();
            setT15(v);
          }}
          image={img15}
          onImage={(v) => {
            dirty();
            setImg15(v);
          }}
        />
      </div>
      <p className="text-xs text-slate-400">
        Crea y aprueba las plantillas en la cuenta de Callbell de este agente, copia su UUID y pégalo
        aquí. Si el UUID de una etapa queda vacío, esa etapa no se envía. El{" "}
        <span className="font-medium">link de imagen</span> es opcional: con link, la plantilla se
        envía con imagen (header); vacío, se envía como plantilla de solo texto.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60"
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

/**
 * Campos de UNA etapa de plantilla (día 7 o día 15): UUID + link de imagen opcional.
 * El badge y la vista previa cambian según si hay imagen — con link, la plantilla se
 * envía con imagen (header, `type:"image"`); vacío, se envía como solo texto. Ver ADR-0044.
 */
function TemplateStageFields({
  idBase,
  title,
  uuid,
  onUuid,
  image,
  onImage,
}: {
  idBase: string;
  title: string;
  uuid: string;
  onUuid: (v: string) => void;
  image: string;
  onImage: (v: string) => void;
}) {
  const hasImage = image.trim().length > 0;
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-700">Plantilla · {title}</h4>
        <span
          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${
            hasImage ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${hasImage ? "bg-indigo-500" : "bg-slate-400"}`}
            aria-hidden="true"
          />
          {hasImage ? "Con imagen" : "Solo texto"}
        </span>
      </div>
      <div>
        <label htmlFor={`${idBase}-uuid`} className={labelCls}>
          UUID de la plantilla
        </label>
        <input
          id={`${idBase}-uuid`}
          value={uuid}
          onChange={(e) => onUuid(e.target.value)}
          className={inputCls}
          placeholder="UUID de Callbell"
        />
      </div>
      <div>
        <label htmlFor={`${idBase}-img`} className={labelCls}>
          Link de imagen <span className="font-normal text-slate-400">· opcional</span>
        </label>
        <input
          id={`${idBase}-img`}
          value={image}
          onChange={(e) => onImage(e.target.value)}
          className={inputCls}
          placeholder="https://…  (vacío = solo texto)"
        />
        {hasImage ? <StagePreview url={image.trim()} /> : null}
      </div>
    </div>
  );
}

/** Vista previa del header de imagen; si el link no carga, muestra un aviso. */
function StagePreview({ url }: { url: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <p className="mt-2 text-[11px] text-amber-600">
        No se pudo cargar la imagen. Revisa que el link sea público y directo.
      </p>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Vista previa de la imagen de la plantilla"
      loading="lazy"
      onError={() => setBroken(true)}
      className="mt-2 max-h-28 w-full rounded-md border border-slate-200 bg-white object-contain"
    />
  );
}
