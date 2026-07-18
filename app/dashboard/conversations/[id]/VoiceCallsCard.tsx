"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerVoiceCall, cancelVoiceCalls } from "../../actions";
import type { VoiceCallRow } from "@/lib/dashboard/queries";
import { formatDateTime, relativeTime } from "@/lib/dashboard/format";
import { describeCallStatus, describeDelay } from "@/lib/agent/voiceCallPlan";
import { formatDuration } from "@/lib/synthflow/pricing";
import { formatExtractedValue, humanizeIdentifier } from "@/lib/synthflow/extractors";

const TONE: Record<string, string> = {
  scheduled: "bg-amber-50 text-amber-700 ring-amber-200",
  processing: "bg-amber-50 text-amber-700 ring-amber-200",
  placed: "bg-blue-50 text-blue-700 ring-blue-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  no_answer: "bg-slate-100 text-slate-600 ring-slate-300",
  failed: "bg-red-50 text-red-700 ring-red-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-300",
  skipped: "bg-slate-100 text-slate-500 ring-slate-300",
};

/**
 * Tarjeta de llamadas con IA en el detalle de la conversación: dispara una
 * llamada YA y muestra las programadas/realizadas de este cliente. Ver docs/25.
 */
export function VoiceCallsCard({
  conversationId,
  rows,
}: {
  conversationId: string;
  rows: VoiceCallRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function call() {
    setMessage(null);
    startTransition(async () => {
      const result = await triggerVoiceCall(conversationId);
      setMessage(
        result.ok
          ? { kind: "ok", text: "Llamada disparada." }
          : { kind: "error", text: result.error ?? "No se pudo llamar." },
      );
      if (result.ok) router.refresh();
    });
  }

  function cancel(id: string) {
    setMessage(null);
    startTransition(async () => {
      try {
        await cancelVoiceCalls([id]);
        router.refresh();
      } catch (e) {
        setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Llamadas con IA</h2>
        <button
          type="button"
          onClick={call}
          disabled={pending}
          className="min-h-[36px] rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {pending ? "Llamando…" : "Llamar ahora"}
        </button>
      </div>

      {message ? (
        <p
          className={`mt-2 rounded-lg px-3 py-2 text-sm ${
            message.kind === "ok"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Sin llamadas todavía.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((row) => {
            const entries = Object.entries(row.extracted ?? {});
            return (
              <li key={row.id} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      TONE[row.status] ?? "bg-slate-100 text-slate-600 ring-slate-300"
                    }`}
                  >
                    {describeCallStatus(row.status)}
                  </span>
                  <span className="text-xs text-slate-500" title={formatDateTime(row.scheduledAt)}>
                    {row.status === "scheduled"
                      ? `sale ${relativeTime(row.scheduledAt)} · ${describeDelay(row.delayMinutes)}`
                      : relativeTime(row.placedAt ?? row.scheduledAt)}
                  </span>
                  {row.durationSec ? (
                    <span className="text-xs text-slate-500">{formatDuration(row.durationSec)}</span>
                  ) : null}
                  {row.status === "scheduled" ? (
                    <button
                      type="button"
                      onClick={() => cancel(row.id)}
                      disabled={pending}
                      className="ml-auto text-xs text-slate-500 underline-offset-2 hover:text-red-700 hover:underline disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>

                {entries.length > 0 ? (
                  <dl className="mt-1.5 space-y-0.5">
                    {entries.map(([key, value]) => (
                      <div key={key} className="flex gap-1.5 text-xs">
                        <dt className="shrink-0 text-slate-500">{humanizeIdentifier(key)}:</dt>
                        <dd className="min-w-0 break-words text-slate-800">
                          {formatExtractedValue(value as never)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {row.recordingUrl ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <audio controls preload="none" src={row.recordingUrl} className="mt-2 w-full" />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
