"use client";

import { useState } from "react";
import type { ConversationsByDayReport } from "@/lib/dashboard/report";
import { formatDayKeyShort, formatNumber } from "@/lib/dashboard/format";

/**
 * "Conversaciones por día · por agente" (ADR-0087): cuántos leads ENTRARON cada día
 * y de qué marca. Un botón alterna entre GRÁFICO (barras apiladas por agente) y
 * TABLA — es la MISMA data en dos vistas, para leerla o para copiarla y armar
 * llamadas masivas. Una conversación cuenta el día de su primer contacto.
 */
export function ConversationsByAgentChart({
  report,
  seriesLabel,
  colors,
}: {
  report: ConversationsByDayReport;
  /** Texto de la ventana ("últimos 14 días" o el rango elegido). */
  seriesLabel: string;
  /** Color por agente, alineado a `report.agents` (posición estable). */
  colors: string[];
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const { days, agents, totalsByAgent, total, maxDay } = report;
  const colorOf = (i: number) => colors[i % colors.length];
  const multi = agents.length > 1;

  const tabCls = (active: boolean) =>
    active
      ? "rounded-md bg-white px-3 py-1 text-sm font-medium text-slate-900 shadow-sm"
      : "rounded-md px-3 py-1 text-sm font-medium text-slate-500 hover:text-slate-900";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">
            Conversaciones por día · por agente
          </h2>
          <p className="max-w-prose text-xs text-slate-400">
            Cuántos leads entraron cada día (por su primer mensaje) y de qué agente. La misma
            data en gráfico o tabla — sirve para ver de qué marca están llegando y para armar
            llamadas masivas. {seriesLabel}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-right">
            <span className="font-display text-lg font-semibold tracking-tight text-slate-900">
              {formatNumber(total)}
            </span>{" "}
            <span className="text-xs text-slate-500">en total</span>
          </p>
          {/* Toggle gráfico/tabla: misma data, dos vistas. */}
          <div
            className="inline-flex rounded-lg bg-slate-100 p-0.5"
            role="tablist"
            aria-label="Ver como gráfico o tabla"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "chart"}
              onClick={() => setView("chart")}
              className={tabCls(view === "chart")}
            >
              Gráfico
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "table"}
              onClick={() => setView("table")}
              className={tabCls(view === "table")}
            >
              Tabla
            </button>
          </div>
        </div>
      </div>

      {multi && (
        <ul className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {agents.map((a, i) => (
            <li key={a.id} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: colorOf(i) }}
                aria-hidden
              />
              {a.name}
            </li>
          ))}
        </ul>
      )}

      {total === 0 ? (
        <p className="py-2 text-sm text-slate-400">
          No entraron conversaciones en este periodo.
        </p>
      ) : view === "chart" ? (
        <ul className="space-y-1.5">
          {days.map((d) => (
            <li key={d.date} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs text-slate-500">
                {formatDayKeyShort(d.date)}
              </span>
              {/* Barra apilada: un segmento por agente, ancho proporcional al día
                  más alto del periodo (no a cada fila) para comparar días de un
                  vistazo. */}
              <div className="flex h-4 flex-1 items-stretch overflow-hidden rounded bg-slate-100">
                {d.byAgent.map((a, i) =>
                  a.count > 0 ? (
                    <div
                      key={a.agentId}
                      title={`${a.name}: ${formatNumber(a.count)} ${a.count === 1 ? "conversación" : "conversaciones"}`}
                      style={{
                        width: `${(a.count / maxDay) * 100}%`,
                        backgroundColor: colorOf(i),
                      }}
                    />
                  ) : null,
                )}
              </div>
              <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-slate-700">
                {formatNumber(d.total)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Día</th>
                {agents.map((a, i) => (
                  <th key={a.id} className="pb-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: colorOf(i) }}
                        aria-hidden
                      />
                      {a.name}
                    </span>
                  </th>
                ))}
                <th className="pb-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {days.map((d) => (
                <tr key={d.date}>
                  <td className="py-2 text-slate-700">{formatDayKeyShort(d.date)}</td>
                  {d.byAgent.map((a) => (
                    <td key={a.agentId} className="py-2 text-right tabular-nums text-slate-700">
                      {a.count > 0 ? formatNumber(a.count) : <span className="text-slate-300">—</span>}
                    </td>
                  ))}
                  <td className="py-2 text-right font-medium tabular-nums text-slate-900">
                    {formatNumber(d.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/60">
                <td className="py-2 font-medium text-slate-900">Total</td>
                {totalsByAgent.map((t, i) => (
                  <td
                    key={agents[i].id}
                    className="py-2 text-right font-medium tabular-nums text-slate-900"
                  >
                    {formatNumber(t)}
                  </td>
                ))}
                <td className="py-2 text-right font-semibold tabular-nums text-slate-900">
                  {formatNumber(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {report.truncated && (
        <p className="mt-2 text-xs text-amber-700">
          El rango es largo: se muestran los {days.length} días más recientes en la serie (los
          totales sí cubren todo el rango).
        </p>
      )}
    </section>
  );
}
