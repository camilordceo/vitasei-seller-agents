import { getSalesReport } from "@/lib/dashboard/queries";
import { ORDER_STATUSES, FULFILLMENT_METHODS, type SalesReport } from "@/lib/dashboard/report";
import { formatCOP, formatNumber, formatDayKeyShort } from "@/lib/dashboard/format";
import { orderStatusLabel } from "../ui";
import { CopySummaryButton } from "./CopySummaryButton";
import type { FulfillmentMethod } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<FulfillmentMethod, string> = {
  addi: "Addi",
  cod: "Contra entrega",
  undecided: "Sin definir",
};

function ReportCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${accent ?? "text-slate-900"}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function buildSummary(r: SalesReport): string {
  return [
    "Reporte de ventas — Vitasei",
    `Ventas confirmadas: ${r.confirmed.count} · ${formatCOP(r.confirmed.revenue)}`,
    `En curso (sin confirmar): ${r.pipeline.count} · ${formatCOP(r.pipeline.revenue)}`,
    `Órdenes generadas: ${r.generated.count} · ${formatCOP(r.generated.revenue)}`,
    `Canceladas: ${r.cancelled.count}`,
    `Hoy: ${r.today.count} (${formatCOP(r.today.revenue)}) · 7 días: ${r.last7.count} (${formatCOP(r.last7.revenue)}) · 30 días: ${r.last30.count} (${formatCOP(r.last30.revenue)})`,
  ].join("\n");
}

export default async function ReportsPage() {
  const r = await getSalesReport();
  const maxDayRevenue = Math.max(1, ...r.perDay.map((d) => d.revenue));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reportes</h1>
          <p className="text-sm text-slate-500">
            Ventas generadas por el agente. Comparte el resumen con el equipo.
          </p>
        </div>
        <CopySummaryButton summary={buildSummary(r)} />
      </div>

      {/* Titulares */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ReportCard
          label="Ventas confirmadas"
          value={formatCOP(r.confirmed.revenue)}
          sub={`${formatNumber(r.confirmed.count)} ${r.confirmed.count === 1 ? "orden" : "órdenes"}`}
          accent="text-emerald-700"
        />
        <ReportCard
          label="En curso (sin confirmar)"
          value={formatCOP(r.pipeline.revenue)}
          sub={`${formatNumber(r.pipeline.count)} en pipeline`}
          accent="text-indigo-700"
        />
        <ReportCard
          label="Órdenes generadas"
          value={formatNumber(r.generated.count)}
          sub={`${formatCOP(r.generated.revenue)} · sin canceladas`}
        />
        <ReportCard
          label="Canceladas"
          value={formatNumber(r.cancelled.count)}
          sub={`de ${formatNumber(r.totalOrders)} en total`}
          accent="text-rose-700"
        />
      </section>

      {/* Ventanas de tiempo */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Hoy", b: r.today },
          { label: "Últimos 7 días", b: r.last7 },
          { label: "Últimos 30 días", b: r.last30 },
        ].map((w) => (
          <div key={w.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">{w.label}</p>
            <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
              {formatCOP(w.b.revenue)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatNumber(w.b.count)} {w.b.count === 1 ? "orden generada" : "órdenes generadas"}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Por estado */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Por estado</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Estado</th>
                <th className="pb-2 text-right font-medium">Órdenes</th>
                <th className="pb-2 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ORDER_STATUSES.map((s) => (
                <tr key={s}>
                  <td className="py-2 text-slate-700">{orderStatusLabel(s)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-900">
                    {formatNumber(r.byStatus[s].count)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-900">
                    {formatCOP(r.byStatus[s].revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Por método */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Por método</h2>
          <p className="mb-3 text-xs text-slate-400">Órdenes activas (sin canceladas).</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Método</th>
                <th className="pb-2 text-right font-medium">Órdenes</th>
                <th className="pb-2 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {FULFILLMENT_METHODS.map((m) => (
                <tr key={m}>
                  <td className="py-2 text-slate-700">{METHOD_LABEL[m]}</td>
                  <td className="py-2 text-right tabular-nums text-slate-900">
                    {formatNumber(r.byMethod[m].count)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-900">
                    {formatCOP(r.byMethod[m].revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Últimos 14 días */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Órdenes generadas · últimos 14 días
        </h2>
        <ul className="space-y-1.5">
          {r.perDay.map((d) => (
            <li key={d.date} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs text-slate-500">
                {formatDayKeyShort(d.date)}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded bg-emerald-500/80"
                  style={{ width: `${Math.round((d.revenue / maxDayRevenue) * 100)}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">
                {d.count}
              </span>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-700">
                {formatCOP(d.revenue)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
