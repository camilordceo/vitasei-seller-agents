"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryReply } from "../../actions";

/**
 * Botón de reintento de la respuesta de la IA. Para recuperar una conversación
 * donde el bot no respondió (p. ej. un error transitorio dejó el primer mensaje
 * del cliente sin contestar): re-corre el flujo automático sobre los mensajes
 * pendientes. Usa la Server Action `retryReply` con estado de carga/error inline,
 * como el compositor de `ChatPanel`. Ver docs/13, ADR-0027.
 */
export function RetryButton({
  conversationId,
  disabled = false,
  disabledReason,
}: {
  conversationId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const onClick = () => {
    if (isPending || disabled) return;
    setMsg(null);
    startTransition(async () => {
      try {
        await retryReply(conversationId);
        setMsg({ kind: "ok", text: "Respuesta reintentada." });
        router.refresh();
      } catch (e) {
        setMsg({
          kind: "error",
          text: e instanceof Error ? e.message : "No se pudo reintentar. Intenta de nuevo.",
        });
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending || disabled}
        title={
          disabled
            ? disabledReason
            : "Volver a generar y enviar la respuesta de la IA para los mensajes pendientes"
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {isPending ? "Reintentando…" : "Reintentar IA"}
      </button>
      {msg ? (
        <span
          className={`max-w-[16rem] text-right text-[11px] ${
            msg.kind === "error" ? "text-rose-600" : "text-emerald-600"
          }`}
        >
          {msg.text}
        </span>
      ) : null}
    </div>
  );
}
