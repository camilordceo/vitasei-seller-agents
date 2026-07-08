"use client";

import { useState, useTransition } from "react";
import { createVideo, updateVideo, deleteVideo, setVideoEnabled } from "../actions";
import type { VideoRow } from "@/lib/dashboard/queries";

const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400";

export function VideosManager({ initial }: { initial: VideoRow[] }) {
  const [videos, setVideos] = useState<VideoRow[]>(initial);
  const [keyword, setKeyword] = useState("");
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Estado de edición inline.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKeyword, setEditKeyword] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editCaption, setEditCaption] = useState("");

  const handleCreate = () => {
    const kw = keyword.trim();
    const u = url.trim();
    const cap = caption.trim();
    if (!kw || !u) return;
    startTransition(async () => {
      try {
        const id = await createVideo(kw, u, cap);
        setVideos((prev) => [
          {
            id,
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
        await updateVideo(id, { keyword: kw, videoUrl: u, caption: cap });
        setVideos((prev) =>
          prev.map((x) =>
            x.id === id ? { ...x, keyword: kw, videoUrl: u, caption: cap || null } : x,
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
      {/* Formulario: agregar palabra → video (+ caption opcional) */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">Agregar video</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Cuando la respuesta del bot mencione la palabra, enviará este video después del mensaje.
          El caption (opcional) se manda como texto justo antes del video.
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
          <div className="sm:col-span-2">
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
            className="h-11 rounded-md bg-slate-900 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
          >
            {isPending ? "Guardando…" : "Agregar"}
          </button>
        </div>
        {error && !editingId && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      </section>

      {/* Lista de reglas */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Videos configurados{" "}
          <span className="font-normal text-slate-400">({videos.length})</span>
        </h2>
        {videos.length === 0 ? (
          <p className="text-sm text-slate-400">
            Aún no hay videos. Agrega una palabra y su video arriba.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {videos.map((v) =>
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
                    <input
                      type="text"
                      value={editCaption}
                      onChange={(e) => setEditCaption(e.target.value)}
                      placeholder="Caption (opcional)"
                      className={`sm:col-span-2 ${inputCls}`}
                      aria-label="Caption"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={cancelEdit}
                      disabled={isPending}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleSaveEdit(v.id)}
                      disabled={isPending || !editKeyword.trim() || !editUrl.trim()}
                      className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
                    >
                      {isPending ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                  {error && <p className="text-xs text-rose-600">{error}</p>}
                </li>
              ) : (
                /* --- Modo lectura --- */
                <li key={v.id} className="flex flex-wrap items-start gap-3 py-3">
                  <span className="mt-0.5 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {v.keyword}
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={v.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm text-indigo-600 underline decoration-slate-300 underline-offset-2 hover:decoration-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
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
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleToggle(v)}
                      disabled={isPending}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
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
