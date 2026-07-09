import { describeEvent, type EventTone } from "@/lib/dashboard/events";
import { formatBogotaDateTime } from "@/lib/dashboard/format";
import type { ConversationEvent } from "@/lib/dashboard/queries";

const DOT: Record<EventTone, string> = {
  neutral: "bg-slate-300",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-rose-500",
};
const TEXT: Record<EventTone, string> = {
  neutral: "text-slate-700",
  good: "text-emerald-700",
  warn: "text-amber-700",
  error: "text-rose-700",
};

/**
 * Panel "¿Por qué (no) respondió?" — muestra el rastro de decisiones del bot
 * (`events_log`) traducido a lenguaje humano, para entender por qué un mensaje no
 * obtuvo respuesta: fuera de horario, modo manual, error de OpenAI/Callbell, fuera
 * de la ventana de 24 h, gate anti-alucinación, etc. Solo lectura. Server component.
 */
export function DiagnosticsPanel({ events }: { events: ConversationEvent[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">¿Por qué (no) respondió?</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        Rastro de decisiones del bot en esta conversación (lo más reciente arriba). Si tras
        &ldquo;Mensaje recibido&rdquo; no hay respuesta ni un motivo, la tarea en segundo plano no
        alcanzó a completarse.
      </p>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Sin eventos registrados todavía.</p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {events.map((e) => {
            const v = describeEvent(e.type, e.payload);
            return (
              <li key={e.id} className="flex gap-2.5">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[v.tone]}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${TEXT[v.tone]}`}>{v.label}</p>
                  {v.detail ? (
                    <p className="break-words text-xs text-slate-500">{v.detail}</p>
                  ) : null}
                  <p className="text-[11px] text-slate-400">{formatBogotaDateTime(e.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
