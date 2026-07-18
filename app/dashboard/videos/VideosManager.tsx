"use client";

import { useMemo, useState, useTransition } from "react";
import { createVideo, updateVideo, deleteVideo, setVideoEnabled } from "../actions";
import type { VideoRow } from "@/lib/dashboard/queries";

const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500";
const selectCls = `${inputCls} bg-white`;

export type AgentMarketOption = {
  id: string;
  name: string;
  brand: string | null;
  country: string | null;
};

/**
 * `agents.country` es texto libre (se guarda el código: "CO", "MX", "US"). Aquí se
 * traduce al nombre del país para que el equipo elija por PAÍS y no por sigla. Si el
 * código no está en la lista, se muestra tal cual.
 */
const COUNTRY_NAMES: Record<string, string> = {
  co: "Colombia",
  mx: "México",
  us: "Estados Unidos",
  ec: "Ecuador",
  pe: "Perú",
  cl: "Chile",
  ar: "Argentina",
  pa: "Panamá",
  cr: "Costa Rica",
  es: "España",
};

function countryLabel(country: string | null): string | null {
  const c = country?.trim();
  if (!c) return null;
  return COUNTRY_NAMES[c.toLowerCase()] ?? c;
}

/** "Vitasei CO · Colombia" — cómo se ve un agente en los selects y en la lista. */
function agentLabel(a: AgentMarketOption): string {
  const country = countryLabel(a.country);
  return country ? `${a.name} · ${country}` : a.name;
}

/** Etiqueta del mercado de un video (null = global). */
function marketLabel(agentId: string | null, agents: AgentMarketOption[]): string {
  if (!agentId) return "Global";
  const a = agents.find((x) => x.id === agentId);
  if (!a) return "Mercado desconocido";
  return agentLabel(a);
}

/** Agentes agrupados por país (los que no tienen país, al final en "Sin país"). */
function groupByCountry(agents: AgentMarketOption[]): { country: string; agents: AgentMarketOption[] }[] {
  const groups = new Map<string, AgentMarketOption[]>();
  for (const a of agents) {
    const key = countryLabel(a.country) ?? "Sin país";
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }
  return [...groups.entries()]
    .map(([country, list]) => ({ country, agents: list }))
    .sort((x, y) =>
      x.country === "Sin país" ? 1 : y.country === "Sin país" ? -1 : x.country.localeCompare(y.country),
    );
}

/**
 * Opciones del <select> de mercado: Global + los agentes AGRUPADOS POR PAÍS. Se elige
 * el agente (no el país) porque un país puede tener más de una marca/número, y el
 * envío es por agente. Ver ADR-0050.
 */
