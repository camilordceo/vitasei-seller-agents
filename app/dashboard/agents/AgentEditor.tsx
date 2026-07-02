"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAgent, createAgent } from "../actions";
import type { AgentEditInput } from "./types";

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";
const monoCls = `${inputCls} font-mono`;
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

export interface AgentEditorInitial {
  name: string;
  brand: string;
  country: string;
  whatsappNumber: string;
  callbellChannelUuid: string;
  hasCallbellApiKey: boolean;
  callbellApiKeyLast4: string | null;
  logisticsTeamUuid: string;
  vectorStoreId: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  enabled: boolean;
}

/**
 * Editor de un agente (marca/número): config de IA + credenciales de Callbell.
 * Sirve para CREAR (sin `agentId`) o EDITAR. La API key de Callbell es write-only:
 * se muestra enmascarada y solo se envía si se pega una nueva. Ver docs/16.
 */
export function AgentEditor({
  agentId,
  initial,
}: {
  agentId?: string;
  initial: AgentEditorInitial;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial.name);
  const [brand, setBrand] = useState(initial.brand);
  const [country, setCountry] = useState(initial.country);
  const [whatsappNumber, setWhatsappNumber] = useState(initial.whatsappNumber);
  const [channelUuid, setChannelUuid] = useState(initial.callbellChannelUuid);
  const [apiKey, setApiKey] = useState("");
  const [teamUuid, setTeamUuid] = useState(initial.logisticsTeamUuid);
  const [vectorStoreId, setVectorStoreId] = useState(initial.vectorStoreId);
  const [model, setModel] = useState(initial.model);
  const [temperature, setTemperature] = useState(String(initial.temperature));
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [enabled, setEnabled] = useState(initial.enabled);

  const dirty = () => {
    setSaved(false);
    setError(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const t = Number(temperature.trim());
    const payload: AgentEditInput = {
      name,
      brand,
      country,
      whatsappNumber,
      callbellChannelUuid: channelUuid,
      callbellApiKey: apiKey,
      logisticsTeamUuid: teamUuid,
      vectorStoreId,
      model,
      temperature: Number.isFinite(t) ? t : 0.3,
      systemPrompt,
      enabled,
    };
    startTransition(async () => {
      try {
        if (agentId) {
          await saveAgent(agentId, payload);
          setApiKey("");
          setSaved(true);
          router.refresh();
        } else {
          const newId = await createAgent(payload);
          router.push(`/dashboard/agents/${newId}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      }
    });
  };

  const keyPlaceholder = initial.hasCallbellApiKey
    ? `•••• ${initial.callbellApiKeyLast4 ?? ""} — deja vacío para conservarla`
    : "Pega la API key de la cuenta de Callbell de esta marca";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Nombre + estado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="name" className={labelCls}>
            Nombre del agente
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => {
              dirty();
              setName(e.target.value);
            }}
            className={inputCls}
            placeholder="Vitasei México"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Agente habilitado"
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
          {enabled ? "Habilitado" : "Deshabilitado"}
        </label>
      </div>

      {/* Marca / país */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="brand" className={labelCls}>
            Marca
          </label>
          <input
            id="brand"
            value={brand}
            onChange={(e) => {
              dirty();
              setBrand(e.target.value);
            }}
            className={inputCls}
            placeholder="Vitasei"
          />
        </div>
        <div>
          <label htmlFor="country" className={labelCls}>
            País
          </label>
          <input
            id="country"
            value={country}
            onChange={(e) => {
              dirty();
              setCountry(e.target.value);
            }}
            className={inputCls}
            placeholder="MX"
          />
        </div>
      </div>

      {/* Enrutamiento Callbell */}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-slate-700">
          Enrutamiento y Callbell
        </legend>
        <div>
          <label htmlFor="wa" className={labelCls}>
            Número de WhatsApp (E.164 sin +)
          </label>
          <input
            id="wa"
            value={whatsappNumber}
            onChange={(e) => {
              dirty();
              setWhatsappNumber(e.target.value);
            }}
            className={monoCls}
            placeholder="5215555555555"
          />
        </div>
        <div>
          <label htmlFor="chan" className={labelCls}>
            Callbell channel_uuid
          </label>
          <input
            id="chan"
            value={channelUuid}
            onChange={(e) => {
              dirty();
              setChannelUuid(e.target.value);
            }}
            className={monoCls}
            placeholder="UUID del canal de esta línea"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="key" className={labelCls}>
            Callbell API key {initial.hasCallbellApiKey ? "(configurada)" : "(usa la global si se deja vacía)"}
          </label>
          <input
            id="key"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => {
              dirty();
              setApiKey(e.target.value);
            }}
            className={monoCls}
            placeholder={keyPlaceholder}
          />
          <p className="mt-1 text-xs text-slate-400">
            Solo si esta marca vive en otra cuenta de Callbell. Si se deja vacía, se usa la key
            global del proyecto. No se muestra por seguridad.
          </p>
        </div>
        <div>
          <label htmlFor="team" className={labelCls}>
            Equipo de logística (team_uuid)
          </label>
          <input
            id="team"
            value={teamUuid}
            onChange={(e) => {
              dirty();
              setTeamUuid(e.target.value);
            }}
            className={monoCls}
            placeholder="UUID del equipo (handoff)"
          />
        </div>
        <div>
          <label htmlFor="vs" className={labelCls}>
            OpenAI vector_store_id (catálogo)
          </label>
          <input
            id="vs"
            value={vectorStoreId}
            onChange={(e) => {
              dirty();
              setVectorStoreId(e.target.value);
            }}
            className={monoCls}
            placeholder="vs_..."
          />
        </div>
      </fieldset>

      {/* IA */}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-slate-700">Inteligencia artificial</legend>
        <div>
          <label htmlFor="model" className={labelCls}>
            Modelo
          </label>
          <input
            id="model"
            value={model}
            onChange={(e) => {
              dirty();
              setModel(e.target.value);
            }}
            className={inputCls}
            placeholder="gpt-5.1"
          />
        </div>
        <div>
          <label htmlFor="temp" className={labelCls}>
            Temperatura (0–2)
          </label>
          <input
            id="temp"
            inputMode="decimal"
            value={temperature}
            onChange={(e) => {
              dirty();
              setTemperature(e.target.value);
            }}
            className={inputCls}
            placeholder="0.3"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="prompt" className={labelCls}>
            System prompt
          </label>
          <textarea
            id="prompt"
            value={systemPrompt}
            onChange={(e) => {
              dirty();
              setSystemPrompt(e.target.value);
            }}
            rows={14}
            className={`${inputCls} font-mono leading-relaxed`}
            placeholder="Eres el asesor de ventas de…"
          />
        </div>
      </fieldset>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
        >
          {isPending ? "Guardando…" : agentId ? "Guardar cambios" : "Crear agente"}
        </button>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Cambios guardados
          </span>
        ) : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </form>
  );
}
