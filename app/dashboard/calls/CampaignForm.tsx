"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCampaign, previewCampaignFile, type CampaignPreview } from "../actions";
import { btnPrimary, btnSecondary, Card, CardTitle, inputCls } from "../ui-kit";
import { describeCampaignDuration } from "@/lib/agent/voiceCampaignPlan";
import {
  missingVariables,
  normalizeVariableKey,
  renderTemplate,
  templateVariables,
} from "@/lib/agent/voiceTemplate";

/**
 * Cargar una lista y lanzar llamadas a ritmo (docs/29, ADR-0084).
 *
 * El formulario obliga a un paso intermedio —**revisar** antes de crear— porque
 * lo que sale de aquí son llamadas a personas reales: primero se muestra cuántos
 * números entendimos, cuáles no y cuánto va a durar la campaña, y solo después
 * se habilita el botón de lanzar.
 */

interface AgentOption {
  id: string;
  name: string;
  country: string | null;
  /** Saludo de voz del agente: el punto de partida del de la campaña (ADR-0086). */
  voiceGreeting?: string | null;
}

/** Variable fija de la campaña: un valor para toda la lista. */
interface FixedVar {
  key: string;
  value: string;
}

/** Indicativo por país del agente, para los números escritos en local. */
const COUNTRY_PREFIX: Record<string, string> = {
  CO: "57",
  MX: "52",
  US: "1",
  PE: "51",
  CL: "56",
  EC: "593",
  AR: "54",
  ES: "34",
  PA: "507",
  CR: "506",
};

