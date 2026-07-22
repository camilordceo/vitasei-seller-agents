"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { sendManualMessage } from "../../actions";
import { formatDateTime } from "@/lib/dashboard/format";
import { UNSENT_TAG } from "@/lib/agent/tags";
import type { MessageDirection, MessageType } from "@/lib/supabase/types";

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

  // Scroll al fondo al montar y cada vez que llega/​sale un mensaje.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = () => {
    const clean = text.trim();
    if (!clean || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        await sendManualMessage(conversationId, clean);
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
        {!within24h ? (
          <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp puede rechazar el
            envío (requiere plantilla). Intenta de todas formas si es necesario.
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Escribe un mensaje para el cliente…"
            aria-label="Mensaje para el cliente"
            className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-[10px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
          <button
            type="submit"
            disabled={isPending || text.trim().length === 0}
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
          Enter envía · Shift+Enter salto de línea. El mensaje sale por WhatsApp (Callbell).
        </p>
      </form>
    </div>
  );
}
