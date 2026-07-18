"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveVoiceConfig,
  listSynthflowVoices,
  syncVoiceToSynthflow,
  syncWebhookToSynthflow,
} from "../actions";
import type { VoiceConfigInput } from "./types";
import type { SynthflowVoice } from "@/lib/synthflow/types";
import { describeDelay, MAX_VOICE_STAGES, normalizeIdentifier } from "@/lib/agent/voiceCallPlan";
import { Collapsible } from "../Collapsible";

/**
 * Editor de la IA de llamadas de un agente (docs/25, ADR-0060..0063):
 * cadencia, prompt de voz, voz, países y extractores de información.
 */

interface StageDraft {
  /** En minutos, como lo guarda la config. */
  delayMinutes: number;
  guidance: string;
}

interface ExtractorDraft {
  identifier: string;
  type: string;
  condition: string;
  choices: string;
  examples: string;
  actionId?: string | null;
}

const field =
  "min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
const primary =
  "min-h-[40px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:bg-slate-300";
const secondary =
  "min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60";

/** Presets de cadencia: los dos ejemplos que pidió el negocio. */
const PRESETS: Array<{ label: string; stages: StageDraft[] }> = [
  { label: "1 llamada a los 10 min", stages: [{ delayMinutes: 10, guidance: "" }] },
  {
    label: "3 llamadas: al llegar, 24h y 72h",
    stages: [
      { delayMinutes: 0, guidance: "" },
      { delayMinutes: 1440, guidance: "" },
      { delayMinutes: 4320, guidance: "" },
    ],
  },
];