/** Bytes → base64 sin reventar la pila con archivos grandes. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const MAX_FILE_BYTES = 1_000_000; // 1 MB: de sobra para miles de números

export function CampaignForm({ agents }: { agents: AgentOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [name, setName] = useState("");
  const [interval, setIntervalMinutes] = useState(2);
  const [prefix, setPrefix] = useState(COUNTRY_PREFIX[agents[0]?.country ?? "CO"] ?? "57");
  const [guidance, setGuidance] = useState("");
  const [startAt, setStartAt] = useState("");
  const [greeting, setGreeting] = useState(agents[0]?.voiceGreeting ?? "");
  const [fixedVars, setFixedVars] = useState<FixedVar[]>([]);
  const [fileBase64, setFileBase64] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  /** Variables fijas con la clave ya canonizada (`Producto` → `producto`). */
  const fixedMap: Record<string, string> = {};
  for (const v of fixedVars) {
    const key = normalizeVariableKey(v.key);
    if (key && v.value.trim()) fixedMap[key] = v.value.trim();
  }

  // Lo que el saludo y el objetivo piden, y de dónde puede salir.
  const usedVars = templateVariables([greeting, guidance].filter(Boolean).join("\n"));
  const fileVarKeys = new Set((preview?.variables ?? []).map((v) => v.key));

  /**
   * Filas que van a quedar cojas: usan una variable que ni el archivo ni las
   * fijas llenan. Se cuenta sobre la muestra que devolvió el servidor y, si el
   * archivo entero no trae la columna, sobre el total.
   */
  const gaps = usedVars
    // `{nombre}` no bloquea: sin nombre, "Hola, soy Vanessa" se lee natural. El
    // servidor aplica el mismo criterio (si no, "Lanzar" se habilitaría y luego
    // el servidor diría que no).
    .filter((key) => key !== "nombre" && !fixedMap[key])
    .map((key) => {
      const stat = preview?.variables.find((v) => v.key === key);
      const missing = (preview?.count ?? 0) - (stat?.filled ?? 0);
      return { key, missing, inFile: fileVarKeys.has(key) };
    })
    .filter((g) => g.missing > 0);

  // El saludo YA resuelto con la primera fila real del archivo: la única forma
  // honesta de contestar "¿qué va a decir el bot?" antes de llamar a nadie.
  const sampleRow = preview?.sample[0];
  const greetingPreview = greeting.trim()
    ? renderTemplate(
        greeting,
        { nombre: sampleRow?.name ?? "", ...fixedMap, ...(sampleRow?.variables ?? {}) },
        { onMissing: "keep" },
      )
    : "";
  const previewIncomplete = greetingPreview
    ? missingVariables(greeting, {
        nombre: sampleRow?.name ?? "",
        ...fixedMap,
        ...(sampleRow?.variables ?? {}),
      }).length > 0
    : false;

  function reset() {
    setFileBase64("");
    setFilename(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(file: File | undefined) {
    setStatus(null);
    setPreview(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus({ kind: "error", text: "El archivo pesa más de 1 MB. Súbelo por partes." });
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = toBase64(bytes);
    setFileBase64(base64);
    setFilename(file.name);
    if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ""));

    startTransition(async () => {
      const result = await previewCampaignFile(base64, file.name, prefix);
      setPreview(result);
      if (result.error) setStatus({ kind: "error", text: result.error });
    });
  }

  function reparse() {
    if (!fileBase64) return;
    setStatus(null);
    startTransition(async () => {
      const result = await previewCampaignFile(fileBase64, filename, prefix);
      setPreview(result);
      if (result.error) setStatus({ kind: "error", text: result.error });
    });
  }

  function launch() {
    if (!preview?.ok || !agentId) return;
    setStatus(null);
    startTransition(async () => {
      const result = await createCampaign({
        agentId,
        name,
        intervalMinutes: interval,
        countryPrefix: prefix,
        guidance,
        greeting,
        variables: fixedMap,
        startAt: startAt ? new Date(startAt).toISOString() : "",
        filename,
        fileBase64,
      });
      if (!result.ok) {
        setStatus({ kind: "error", text: result.error ?? "No se pudo crear la campaña." });
        return;
      }
      setStatus({
        kind: "ok",
        text:
          `Campaña creada: ${result.inserted} llamadas agendadas` +
          (result.skipped ? ` · ${result.skipped} omitidas (ya tenían llamada en curso)` : "") +
          ".",
      });
      reset();
      setName("");
      setGuidance("");
      router.refresh();
    });
  }

  if (agents.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-500">
          No hay agentes configurados. Crea uno y actívale las llamadas con IA.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle
        title="Nueva campaña"
        subtitle="Sube un CSV o Excel con los números y define cada cuánto sale una llamada."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Agente que llama</span>
          <select
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
              const agent = agents.find((a) => a.id === e.target.value);
              setPrefix(COUNTRY_PREFIX[agent?.country ?? "CO"] ?? "57");
              // El saludo arranca en el del agente elegido, salvo que ya lo hayan
              // escrito a mano (no se pisa lo que el operador redactó).
              setGreeting((current) => {
                const previous = agents.find((a) => a.id === agentId)?.voiceGreeting ?? "";
                return current.trim() === "" || current === previous
                  ? (agent?.voiceGreeting ?? "")
                  : current;
              });
            }}
            className={`mt-1 ${inputCls}`}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Usa su voz, su prompt de llamada y sus extractores.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Nombre de la campaña</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Base de octubre"
            className={`mt-1 ${inputCls}`}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Una llamada cada</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={1440}
              value={interval}
              onChange={(e) => setIntervalMinutes(Math.max(1, Number(e.target.value) || 1))}
              className={`${inputCls} w-28`}
            />
            <span className="text-sm text-slate-500">minutos</span>
          </div>
          <span className="mt-1 block text-xs text-slate-500">
            El sistema revisa cada minuto: el ritmo real puede variar ~1 minuto.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Indicativo del país</span>
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ""))}
            onBlur={reparse}
            placeholder="57"
            className={`mt-1 ${inputCls} w-28 font-mono`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Se le antepone a los números escritos en local (10 dígitos o menos).
          </span>
        </label>

        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Saludo con el que abre</span>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={2}
            placeholder="Hola, soy Vanessa de Vitasei. Te llamaba porque estabas interesado en {producto}, ¿tienes un minuto?"
            className="mt-1 w-full rounded-[10px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Lo que dice al contestar. Usa <code className="font-mono">{"{llaves}"}</code> para los
            datos de cada persona: <code className="font-mono">{"{nombre}"}</code> y cualquier
            columna del archivo (<code className="font-mono">{"{producto}"}</code>). Vacío = el
            saludo del agente.
          </span>
        </label>

        <div className="block sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Valores fijos de la campaña</span>
          <p className="mt-0.5 text-xs text-slate-500">
            Para lo que es igual en toda la lista: en vez de repetir una columna{" "}
            <code className="font-mono">producto</code> con &ldquo;Colágeno&rdquo; en 500 filas, se
            pone aquí una vez. Si el archivo trae la columna, <strong>manda el archivo</strong>.
          </p>
          {fixedVars.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {fixedVars.map((v, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    value={v.key}
                    onChange={(e) =>
                      setFixedVars((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)),
                      )
                    }
                    placeholder="producto"
                    aria-label="Nombre de la variable"
                    className={`${inputCls} w-40 font-mono`}
                  />
                  <span className="text-sm text-slate-400">=</span>
                  <input
                    value={v.value}
                    onChange={(e) =>
                      setFixedVars((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)),
                      )
                    }
                    placeholder="Colágeno hidrolizado"
                    aria-label="Valor de la variable"
                    className={`${inputCls} min-w-0 flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => setFixedVars((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-sm text-slate-500 underline-offset-2 hover:text-red-700 hover:underline"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => setFixedVars((prev) => [...prev, { key: "", value: "" }])}
            className={`mt-2 ${btnSecondary}`}
          >
            Agregar valor fijo
          </button>
        </div>

        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Objetivo de la llamada</span>
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            rows={3}
            placeholder="Ofrecer el combo de colágeno con envío gratis y cerrar la venta contra entrega."
            className={`mt-1 w-full rounded-[10px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Se suma al prompt de voz del agente en cada llamada de esta campaña.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Empezar</span>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className={`mt-1 ${inputCls}`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Vacío = arranca de inmediato (respetando el horario del agente).
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Archivo con los números</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,.xlsx"
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:min-h-[40px] file:rounded-[10px] file:border-0 file:bg-slate-900 file:px-4 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
          />
          <span className="mt-1 block text-xs text-slate-500">
            CSV o Excel (.xlsx). Una columna <strong>teléfono</strong> y, si quieres,{" "}
            <strong>nombre</strong>. Las demás columnas viajan como variables. Si exportas a CSV y
            Excel te muestra los teléfonos como <code className="font-mono">5,73E+11</code>, dale{" "}
            <strong>formato de texto</strong> a esa columna antes de exportar.
          </span>
        </label>
      </div>

      {preview ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-800">
            {preview.count} número{preview.count === 1 ? "" : "s"} listo
            {preview.count === 1 ? "" : "s"} para llamar
            {preview.count > 0 ? (
              <span className="font-normal text-slate-500">
                {" "}
                · dura {describeCampaignDuration(preview.count, interval)} a este ritmo
              </span>
            ) : null}
          </p>
          {preview.sample.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
              {preview.sample.map((s) => (
                <li key={s.phone} className="font-mono">
                  +{s.phone}
                  {s.name ? <span className="font-sans text-slate-500"> · {s.name}</span> : null}
                </li>
              ))}
              {preview.count > preview.sample.length ? (
                <li className="text-slate-400">…y {preview.count - preview.sample.length} más</li>
              ) : null}
            </ul>
          ) : null}
          {preview.duplicates > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              {preview.duplicates} repetido(s) en el archivo: se llama una sola vez.
            </p>
          ) : null}

          {preview.variables.length > 0 ? (
            <div className="mt-3 border-t border-slate-200 pt-2">
              <p className="text-xs font-medium text-slate-600">
                Variables que trae el archivo (úsalas entre llaves):
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {preview.variables.map((v) => (
                  <li
                    key={v.key}
                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600"
                    title={`Columna "${v.column}" · ${v.filled} de ${preview.count} filas · ej: ${v.sample ?? "—"}`}
                  >
                    <code className="font-mono">{`{${v.key}}`}</code>
                    <span className="ml-1 text-slate-400">
                      {v.filled}/{preview.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {greetingPreview ? (
            <div className="mt-3 border-t border-slate-200 pt-2">
              <p className="text-xs font-medium text-slate-600">
                Va a abrir así {sampleRow?.name ? `(con ${sampleRow.name})` : "(primera fila)"}:
              </p>
              <p
                className={`mt-1 rounded-lg border px-3 py-2 text-sm ${
                  previewIncomplete
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-white text-slate-800"
                }`}
              >
                “{greetingPreview}”
              </p>
            </div>
          ) : null}

          {gaps.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-medium text-amber-900">
                Faltan datos para el texto que escribiste:
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                {gaps.map((g) => (
                  <li key={g.key}>
                    <code className="font-mono">{`{${g.key}}`}</code>{" "}
                    {g.inFile
                      ? `está vacía en ${g.missing} de ${preview.count} filas`
                      : `no existe en el archivo (${g.missing} llamadas la necesitan)`}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-amber-800">
                Agrega la columna, ponle un valor fijo arriba, o quita la variable del texto. No se
                lanza hasta que cuadre: una llamada con la frase a medias ya no se puede deshacer.
              </p>
            </div>
          ) : null}
          {preview.invalid.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-amber-700">
                {preview.invalid.length} fila(s) no se pudieron usar
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                {preview.invalid.map((inv) => (
                  <li key={`${inv.line}-${inv.value}`}>
                    Línea {inv.line}: {inv.value || "(vacía)"} — {inv.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={launch}
          disabled={pending || !preview?.ok || gaps.length > 0}
          title={
            gaps.length > 0
              ? "El saludo u objetivo usa variables que no están llenas en todas las filas."
              : undefined
          }
          className={btnPrimary}
        >
          {pending ? "Trabajando…" : `Lanzar ${preview?.count ?? ""} llamadas`.trim()}
        </button>
        {fileBase64 ? (
          <button type="button" onClick={reset} disabled={pending} className={btnSecondary}>
            Quitar archivo
          </button>
        ) : null}
        {status ? (
          <p className={`text-sm ${status.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}>
            {status.text}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
