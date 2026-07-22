"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { sendManualImage, sendManualMessage, uploadChatImageAction } from "../../actions";
import { formatDateTime } from "@/lib/dashboard/format";
import { UNSENT_TAG } from "@/lib/agent/tags";
import type { MessageDirection, MessageType } from "@/lib/supabase/types";
import { ProductPicker } from "./ProductPicker";

interface ChatMessage {
  id: string;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  mediaUrl: string | null;
  tags: string[];
  createdAt: string;
}

/**
 * Panel de chat de una conversación: hilo con scroll propio (altura fija,
 * auto-scroll al fondo) + compositor para enviar un mensaje manual al cliente por
 * WhatsApp (Callbell). Ver docs/13 y ADR-0020.
 */
export function ChatPanel({
  conversationId,
  messages,
  within24h,
}: {
  conversationId: string;
  messages: ChatMessage[];
  within24h: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Imagen lista para enviar (subida o elegida del catálogo). El texto del
  // compositor viaja como caption, así que nunca se manda foto + texto suelto.
  const [attachment, setAttachment] = useState<{ url: string; label: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Scroll al fondo al montar y cada vez que llega/​sale un mensaje.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // El input se limpia siempre: si no, elegir la MISMA foto otra vez no dispara change.
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("conversationId", conversationId);
      fd.set("file", file);
      const url = await uploadChatImageAction(fd);
      setAttachment({ url, label: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la imagen.");
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    if (isPending || uploading) return;
    const clean = text.trim();
    // Con imagen el texto es opcional (va de caption); sin imagen, es obligatorio.
    if (!attachment && !clean) return;
    setError(null);
    startTransition(async () => {
      try {
        if (attachment) {
          await sendManualImage(conversationId, attachment.url, clean);
          setAttachment(null);
        } else {
          await sendManualMessage(conversationId, clean);
        }
        setText("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo enviar. Intenta de nuevo.");
      }
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {/* Hilo con scroll propio */}
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50/60 p-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Sin mensajes.</p>
        ) : (
          messages.map((m) => {
            const out = m.direction === "outbound";
            const isManual = m.tags.includes("manual");
            // El proveedor NO aceptó el envío: el cliente nunca lo recibió. Se
            // muestra distinto para que el hilo no lo haga pasar por entregado
            // (antes se veía idéntico a uno enviado). Ver ADR-0074.
            const unsent = m.tags.includes(UNSENT_TAG);
            const chips = m.tags.filter((t) => t !== "manual" && t !== UNSENT_TAG);

            // Resultado de una llamada con IA: es una NOTA interna, no un mensaje
            // que el cliente recibió. Se renderiza centrada y neutra para que
            // nadie la confunda con algo que el bot escribió. Ver docs/25.
            if (m.tags.includes("#llamada-ia")) {
              return (
                <div key={m.id} className="flex justify-center py-1">
                  <div className="w-full max-w-[92%] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path
                          d="M6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.7 2 2 0 0 1 6 3.5Z"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Nota interna
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
                      {m.content}
                    </p>
                    <span className="mt-1 block text-[10px] text-slate-400">
                      {formatDateTime(m.createdAt)}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed ${
                    unsent
                      ? "rounded-2xl rounded-br-md border border-dashed border-amber-400 bg-amber-50 text-slate-700"
                      : out
                        ? "rounded-2xl rounded-br-md bg-slate-900 text-slate-100"
                        : "rounded-2xl rounded-bl-md border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  {unsent ? (
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M12 8v5" strokeLinecap="round" />
                        <path d="M12 16.5h.01" strokeLinecap="round" />
                        <path
                          d="M10.3 3.9 2.6 17.1A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"
                          strokeLinejoin="round"
                        />
                      </svg>
                      No entregado — el cliente no lo recibió
                    </p>
                  ) : null}
                  {m.type === "image" && m.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.mediaUrl} alt="Imagen enviada" className="mb-1 max-h-56 rounded-lg" />
                  ) : null}
                  {m.content ? (
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  ) : m.type !== "text" ? (
                    <p className="italic opacity-80">[{m.type}]</p>
                  ) : null}
                  {chips.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {chips.map((t, i) => (
                        <span
                          key={i}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            out ? "bg-white/15 text-slate-200" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <span
                    className={`mt-1 flex items-center gap-1 text-[10px] ${
                      out ? "text-slate-400" : "text-slate-400"
                    }`}
                  >
                    {isManual ? <span className="font-medium">Manual ·</span> : null}
                    {formatDateTime(m.createdAt)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Compositor */}
      <form onSubmit={onSubmit} className="border-t border-slate-200 bg-slate-50/60 p-3">
        {pickerOpen ? (
          <ProductPicker
            conversationId={conversationId}
            onClose={() => setPickerOpen(false)}
            onPick={(p) => {
              if (!p.imageUrl) return;
              setAttachment({ url: p.imageUrl, label: `${p.name} · ${p.sku}` });
              setPickerOpen(false);
              setError(null);
            }}
          />
        ) : null}

        {attachment ? (
          <div className="mb-2 flex items-center gap-3 rounded-[10px] border border-slate-200 bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.url}
              alt=""
              className="h-14 w-14 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{attachment.label}</p>
              <p className="text-xs text-slate-500">
                Se envía como imagen. Lo que escribas abajo va como texto de la foto.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              aria-label="Quitar imagen"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : null}

        {!within24h ? (
          <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp puede rechazar el
            envío (requiere plantilla). Intenta de todas formas si es necesario.
          </p>
        ) : null}
        {/* Adjuntar: foto del computador o foto de un producto del catálogo. */}
        <div className="mb-2 flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onPickFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || isPending}
            className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path
                d="M21 12.5 12.7 20.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {uploading ? "Subiendo…" : "Subir imagen"}
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={isPending}
            aria-expanded={pickerOpen}
            className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" strokeLinejoin="round" />
              <path d="m3 7.5 9 4.5 9-4.5M12 12v9" strokeLinejoin="round" />
            </svg>
            Foto del inventario
          </button>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              attachment
                ? "Texto de la foto (opcional)…"
                : "Escribe un mensaje para el cliente…"
            }
            aria-label={attachment ? "Texto de la foto" : "Mensaje para el cliente"}
            className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-[10px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
          <button
            type="submit"
            disabled={isPending || uploading || (!attachment && text.trim().length === 0)}
            className="inline-flex h-11 items-center gap-1.5 rounded-[10px] bg-teal-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50"
          >
            {isPending ? (
              "Enviando…"
            ) : (
              <>
                Enviar
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 12l16-8-6 16-3-6-7-2Z" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        <p className="mt-1.5 text-[11px] text-slate-400">
          Enter envía · Shift+Enter salto de línea. El mensaje sale por WhatsApp. Puedes adjuntar
          una foto (JPG/PNG/WebP, hasta 7 MB) o mandar la del producto sin volver a subirla.
        </p>
      </form>
    </div>
  );
}
