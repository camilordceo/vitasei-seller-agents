"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelVoiceCalls } from "../actions";
import type { VoiceCallRow } from "@/lib/dashboard/queries";
import { formatDateTime, relativeTime } from "@/lib/dashboard/format";
import { describeCallStatus, describeDelay, describeEndReason } from "@/lib/agent/voiceCallPlan";
import { formatDuration } from "@/lib/synthflow/pricing";
import { formatExtractedValue, humanizeIdentifier } from "@/lib/synthflow/extractors";

/** Solo estas se pueden cancelar: una llamada ya colocada no se des-hace. */
const CANCELLABLE = new Set(["scheduled"]);

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

export function VoiceCallStatusPill({ status }: { status: string }) {
  const tone = TONE[status] ?? "bg-slate-100 text-slate-600 ring-slate-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {describeCallStatus(status)}
    </span>
  );
}

function TriggerTag({ trigger }: { trigger: string }) {
  if (trigger === "manual") {
    return <span className="text-xs text-slate-400">· manual</span>;
  }
  if (trigger === "request") {
    return <span className="text-xs text-slate-400">· pedida</span>;
  }
  if (trigger === "campaign") {
    return <span className="text-xs text-slate-400">· campaña</span>;
  }
  return null;
}

/**
 * En qué terminó la llamada. Es LO PRIMERO que se busca en esta lista: antes
 * había que abrir el detalle de cada una para descubrir una venta (ADR-0083).
 */
function OutcomeTag({
  outcome,
  orderId,
  phone,
}: {
  outcome: string | null;
  orderId: string | null;
  phone: string;
}) {
  if (!outcome && !orderId) return null;
  if (orderId) {
    // Órdenes busca por cliente (nombre/teléfono/ciudad), no por id de orden.
    return (
      <Link
        href={`/dashboard/orders?q=${encodeURIComponent(phone)}`}
        className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
      >
        {outcome ? `${outcome} · orden creada` : "Orden creada"}
      </Link>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
      {outcome}
    </span>
  );
}

/** Detalle desplegable: datos extraídos, audio y transcript. */
function CallDetail({ row }: { row: VoiceCallRow }) {
  const entries = Object.entries(row.extracted ?? {});
  return (
    <div className="space-y-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
      {row.error ? (
        <p className="text-sm text-red-700">
          <span className="font-medium">Motivo:</span> {row.error}
        </p>
      ) : null}

      {entries.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Datos capturados
          </h4>
          <dl className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {entries.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-sm">
                <dt className="shrink-0 text-slate-500">{humanizeIdentifier(key)}:</dt>
                <dd className="min-w-0 break-words text-slate-800">
                  {formatExtractedValue(value as never)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {row.recordingUrl ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Grabación
          </h4>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls preload="none" src={row.recordingUrl} className="mt-1.5 w-full max-w-md">
            Tu navegador no reproduce audio.
          </audio>
        </div>
      ) : null}

      {row.transcript ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Transcripción
          </h4>
          <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700">
            {row.transcript}
          </pre>
        </div>
      ) : null}

      {!row.transcript && !row.recordingUrl && entries.length === 0 && !row.error ? (
        <p className="text-sm text-slate-500">Sin datos todavía.</p>
      ) : null}
    </div>
  );
}

export function VoiceCallsPanel({ rows }: { rows: VoiceCallRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancellable = useMemo(() => rows.filter((r) => CANCELLABLE.has(r.status)), [rows]);
  const allSelected = cancellable.length > 0 && selected.size === cancellable.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(cancellable.map((r) => r.id)));
  }

  function cancelSelected() {
    if (selected.size === 0) return;
    setError(null);
    const ids = [...selected];
    startTransition(async () => {
      try {
        await cancelVoiceCalls(ids);
        setSelected(new Set());
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">No hay llamadas con IA que coincidan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Barra de acción masiva: aparece solo cuando hay algo cancelable. */}
      {cancellable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-teal-500"
            />
            Seleccionar las {cancellable.length} programadas
          </label>
          <span className="text-sm text-slate-400">
            {selected.size > 0 ? `${selected.size} seleccionada(s)` : null}
          </span>
          <button
            type="button"
            onClick={cancelSelected}
            disabled={selected.size === 0 || pending}
            className="ml-auto min-h-[36px] rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {pending ? "Cancelando…" : "Cancelar seleccionadas"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {rows.map((row) => {
          const canCancel = CANCELLABLE.has(row.status);
          const isOpen = open === row.id;
          const hasDetail =
            Boolean(row.transcript) ||
            Boolean(row.recordingUrl) ||
            Boolean(row.error) ||
            Object.keys(row.extracted ?? {}).length > 0;

          return (
            <li key={row.id}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                  disabled={!canCancel}
                  aria-label={`Seleccionar llamada a ${row.phone}`}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-teal-500 disabled:opacity-30"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <VoiceCallStatusPill status={row.status} />
                    {/* Una llamada de campaña sin venta no tiene conversación a la
                        cual entrar: se muestra el número, sin enlace muerto. */}
                    {row.conversationId ? (
                      <Link
                        href={`/dashboard/conversations/${row.conversationId}`}
                        className="truncate text-sm font-medium text-slate-900 hover:underline"
                      >
                        {row.contactName || row.phone}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium text-slate-900">
                        {row.contactName || row.phone}
                      </span>
                    )}
                    {row.contactName ? (
                      <span className="font-mono text-xs text-slate-400">{row.phone}</span>
                    ) : null}
                    <OutcomeTag outcome={row.outcome} orderId={row.orderId} phone={row.phone} />
                    <TriggerTag trigger={row.trigger} />
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    {row.status === "scheduled" || row.status === "processing" ? (
                      <span title={formatDateTime(row.scheduledAt)}>
                        Sale {relativeTime(row.scheduledAt)}
                        {row.delayMinutes != null
                          ? ` · etapa ${row.stage} (${describeDelay(row.delayMinutes)})`
                          : null}
                      </span>
                    ) : (
                      <span title={formatDateTime(row.placedAt ?? row.scheduledAt)}>
                        {relativeTime(row.placedAt ?? row.scheduledAt)}
                      </span>
                    )}
                    {row.durationSec ? <span>{formatDuration(row.durationSec)}</span> : null}
                    {row.endCallReason ? <span>{describeEndReason(row.endCallReason)}</span> : null}
                    {row.agentName ? <span>{row.agentName}</span> : null}
                  </div>
                </div>

                {hasDetail ? (
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : row.id)}
                    aria-expanded={isOpen}
                    className="min-h-[36px] shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  >
                    {isOpen ? "Ocultar" : "Ver detalle"}
                  </button>
                ) : null}
              </div>

              {isOpen ? <CallDetail row={row} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
