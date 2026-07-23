"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateCampaignStatus } from "../actions";
import type { VoiceCampaignRow } from "@/lib/dashboard/queries";
import { formatDateTime, relativeTime } from "@/lib/dashboard/format";
import { describeCampaignDuration, describeCampaignStatus } from "@/lib/agent/voiceCampaignPlan";
import { btnSecondarySm, EmptyState } from "../ui-kit";

/**
 * Campañas en curso y pasadas, con el único control que importa a mitad de una:
 * **pausar**. Ver ADR-0084.
 */

const TONE: Record<string, string> = {
  running: "bg-teal-50 text-teal-700 ring-teal-200",
  paused: "bg-amber-50 text-amber-700 ring-amber-200",
  completed: "bg-slate-100 text-slate-600 ring-slate-300",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-300",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        TONE[status] ?? "bg-slate-100 text-slate-600 ring-slate-300"
      }`}
    >
      {describeCampaignStatus(status)}
    </span>
  );
}

export function CampaignList({ rows }: { rows: VoiceCampaignRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  function change(id: string, status: "running" | "paused" | "cancelled") {
    setError(null);
    setConfirming(null);
    startTransition(async () => {
      const result = await updateCampaignStatus(id, status);
      if (!result.ok) setError(result.error ?? "No se pudo actualizar la campaña.");
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay campañas"
        description="Cuando subas una lista de números aparecerá aquí, con cuántas llamadas van saliendo y cuántas terminaron en compra."
      />
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {rows.map((row) => {
          const progress = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
          return (
            <li key={row.id} className="px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={row.status} />
                    <span className="truncate text-sm font-medium text-slate-900">{row.name}</span>
                    {row.agentName ? (
                      <span className="text-xs text-slate-400">{row.agentName}</span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    <span title={formatDateTime(row.startsAt)}>
                      {row.status === "running" && row.pending > 0
                        ? `quedan ${row.pending} · ${describeCampaignDuration(row.pending, row.intervalMinutes)}`
                        : relativeTime(row.startsAt)}
                    </span>
                    <span>1 cada {row.intervalMinutes} min</span>
                    <span>
                      {row.done}/{row.total} hechas
                    </span>
                    <span>{row.answered} contestadas</span>
                    <span className={row.sales > 0 ? "font-medium text-emerald-700" : undefined}>
                      {row.sales} compra{row.sales === 1 ? "" : "s"}
                    </span>
                    {row.costUsd > 0 ? <span>US$ {row.costUsd.toFixed(2)}</span> : null}
                  </div>
                  <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-900"
                      style={{ width: `${Math.min(100, progress)}%` }}
                    />
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Link href={`/dashboard/calls?campaign=${row.id}`} className={btnSecondarySm}>
                    Ver llamadas
                  </Link>
                  {row.status === "running" ? (
                    <button
                      type="button"
                      onClick={() => change(row.id, "paused")}
                      disabled={pending}
                      className={btnSecondarySm}
                    >
                      Pausar
                    </button>
                  ) : null}
                  {row.status === "paused" ? (
                    <button
                      type="button"
                      onClick={() => change(row.id, "running")}
                      disabled={pending}
                      className={btnSecondarySm}
                    >
                      Reanudar
                    </button>
                  ) : null}
                  {row.status === "running" || row.status === "paused" ? (
                    confirming === row.id ? (
                      <button
                        type="button"
                        onClick={() => change(row.id, "cancelled")}
                        disabled={pending}
                        className="inline-flex min-h-[34px] items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 hover:bg-red-100"
                      >
                        Confirmar: cancelar {row.pending} pendientes
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(row.id)}
                        disabled={pending}
                        className={btnSecondarySm}
                      >
                        Cancelar
                      </button>
                    )
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