export function VoiceSettings({
  agentId,
  initial,
  defaultWebhookUrl,
}: {
  agentId: string;
  initial: VoiceConfigInput;
  defaultWebhookUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(initial.voiceEnabled);
  const [modelId, setModelId] = useState(initial.modelId);
  const [fromNumber, setFromNumber] = useState(initial.fromNumber);
  const [apiKey, setApiKey] = useState("");
  // Prellenado con la URL de esta app: lo normal es solo pulsar "Apuntar".
  const [webhookUrl, setWebhookUrl] = useState(defaultWebhookUrl);
  const [voiceId, setVoiceId] = useState(initial.voiceId);
  const [voiceName, setVoiceName] = useState(initial.voiceName);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [greeting, setGreeting] = useState(initial.greeting);
  const [countries, setCountries] = useState(initial.countries.join(", "));
  const [stopWhenAnswered, setStopWhenAnswered] = useState(initial.stopWhenAnswered);
  const [stages, setStages] = useState<StageDraft[]>(
    initial.stages.map((s) => ({ delayMinutes: s.delayMinutes, guidance: s.guidance ?? "" })),
  );
  const [extractors, setExtractors] = useState<ExtractorDraft[]>(
    initial.extractors.map((e) => ({
      identifier: e.identifier,
      type: e.type,
      condition: e.condition,
      choices: e.choices.join(", "),
      examples: e.examples.join(", "),
      actionId: e.actionId ?? null,
    })),
  );

  const [voices, setVoices] = useState<SynthflowVoice[]>([]);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);

  const dirty = () => setStatus(null);

  function loadVoices() {
    dirty();
    startTransition(async () => {
      const result = await listSynthflowVoices(agentId, voiceSearch || undefined);
      if (result.error) setStatus({ kind: "error", text: result.error });
      setVoices(result.voices);
    });
  }

  function save() {
    setStatus(null);
    const payload: VoiceConfigInput = {
      voiceEnabled: enabled,
      modelId: modelId.trim(),
      fromNumber: fromNumber.trim(),
      voiceId: voiceId.trim(),
      voiceName: voiceName.trim(),
      prompt,
      greeting,
      apiKey,
      stages: stages.map((s) => ({
        delayMinutes: s.delayMinutes,
        guidance: s.guidance.trim() || null,
      })),
      countries: countries
        .split(/[,\s]+/)
        .map((c) => c.replace(/\D/g, ""))
        .filter(Boolean),
      extractors: extractors.map((e) => ({
        identifier: normalizeIdentifier(e.identifier),
        type: e.type,
        condition: e.condition,
        choices: e.choices.split(",").map((c) => c.trim()).filter(Boolean),
        examples: e.examples.split(",").map((c) => c.trim()).filter(Boolean),
        actionId: e.actionId ?? null,
      })),
      stopWhenAnswered,
    };

    startTransition(async () => {
      try {
        const result = await saveVoiceConfig(agentId, payload);
        setApiKey("");
        setStatus(
          result.warning
            ? { kind: "warn", text: result.warning }
            : { kind: "ok", text: "Config de llamadas guardada." },
        );
        router.refresh();
      } catch (e) {
        setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  function syncWebhook() {
    setStatus(null);
    startTransition(async () => {
      const result = await syncWebhookToSynthflow(agentId, webhookUrl);
      setStatus(
        result.ok
          ? { kind: "ok", text: `Webhook del assistant apuntado a ${result.url}.` }
          : { kind: "error", text: result.error ?? "No se pudo apuntar el webhook." },
      );
    });
  }

  function syncVoice() {
    setStatus(null);
    startTransition(async () => {
      const result = await syncVoiceToSynthflow(agentId);
      setStatus(
        result.ok
          ? { kind: "ok", text: "Voz sincronizada con Synthflow." }
          : { kind: "error", text: result.error ?? "No se pudo sincronizar." },
      );
    });
  }

  return (
    // Plegable y CERRADA por defecto: la config de voz es larga y en el día a día
    // se toca poco. El badge del encabezado dice si está activada sin abrirla.
    <Collapsible
      title="Llamadas con IA"
      subtitle="Synthflow. El prompt de voz es independiente del de WhatsApp y viaja en cada llamada."
      badge={enabled ? "Activadas" : "Apagadas"}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-prose text-sm text-slate-500">
            El agente llama por teléfono con Synthflow. El prompt de voz es{" "}
            <strong>independiente</strong> del de WhatsApp y se envía en cada llamada, así que el
            prompt que se ve en el panel de Synthflow no es el que corre.
          </p>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                dirty();
              }}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-teal-500"
            />
            Activadas
          </label>
        </div>

      {/* --- Conexión --------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Assistant de Synthflow</span>
          <input
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value);
              dirty();
            }}
            placeholder="model_id del assistant"
            className={`mt-1 ${field} font-mono`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Usa un assistant <strong>dedicado a este agente</strong>: se le adjuntan los
            extractores de abajo.
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Número saliente</span>
          <input
            value={fromNumber}
            onChange={(e) => {
              setFromNumber(e.target.value);
              dirty();
            }}
            placeholder="+576015110375"
            className={`mt-1 ${field} font-mono`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            En E.164 <strong>con +</strong> (Synthflow lo exige así).
          </span>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">API key de Synthflow</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              dirty();
            }}
            placeholder="Dejar vacío para no cambiarla"
            autoComplete="off"
            className={`mt-1 ${field} font-mono`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Opcional: si se deja vacía se usa la del entorno.
          </span>
        </label>
        <div className="sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Webhook post-llamada</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={webhookUrl}
              onChange={(e) => {
                setWebhookUrl(e.target.value);
                dirty();
              }}
              placeholder={defaultWebhookUrl}
              className={`${field} min-w-0 flex-1 font-mono`}
            />
            <button type="button" onClick={syncWebhook} disabled={pending} className={secondary}>
              {pending ? "Apuntando…" : "Apuntar assistant aquí"}
            </button>
          </div>
          <span className="mt-1 block text-xs text-slate-500">
            Escribe el <code>external_webhook_url</code> del assistant en Synthflow para que nos
            avise apenas termina cada llamada. Ya viene con la URL correcta de esta app: solo
            pulsa el botón. Usa el assistant <strong>guardado</strong> (si cambiaste el model_id,
            guarda primero). Es opcional: sin webhook el sistema se entera igual por el cron,
            solo con más latencia.
          </span>
        </div>
      </div>

      {/* --- Voz --------------------------------------------------------- */}
      <div className="space-y-2 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Voz</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs text-slate-500">Buscar voz</span>
            <input
              value={voiceSearch}
              onChange={(e) => setVoiceSearch(e.target.value)}
              placeholder="nombre…"
              className={`mt-1 w-48 ${field}`}
            />
          </label>
          <button type="button" onClick={loadVoices} disabled={pending} className={secondary}>
            {pending ? "Cargando…" : "Cargar voces"}
          </button>
          {voiceId ? (
            <button type="button" onClick={syncVoice} disabled={pending} className={secondary}>
              Sincronizar voz con Synthflow
            </button>
          ) : null}
        </div>

        {voices.length > 0 ? (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
            <ul className="divide-y divide-slate-100">
              {voices.map((v) => (
                <li
                  key={v.voice_id}
                  className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${
                    v.voice_id === voiceId ? "bg-slate-50" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setVoiceId(v.voice_id);
                      setVoiceName(v.name);
                      dirty();
                    }}
                    className="min-w-0 flex-1 truncate text-left font-medium text-slate-800 hover:underline"
                  >
                    {v.name}
                  </button>
                  <span className="text-xs text-slate-400">
                    {[v.gender, (v.languages ?? []).slice(0, 3).join("/")].filter(Boolean).join(" · ")}
                  </span>
                  {v.preview ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <audio controls preload="none" src={v.preview} className="h-8 w-40" />
                  ) : null}
                  {v.voice_id === voiceId ? (
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">
                      Elegida
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-slate-500">
          Voz actual:{" "}
          {voiceId ? (
            <span className="font-mono text-slate-700">{voiceName || voiceId}</span>
          ) : (
            "ninguna (usa la del assistant en Synthflow)"
          )}
        </p>
      </div>

      {/* --- Cerebro ------------------------------------------------------ */}
      <div className="space-y-3 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Cerebro de la llamada</h3>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Saludo de apertura</span>
          <input
            value={greeting}
            onChange={(e) => {
              setGreeting(e.target.value);
              dirty();
            }}
            placeholder="Hola, soy Ana de Vitasei. ¿Tienes un minuto?"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Prompt de voz</span>
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              dirty();
            }}
            rows={8}
            placeholder="Eres Ana, asesora de Vitasei. Hablas claro y corto, una pregunta a la vez…"
            className={`mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Se le agrega automáticamente el contexto de la conversación de WhatsApp (nombre,
            producto, últimos mensajes).
          </span>
        </label>
      </div>

      {/* --- Cadencia ------------------------------------------------------ */}
      <div className="space-y-3 border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">
            Cadencia ({stages.length}/{MAX_VOICE_STAGES})
          </h3>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setStages(preset.stages.map((s) => ({ ...s })));
                  dirty();
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Los tiempos se cuentan desde el <strong>primer mensaje</strong> del cliente, no en
          cascada. A diferencia de los seguimientos por WhatsApp, aquí <strong>no aplica</strong>{" "}
          la ventana de 24 horas.
        </p>

        {stages.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
            Sin etapas: no se agenda ninguna llamada automática.
          </p>
        ) : (
          <ul className="space-y-2">
            {stages.map((stage, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-200 p-2.5">
                <span className="mt-2 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {i + 1}
                </span>
                <label className="block w-32 shrink-0">
                  <span className="text-xs text-slate-500">Minutos</span>
                  <input
                    type="number"
                    min={0}
                    value={stage.delayMinutes}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setStages((prev) =>
                        prev.map((s, idx) =>
                          idx === i ? { ...s, delayMinutes: Number.isFinite(v) ? v : 0 } : s,
                        ),
                      );
                      dirty();
                    }}
                    className={`mt-1 ${field}`}
                  />
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {describeDelay(stage.delayMinutes)}
                  </span>
                </label>
                <label className="block min-w-0 flex-1">
                  <span className="text-xs text-slate-500">Objetivo de esta llamada (opcional)</span>
                  <input
                    value={stage.guidance}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStages((prev) =>
                        prev.map((s, idx) => (idx === i ? { ...s, guidance: v } : s)),
                      );
                      dirty();
                    }}
                    placeholder="Cerrar la venta, resolver dudas de envío…"
                    className={`mt-1 ${field}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setStages((prev) => prev.filter((_, idx) => idx !== i));
                    dirty();
                  }}
                  className="mt-6 shrink-0 text-sm text-slate-500 underline-offset-2 hover:text-red-700 hover:underline"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        {stages.length < MAX_VOICE_STAGES ? (
          <button
            type="button"
            onClick={() => {
              setStages((prev) => [...prev, { delayMinutes: 60, guidance: "" }]);
              dirty();
            }}
            className={secondary}
          >
            Agregar etapa
          </button>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Países habilitados</span>
            <input
              value={countries}
              onChange={(e) => {
                setCountries(e.target.value);
                dirty();
              }}
              placeholder="57"
              className={`mt-1 ${field} font-mono`}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Prefijos E.164 separados por coma (Colombia = 57). Vacío = todos.
            </span>
          </label>
          <label className="flex items-start gap-2 pt-6 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={stopWhenAnswered}
              onChange={(e) => {
                setStopWhenAnswered(e.target.checked);
                dirty();
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-teal-500"
            />
            <span>
              Dejar de llamar si ya contestó
              <span className="block text-xs text-slate-500">
                El objetivo es hablar con él, no llamarlo tres veces.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* --- Extractores --------------------------------------------------- */}
      <div className="space-y-3 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">
          Datos a extraer de la llamada ({extractors.length})
        </h3>
        <p className="text-xs text-slate-500">
          Se sincronizan con Synthflow al guardar. Escribe las instrucciones en{" "}
          <strong>texto plano</strong>: pedir JSON o usar llaves/corchetes puede dejar la llamada
          colgada.
        </p>

        {extractors.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
            Sin extractores configurados.
          </p>
        ) : (
          <ul className="space-y-2">
            {extractors.map((ex, i) => (
              <li key={i} className="space-y-2 rounded-lg border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block w-44">
                    <span className="text-xs text-slate-500">Identificador</span>
                    <input
                      value={ex.identifier}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtractors((prev) =>
                          prev.map((x, idx) => (idx === i ? { ...x, identifier: v } : x)),
                        );
                        dirty();
                      }}
                      placeholder="metodo_pago"
                      className={`mt-1 ${field} font-mono`}
                    />
                  </label>
                  <label className="block w-40">
                    <span className="text-xs text-slate-500">Tipo</span>
                    <select
                      value={ex.type}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtractors((prev) =>
                          prev.map((x, idx) => (idx === i ? { ...x, type: v } : x)),
                        );
                        dirty();
                      }}
                      className={`mt-1 ${field}`}
                    >
                      <option value="OPEN_QUESTION">Respuesta abierta</option>
                      <option value="SINGLE_CHOICE">Opción única</option>
                      <option value="YES_NO">Sí / No</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setExtractors((prev) => prev.filter((_, idx) => idx !== i));
                      dirty();
                    }}
                    className="mb-2 text-sm text-slate-500 underline-offset-2 hover:text-red-700 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
                <label className="block">
                  <span className="text-xs text-slate-500">Qué extraer</span>
                  <input
                    value={ex.condition}
                    onChange={(e) => {
                      const v = e.target.value;
                      setExtractors((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, condition: v } : x)),
                      );
                      dirty();
                    }}
                    placeholder="Metodo de pago que prefiere el cliente"
                    className={`mt-1 ${field}`}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">
                    {ex.type === "SINGLE_CHOICE" ? "Opciones (coma)" : "Ejemplos (coma)"}
                  </span>
                  <input
                    value={ex.type === "SINGLE_CHOICE" ? ex.choices : ex.examples}
                    onChange={(e) => {
                      const v = e.target.value;
                      setExtractors((prev) =>
                        prev.map((x, idx) =>
                          idx === i
                            ? ex.type === "SINGLE_CHOICE"
                              ? { ...x, choices: v }
                              : { ...x, examples: v }
                            : x,
                        ),
                      );
                      dirty();
                    }}
                    placeholder={
                      ex.type === "SINGLE_CHOICE"
                        ? "contra entrega, transferencia, Addi"
                        : "Calle 145 #20-30, Bogota"
                    }
                    className={`mt-1 ${field}`}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => {
            setExtractors((prev) => [
              ...prev,
              { identifier: "", type: "OPEN_QUESTION", condition: "", choices: "", examples: "" },
            ]);
            dirty();
          }}
          className={secondary}
        >
          Agregar dato a extraer
        </button>
      </div>

      {/* --- Guardar -------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <button type="button" onClick={save} disabled={pending} className={primary}>
          {pending ? "Guardando…" : "Guardar llamadas"}
        </button>
        {status ? (
          <p
            className={`text-sm ${
              status.kind === "ok"
                ? "text-emerald-700"
                : status.kind === "warn"
                  ? "text-amber-700"
                  : "text-red-700"
            }`}
          >
            {status.text}
          </p>
        ) : null}
        </div>
      </div>
    </Collapsible>
  );
}
