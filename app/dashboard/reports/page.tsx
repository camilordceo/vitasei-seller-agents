import {
  getAgents,
  getAiCostReport,
  getConversionReport,
  getProductConversion,
  getSalesReport,
} from "@/lib/dashboard/queries";
import {
  ORDER_STATUSES,
  type ConversionReport,
  type SalesReport,
} from "@/lib/dashboard/report";
import {
  formatCOP,
  formatNumber,
  formatDayKeyShort,
  formatPercent,
  formatUsd4,
} from "@/lib/dashboard/format";
import { orderStatusLabel } from "../ui";
import { CopySummaryButton } from "./CopySummaryButton";
import { AgentFilter } from "./AgentFilter";

export const dynamic = "force-dynamic";

/** Etiquetas de método conocidas (fallback cuando el agente no las define). */
const METHOD_LABEL_FALLBACK: Record<string, string> = {
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

function buildSummary(r: SalesReport, c: ConversionReport, scope: string): string {
  return [
    `Reporte de ventas — ${scope}`,
    `Ventas confirmadas: ${r.confirmed.count} · ${formatCOP(r.confirmed.revenue)}`,
    `En curso (sin confirmar): ${r.pipeline.count} · ${formatCOP(r.pipeline.revenue)}`,
    `Órdenes generadas: ${r.generated.count} · ${formatCOP(r.generated.revenue)}`,
    `Canceladas: ${r.cancelled.count}`,
    `Conversión: ${formatPercent(c.total.rate)} (${c.total.transactions}/${c.total.conversations} conversaciones)`,
    `Hoy: ${r.today.count} (${formatCOP(r.today.revenue)}) · 7 días: ${r.last7.count} (${formatCOP(r.last7.revenue)}) · 30 días: ${r.last30.count} (${formatCOP(r.last30.revenue)})`,
  ].join("\n");
}

// Días de la semana en orden Lun→Dom (los índices son 0=Dom … 6=Sáb).
const WEEKDAYS: Array<{ i: number; l: string }> = [
  { i: 1, l: "Lun" },
  { i: 2, l: "Mar" },
  { i: 3, l: "Mié" },
  { i: 4, l: "Jue" },
  { i: 5, l: "Vie" },
  { i: 6, l: "Sáb" },
  { i: 0, l: "Dom" },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  const agents = await getAgents();
  // Etiquetas de método por su clave: las configuradas por los agentes (ADR-0055)
  // sobre los fallbacks conocidos (cod/addi/undecided).
  const methodLabels: Record<string, string> = {
    ...METHOD_LABEL_FALLBACK,
    ...Object.fromEntries(agents.flatMap((a) => a.paymentMethods).map((m) => [m.method, m.label])),
  };
  // Agente seleccionado: el del query (?agent=) si existe, o undefined = consolidado.
  const selected =
    searchParams.agent && agents.some((a) => a.id === searchParams.agent)
      ? agents.find((a) => a.id === searchParams.agent)!
      : null;
  const agentId = selected?.id;
  const scope = selected
    ? `${selected.name}${selected.brand ? ` · ${selected.brand}` : ""}`
    : "Todos los agentes";

  const [r, conv, ai, products] = await Promise.all([
    getSalesReport(agentId),
    getConversionReport(agentId),
    getAiCostReport(agentId),
    getProductConversion(agentId),
  ]);
  const maxDayRevenue = Math.max(1, ...r.perDay.map((d) => d.revenue));
  const maxConvDay = Math.max(1, ...conv.perDay.map((d) => d.conversations));
  const maxWeekdayRev = Math.max(1, ...r.byWeekday.map((b) => b.revenue));
  const maxHourRev = Math.max(1, ...r.byHour.map((b) => b.revenue));
  const convWindows = [
    { label: "Hoy", w: conv.today },
    { label: "Últimos 7 días", w: conv.last7 },
    { label: "Últimos 30 días", w: conv.last30 },
    { label: "Total", w: conv.total },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reportes</h1>
          <p className="text-sm text-slate-500">
            {selected ? (
              <>
                Ventas y actividad de <span className="font-medium text-slate-700">{scope}</span>.
                Comparte el resumen con el equipo.
              </>
            ) : (
              <>Ventas generadas por el agente. Comparte el resumen con el equipo.</>
            )}
          </p>
        </div>
        <CopySummaryButton summary={buildSummary(r, conv, scope)} />
      </div>

      {agents.length > 1 && (
        <AgentFilter
          agents={agents.map((a) => ({ id: a.id, name: a.name, brand: a.brand }))}
          current={agentId ?? ""}
        />
      )}

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

      {/* Costo IA: las tres fuentes que consume el agente + total */}
      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Costo IA</h2>
          <p className="text-xs text-slate-400">
            Consumo real del agente con gpt-5-mini. El costo de imágenes (visión) es estimado
            (sus tokens vienen dentro de los del modelo); el total es exacto.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ReportCard
            label="Texto (respuestas)"
            value={formatUsd4(ai.textCostUsd)}
            sub={`${formatNumber(ai.inputTokens + ai.outputTokens)} tokens`}
          />
          <ReportCard
            label="Imágenes (visión)"
            value={formatUsd4(ai.imageCostUsd)}
            sub={`${formatNumber(ai.imageCount)} ${ai.imageCount === 1 ? "imagen" : "imágenes"} · estimado`}
          />
          <ReportCard
            label="Audio (transcripción)"
            value={formatUsd4(ai.audioCostUsd)}
            sub={`${formatNumber(ai.audioCount)} ${ai.audioCount === 1 ? "audio" : "audios"} · ${formatNumber(Math.round(ai.audioSeconds))} s`}
          />
          <ReportCard
            label="Costo IA total"
            value={formatUsd4(ai.totalCostUsd)}
            sub="texto + imágenes + audio"
            accent="text-indigo-700"
          />
        </div>
      </section>

      {/* Conversión: conversaciones → transacciones */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Conversión</h2>
            <p className="text-xs text-slate-400">
              Conversaciones activas (el cliente escribió) vs. transacciones (órdenes no
              canceladas, por su fecha de creación — misma base que &quot;Órdenes generadas&quot;).
              Hoy / 7 / 30 días cuentan el periodo; Total es histórico.
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tracking-tight text-emerald-700">
              {formatPercent(conv.total.rate)}
            </p>
            <p className="text-xs text-slate-500">
              {formatNumber(conv.total.transactions)} de {formatNumber(conv.total.conversations)}{" "}
              conversaciones
            </p>
          </div>
        </div>

        {/* Tabla por periodo */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Periodo</th>
                <th className="pb-2 text-right font-medium">Conversaciones</th>
                <th className="pb-2 text-right font-medium">Transacciones</th>
                <th className="pb-2 text-right font-medium">Conversión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {convWindows.map((row) => (
                <tr key={row.label}>
                  <td className="py-2 text-slate-700">{row.label}</td>
                  <td className="py-2 text-right tabular-nums text-slate-900">
                    {formatNumber(row.w.conversations)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-900">
                    {formatNumber(row.w.transactions)}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums text-emerald-700">
                    {formatPercent(row.w.rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Gráfico por día */}
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" aria-hidden="true" />
              Conversaciones
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />
              Transacciones
            </span>
            <span className="ml-auto">Últimos 14 días</span>
          </div>
          <ul className="space-y-1.5">
            {conv.perDay.map((d) => (
              <li key={d.date} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-xs text-slate-500">
                  {formatDayKeyShort(d.date)}
                </span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-slate-100">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-slate-300"
                    style={{ width: `${Math.round((d.conversations / maxConvDay) * 100)}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-emerald-500"
                    style={{ width: `${Math.round((d.transactions / maxConvDay) * 100)}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {d.transactions}/{d.conversations}
                </span>
                <span className="w-14 shrink-0 text-right text-xs font-medium tabular-nums text-slate-700">
                  {formatPercent(d.rate)}
                </span>
              </li>
            ))}
          </ul>
        </div>
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
              {r.methodKeys.map((m) => (
                <tr key={m}>
                  <td className="py-2 text-slate-700">{methodLabels[m] ?? m}</td>
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

      {/* Analítica de horarios: día de la semana + hora del día (hora Colombia) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Por día de la semana</h2>
          <p className="mb-3 text-xs text-slate-400">Órdenes generadas · hora Colombia.</p>
          <ul className="space-y-1.5">
            {WEEKDAYS.map(({ i, l }) => {
              const b = r.byWeekday[i];
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="w-10 shrink-0 text-xs text-slate-500">{l}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full rounded bg-indigo-500/80"
                      style={{ width: `${Math.round((b.revenue / maxWeekdayRev) * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">
                    {b.count}
                  </span>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-700">
                    {formatCOP(b.revenue)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Por hora del día</h2>
          <p className="mb-3 text-xs text-slate-400">Órdenes generadas · hora Colombia.</p>
          <ul className="space-y-1">
            {r.byHour.map((b, h) => (
              <li key={h} className="flex items-center gap-3">
                <span className="w-10 shrink-0 text-xs tabular-nums text-slate-500">
                  {String(h).padStart(2, "0")}h
                </span>
                <div className="h-3.5 flex-1 overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-full rounded bg-indigo-500/80"
                    style={{ width: `${Math.round((b.revenue / maxHourRev) * 100)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {b.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Conversión por producto */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Conversión por producto</h2>
          <p className="text-xs text-slate-400">
            Conversaciones agrupadas por su producto/fuente y cuántas terminaron en venta. Se
            autocategoriza por palabra clave; también se ajusta a mano en cada conversación.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Producto</th>
                <th className="pb-2 text-right font-medium">Conversaciones</th>
                <th className="pb-2 text-right font-medium">Transacciones</th>
                <th className="pb-2 text-right font-medium">Conversión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.length === 0 ? (
                <tr>
                  <td className="py-3 text-slate-400" colSpan={4}>
                    Aún no hay conversaciones categorizadas.
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.category ?? "__none__"}>
                    <td className="py-2 text-slate-700">
                      {p.category ?? <span className="text-slate-400">Sin categoría</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-900">
                      {formatNumber(p.conversations)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-900">
                      {formatNumber(p.transactions)}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums text-emerald-700">
                      {formatPercent(p.rate)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