function MarketOptions({ agents }: { agents: AgentMarketOption[] }) {
  return (
    <>
      <option value="">Global (todos los países)</option>
      {groupByCountry(agents).map((g) => (
        <optgroup key={g.country} label={g.country}>
          {g.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {agentLabel(a)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

export function VideosManager({
  initial,
  agents,
}: {
  initial: VideoRow[];
  agents: AgentMarketOption[];
}) {
  const [videos, setVideos] = useState<VideoRow[]>(initial);
  const [keyword, setKeyword] = useState("");
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [agentId, setAgentId] = useState(""); // "" = global
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Filtro por mercado de la lista: "all" | "global" | <agentId>.
  const [filter, setFilter] = useState<string>("all");

  // Estado de edición inline.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKeyword, setEditKeyword] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [editAgentId, setEditAgentId] = useState("");

  const shown = useMemo(
    () =>
      videos.filter((v) =>
        filter === "all"
          ? true
          : filter === "global"
            ? v.agentId === null
            : v.agentId === filter,
      ),
    [videos, filter],
  );

  const handleCreate = () => {
    const kw = keyword.trim();
    const u = url.trim();
    const cap = caption.trim();
    if (!kw || !u) return;
    startTransition(async () => {
      try {
        const id = await createVideo(kw, u, cap, agentId || null);
        setVideos((prev) => [
          {
            id,
            agentId: agentId || null,
            keyword: kw,
            videoUrl: u,
            caption: cap || null,
            enabled: true,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setKeyword("");
        setUrl("");
        setCaption("");
        // El mercado se conserva: es común cargar varios videos del mismo mercado seguidos.
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al crear el video");
      }
    });
  };

  const startEdit = (v: VideoRow) => {
    setEditingId(v.id);
    setEditKeyword(v.keyword);
    setEditUrl(v.videoUrl);
    setEditCaption(v.caption ?? "");
    setEditAgentId(v.agentId ?? "");
    setError(null);
  };

  const cancelEdit = () => setEditingId(null);

  const handleSaveEdit = (id: string) => {
    const kw = editKeyword.trim();
    const u = editUrl.trim();
    const cap = editCaption.trim();
    if (!kw || !u) return;
    startTransition(async () => {
      try {
        await updateVideo(id, { keyword: kw, videoUrl: u, caption: cap, agentId: editAgentId || null });
        setVideos((prev) =>
          prev.map((x) =>
            x.id === id
              ? { ...x, keyword: kw, videoUrl: u, caption: cap || null, agentId: editAgentId || null }
              : x,
          ),
        );
        setEditingId(null);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar el video");
      }
    });
  };

  const handleToggle = (v: VideoRow) => {
    startTransition(async () => {
      try {
        await setVideoEnabled(v.id, !v.enabled);
        setVideos((prev) => prev.map((x) => (x.id === v.id ? { ...x, enabled: !x.enabled } : x)));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al actualizar el video");
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteVideo(id);
        setVideos((prev) => prev.filter((x) => x.id !== id));
        if (editingId === id) setEditingId(null);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al eliminar el video");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Formulario: agregar palabra → video (+ mercado + caption opcional) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Agregar video</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Cuando la respuesta del bot mencione la palabra, enviará este video después del mensaje.
          Elige el <strong>mercado (país)</strong>: el video sale <strong>solo</strong> en las
          conversaciones de ese agente. Si además existe un video <strong>global</strong> con la
          misma palabra, gana el del mercado (nunca se envían los dos). El caption (opcional) va
          pegado al video.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="kw" className="text-xs font-medium text-slate-600">
              Palabra clave
            </label>
            <input
              id="kw"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="magnesio"
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div>
            <label htmlFor="url" className="text-xs font-medium text-slate-600">
              URL del video (.mp4 público)
            </label>
            <input
              id="url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/magnesio.mp4"
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div>
            <label htmlFor="market" className="text-xs font-medium text-slate-600">
              Mercado / país
            </label>
            <select
              id="market"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className={`mt-1 ${selectCls}`}
            >
              <MarketOptions agents={agents} />
            </select>
          </div>
          <div>
            <label htmlFor="cap" className="text-xs font-medium text-slate-600">
              Caption (opcional)
            </label>
            <input
              id="cap"
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Mira acá los beneficios del colágeno"
              className={`mt-1 ${inputCls}`}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={handleCreate}
            disabled={isPending || !keyword.trim() || !url.trim()}
            className="h-11 rounded-md bg-slate-900 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
          >
            {isPending ? "Guardando…" : "Agregar"}
          </button>
        </div>
        {error && !editingId && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      </section>

      {/* Lista de reglas */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Videos configurados{" "}
            <span className="font-normal text-slate-400">({shown.length})</span>
          </h2>
          {/* Filtro por mercado */}
          <div className="flex items-center gap-2">
            <label htmlFor="filter" className="text-xs font-medium text-slate-500">
              Mercado
            </label>
            <select
              id="filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              <option value="all">Todos</option>
              <option value="global">Global</option>
              {groupByCountry(agents).map((g) => (
                <optgroup key={g.country} label={g.country}>
                  {g.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {agentLabel(a)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-slate-400">
            {videos.length === 0
              ? "Aún no hay videos. Agrega una palabra y su video arriba."
              : "No hay videos para este mercado."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((v) =>
              editingId === v.id ? (
                /* --- Modo edición --- */
                <li key={v.id} className="space-y-3 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      value={editKeyword}
                      onChange={(e) => setEditKeyword(e.target.value)}
                      placeholder="Palabra clave"
                      className={inputCls}
                      aria-label="Palabra clave"
                    />
                    <input
                      type="url"
                      inputMode="url"
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      placeholder="URL del video"
                      className={inputCls}
                      aria-label="URL del video"
                    />
                    <select
                      value={editAgentId}
                      onChange={(e) => setEditAgentId(e.target.value)}
                      className={selectCls}
                      aria-label="Mercado"
                    >
                      <MarketOptions agents={agents} />
                    </select>
                    <input
                      type="text"
                      value={editCaption}
                      onChange={(e) => setEditCaption(e.target.value)}
                      placeholder="Caption (opcional)"
                      className={inputCls}
                      aria-label="Caption"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={cancelEdit}
                      disabled={isPending}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleSaveEdit(v.id)}
                      disabled={isPending || !editKeyword.trim() || !editUrl.trim()}
                      className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
                    >
                      {isPending ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                  {error && <p className="text-xs text-rose-600">{error}</p>}
                </li>
              ) : (
                /* --- Modo lectura --- */
                <li key={v.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {v.keyword}
                    </span>
                    <span
                      className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        v.agentId
                          ? "bg-indigo-50 text-indigo-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                      title="Mercado que recibe este video"
                    >
                      {marketLabel(v.agentId, agents)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <a
                      href={v.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm text-indigo-600 underline decoration-slate-300 underline-offset-2 hover:decoration-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                      title={v.videoUrl}
                    >
                      {v.videoUrl}
                    </a>
                    {v.caption && (
                      <p className="mt-0.5 truncate text-xs text-slate-500" title={v.caption}>
                        “{v.caption}”
                      </p>
                    )}
                  </div>
                  {!v.enabled && (
                    <span className="mt-1 text-xs font-medium text-slate-400">Desactivado</span>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(v)}
                      disabled={isPending}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleToggle(v)}
                      disabled={isPending}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
                    >
                      {v.enabled ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      onClick={() => handleDelete(v.id)}
                      disabled={isPending}
                      className="rounded-md border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
