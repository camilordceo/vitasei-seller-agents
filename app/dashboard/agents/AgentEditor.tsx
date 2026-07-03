"use client";

import { type FormEvent, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveAgent, createAgent, loadAgentCatalog } from "../actions";
import {
  normalizeCatalogJson,
  validateCatalog,
  type CatalogProductInput,
} from "@/lib/openai/catalog";
import type { CatalogImportResult } from "@/lib/openai/catalogLoader";
import {
  isAgentActiveNow,
  COLOMBIA_HOLIDAYS_2026,
  DEFAULT_TIMEZONE,
  type AgentSchedule,
} from "@/lib/agent/schedule";
import type { AgentEditInput } from "./types";

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";
const monoCls = `${inputCls} font-mono`;
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

type CatalogMode = "create" | "existing";

/** Etiquetas de días de semana (0=Dom … 6=Sáb), como los devuelve `Date.getDay()`. */
const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

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
  scheduleEnabled: boolean;
  scheduleTimezone: string;
  schedule: AgentSchedule;
}

/**
 * Editor de un agente (marca/número): config de IA + credenciales de Callbell + catálogo.
 * Sirve para CREAR (sin `agentId`) o EDITAR. La API key de Callbell es write-only.
 *
 * Catálogo — dos flujos (ver ADR-0028):
 *  - "Crear vector store nuevo": se autogenera el store del agente y se suben los productos
 *    del JSON a OpenAI (`file_search`) y a Supabase.
 *  - "Ya tengo vector store": se pega el `vs_...` y el JSON se carga SOLO a Supabase.
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

  // Horario (encendido/apagado)
  const [scheduleEnabled, setScheduleEnabled] = useState(initial.scheduleEnabled);
  const [scheduleTimezone, setScheduleTimezone] = useState(
    initial.scheduleTimezone || DEFAULT_TIMEZONE,
  );
  const [useWindow, setUseWindow] = useState(initial.schedule.window != null);
  const [windowStart, setWindowStart] = useState(initial.schedule.window?.start ?? "20:00");
  const [windowEnd, setWindowEnd] = useState(initial.schedule.window?.end ?? "08:00");
  const [fullWeekdays, setFullWeekdays] = useState<number[]>(initial.schedule.fullWeekdays);
  const [holidaysText, setHolidaysText] = useState(initial.schedule.holidays.join("\n"));

  const buildSchedule = (): AgentSchedule => ({
    window:
      useWindow && windowStart.trim() && windowEnd.trim()
        ? { start: windowStart.trim(), end: windowEnd.trim() }
        : null,
    fullWeekdays: [...fullWeekdays].sort((a, b) => a - b),
    holidays: holidaysText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
  });

  const toggleWeekday = (d: number) => {
    dirty();
    setFullWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  // Preview "activo ahora" (misma función pura que usa el backend).
  const activeNow = isAgentActiveNow({
    schedule_enabled: scheduleEnabled,
    schedule_timezone: scheduleTimezone,
    schedule: buildSchedule(),
  });

  // Catálogo
  const [catalogMode, setCatalogMode] = useState<CatalogMode>(
    !agentId || !initial.vectorStoreId ? "create" : "existing",
  );
  const [catalogProducts, setCatalogProducts] = useState<CatalogProductInput[] | null>(null);
  const [catalogFilename, setCatalogFilename] = useState<string | null>(null);
  const [catalogInfo, setCatalogInfo] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Estado del envío
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<CatalogImportResult | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const dirty = () => {
    setSaved(false);
    setError(null);
  };

  const clearCatalog = () => {
    setCatalogProducts(null);
    setCatalogFilename(null);
    setCatalogInfo(null);
    setCatalogError(null);
  };

  const onCatalogFile = async (file: File | null) => {
    dirty();
    setResult(null);
    clearCatalog();
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const norm = normalizeCatalogJson(parsed);
      if (norm.errors.length > 0) {
        setCatalogError(norm.errors.slice(0, 3).join(" · "));
        return;
      }
      const { errors } = validateCatalog({ products: norm.products });
      if (errors.length > 0) {
        setCatalogError(`${errors.length} problema(s): ${errors.slice(0, 3).join(" · ")}`);
        return;
      }
      setCatalogProducts(norm.products);
      setCatalogFilename(file.name);
      const fmt = norm.format === "bubble" ? "export Bubble" : "canónico";
      setCatalogInfo(`${norm.products.length} productos detectados (${fmt})`);
    } catch (e) {
      setCatalogError(e instanceof Error ? `JSON inválido: ${e.message}` : "JSON inválido");
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setStatus(null);

    if (catalogError) {
      setError("Corrige el JSON de productos antes de continuar.");
      return;
    }

    const t = Number(temperature.trim());
    const payload: AgentEditInput = {
      name,
      brand,
      country,
      whatsappNumber,
      callbellChannelUuid: channelUuid,
      callbellApiKey: apiKey,
      logisticsTeamUuid: teamUuid,
      // En modo "create" el store se autogenera: guardamos vacío (null) para que el loader lo cree.
      vectorStoreId: catalogMode === "create" ? "" : vectorStoreId,
      model,
      temperature: Number.isFinite(t) ? t : 0.3,
      systemPrompt,
      enabled,
      scheduleEnabled,
      scheduleTimezone: scheduleTimezone.trim() || DEFAULT_TIMEZONE,
      schedule: buildSchedule(),
    };

    const hasCatalog = Boolean(catalogProducts && catalogProducts.length > 0);

    startTransition(async () => {
      try {
        // 1) Crear/guardar el agente.
        let id: string;
        if (agentId) {
          setStatus("Guardando agente…");
          await saveAgent(agentId, payload);
          id = agentId;
        } else {
          setStatus("Creando agente…");
          id = await createAgent(payload);
          if (hasCatalog) setCreatedId(id); // agente ya existe: fija link y evita doble creación
        }

        // 2) Cargar catálogo (si hay).
        if (hasCatalog) {
          setStatus("Cargando catálogo… esto puede tardar 1–2 min.");
          const res = await loadAgentCatalog(id, {
            mode: catalogMode,
            products: catalogProducts!,
            filename: catalogFilename,
          });
          setResult(res);
          setStatus(null);

          if (!res.ok) {
            setError(
              `El agente ${agentId ? "se guardó" : "se creó"}, pero el catálogo falló: ${res.errors.join(" · ")}`,
            );
            if (agentId) router.refresh();
            return;
          }

          if (agentId) {
            setApiKey("");
            setSaved(true);
            router.refresh();
          }
          // Agente nuevo: nos quedamos en el panel de resultado (con link "Abrir agente").
          return;
        }

        // 3) Sin catálogo: comportamiento previo.
        setStatus(null);
        if (agentId) {
          setApiKey("");
          setSaved(true);
          router.refresh();
        } else {
          router.push(`/dashboard/agents/${id}`);
        }
      } catch (err) {
        setStatus(null);
        setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      }
    });
  };

  const keyPlaceholder = initial.hasCallbellApiKey
    ? `•••• ${initial.callbellApiKeyLast4 ?? ""} — deja vacío para conservarla`
    : "Pega la API key de la cuenta de Callbell de esta marca";

  const locked = isPending || createdId !== null;

  const modeBtn = (mode: CatalogMode, label: string) => (
    <button
      type="button"
      onClick={() => {
        dirty();
        setResult(null);
        clearCatalog();
        setCatalogMode(mode);
      }}
      aria-pressed={catalogMode === mode}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        catalogMode === mode
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );

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
      </fieldset>

      {/* Catálogo (productos) */}
      <fieldset className="grid gap-4 rounded-md border border-slate-200 bg-slate-50/60 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">Catálogo (productos)</legend>

        <div className="flex flex-wrap gap-2">
          {modeBtn("create", "Crear vector store nuevo")}
          {modeBtn("existing", "Ya tengo vector store")}
        </div>

        {catalogMode === "existing" ? (
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
            <p className="mt-1 text-xs text-slate-400">
              Pega el vector store que ya armaste en OpenAI. Si subes un JSON abajo, sus productos
              entran <strong>solo a Supabase</strong> (no se re-suben al store).
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Se creará un vector store nuevo para esta marca y se conectará a la IA automáticamente.
            Sube el JSON de productos para cargarlos al store y a Supabase.
          </p>
        )}

        <div>
          <label htmlFor="catalog" className={labelCls}>
            JSON de productos{" "}
            {catalogMode === "create" ? "(para crear el store y cargar productos)" : "(opcional)"}
          </label>
          <input
            id="catalog"
            type="file"
            accept=".json,application/json"
            onChange={(e) => onCatalogFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
          />
          {catalogInfo ? (
            <p className="mt-1 text-xs font-medium text-emerald-700">✓ {catalogInfo}</p>
          ) : null}
          {catalogError ? <p className="mt-1 text-xs text-rose-600">{catalogError}</p> : null}
          <p className="mt-1 text-xs text-slate-400">
            Formatos: export tipo Bubble (ID/Titulo/…) o canónico (sku/name/…). El precio usa{" "}
            <code>PrecioConDescuento</code>.
          </p>
        </div>
      </fieldset>

      {/* Horario (encendido/apagado) */}
      <fieldset className="grid gap-4 rounded-md border border-slate-200 bg-slate-50/60 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">Horario (encendido/apagado)</legend>

        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-slate-500">
            Programa cuándo responde la IA. Con esto <strong>apagado</strong>, el agente responde
            siempre (mientras esté habilitado). Fuera del horario activo, el bot calla y los
            seguimientos/reactivaciones se aplazan.
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={scheduleEnabled}
            aria-label="Programar horario"
            onClick={() => {
              dirty();
              setScheduleEnabled((v) => !v);
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
              scheduleEnabled ? "bg-emerald-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                scheduleEnabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {scheduleEnabled ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-slate-600">Estado ahora:</span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium ${
                  activeNow ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${activeNow ? "bg-emerald-500" : "bg-slate-400"}`}
                  aria-hidden="true"
                />
                {activeNow ? "Activo (responde)" : "Inactivo (calla)"}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="tz" className={labelCls}>
                  Zona horaria
                </label>
                <input
                  id="tz"
                  value={scheduleTimezone}
                  onChange={(e) => {
                    dirty();
                    setScheduleTimezone(e.target.value);
                  }}
                  className={monoCls}
                  placeholder="America/Bogota"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={useWindow}
                  onChange={(e) => {
                    dirty();
                    setUseWindow(e.target.checked);
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                Ventana diaria activa
              </label>
              {useWindow ? (
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="wstart" className={labelCls}>
                      Enciende a las
                    </label>
                    <input
                      id="wstart"
                      type="time"
                      value={windowStart}
                      onChange={(e) => {
                        dirty();
                        setWindowStart(e.target.value);
                      }}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label htmlFor="wend" className={labelCls}>
                      Apaga a las
                    </label>
                    <input
                      id="wend"
                      type="time"
                      value={windowEnd}
                      onChange={(e) => {
                        dirty();
                        setWindowEnd(e.target.value);
                      }}
                      className={inputCls}
                    />
                  </div>
                </div>
              ) : null}
              <p className="mt-1 text-xs text-slate-400">
                Si la hora de apagado es menor que la de encendido, la ventana cruza la medianoche
                (ej. 20:00–08:00 = toda la noche).
              </p>
            </div>

            <div>
              <span className={labelCls}>Días completos activos</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABELS.map((label, d) => {
                  const on = fullWeekdays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleWeekday(d)}
                      aria-pressed={on}
                      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                        on
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Estos días el agente está activo las 24 horas (ej. domingos).
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label htmlFor="holidays" className={labelCls}>
                  Festivos activos (una fecha por línea, AAAA-MM-DD)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    dirty();
                    setHolidaysText(COLOMBIA_HOLIDAYS_2026.join("\n"));
                  }}
                  className="rounded text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900"
                >
                  Cargar festivos Colombia 2026
                </button>
              </div>
              <textarea
                id="holidays"
                value={holidaysText}
                onChange={(e) => {
                  dirty();
                  setHolidaysText(e.target.value);
                }}
                rows={4}
                className={`${inputCls} font-mono`}
                placeholder={"2026-01-01\n2026-01-12"}
              />
              <p className="mt-1 text-xs text-slate-400">
                Estos días el agente está activo las 24 horas. Verifica las fechas del prefill.
              </p>
            </div>
          </>
        ) : null}
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

      {/* Resultado de la carga de catálogo */}
      {result && result.ok ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-medium">Catálogo cargado ✓</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li>{result.rowsImported} productos en Supabase</li>
            {result.vectorStoreId ? (
              <li className="font-mono break-all">vector store: {result.vectorStoreId}</li>
            ) : null}
            {result.warnings.length > 0 ? (
              <li className="text-amber-700">
                {result.warnings.length} aviso(s): {result.warnings.slice(0, 2).join(" · ")}
              </li>
            ) : null}
          </ul>
          {createdId ? (
            <Link
              href={`/dashboard/agents/${createdId}`}
              className="mt-2 inline-block font-medium underline underline-offset-2"
            >
              Abrir agente →
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={locked}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
        >
          {isPending ? "Procesando…" : agentId ? "Guardar cambios" : "Crear agente"}
        </button>
        {status ? <span className="text-sm text-slate-500">{status}</span> : null}
        {saved ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Cambios guardados
          </span>
        ) : null}
        {createdId && !error ? (
          <span className="text-sm font-medium text-emerald-700">Agente creado ✓</span>
        ) : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </form>
  );
}
