import Link from "next/link";
import {
  getAgents,
  getAiCostReport,
  getCloseSpeed,
  getVoiceCallStats,
  getConversionReport,
  getProductConversion,
  getRoasReport,
  getSalesReport,
  getTopProducts,
} from "@/lib/dashboard/queries";
import type { RoasScalingReport } from "@/lib/dashboard/queries";
import {
  ORDER_STATUSES,
  bogotaDayKey,
  type SpendSource,
  type CloseSpeedReport,
  type ConversionReport,
  type RoasReport,
  type RoasRow,
  type ScalingReport,
  type SalesReport,
  type WeeklyReport,
} from "@/lib/dashboard/report";
import { CURRENCY_LABELS, rateNote, type CurrencyCode } from "@/lib/dashboard/currency";
import {
  formatMinutes,
  formatMoney,
  formatNumber,
  formatDayKeyShort,
  formatPercent,
  formatUsd4,
} from "@/lib/dashboard/format";
import { orderStatusLabel } from "../ui";
import { Collapsible } from "../Collapsible";
import { Kpi, PageHeader } from "../ui-kit";
import { CopySummaryButton } from "./CopySummaryButton";
import { AgentFilter } from "./AgentFilter";
import { buildMethodLabels, methodLabel } from "@/lib/dashboard/methodLabels";

export const dynamic = "force-dynamic";

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
  return <Kpi label={label} value={value} sub={sub} valueClassName={accent} />;
}

/**
 * En qué moneda está leída la pantalla, y por qué.
 *
 * Tres estados, y los tres importan:
 *  - **Un agente filtrado** → se lee en SU moneda, sin convertir nada. Es la foto
 *    real de ese mercado (un ROAS de EE.UU. en pesos no dice nada a quien compra
 *    la pauta en dólares), así que se enuncia para que nadie lea USD como COP.
 *  - **Todos los agentes con monedas distintas** → total homologado + la tasa a la
 *    vista: un total convertido sin la tasa se lee como plata en caja.
 *  - **Todos los agentes con la MISMA moneda** → normalmente no hay nada que decir,
 *    salvo que haya varios mercados: ahí es sospechoso, y es exactamente el error
 *    que tuvimos (México y EE.UU. marcados en COP, y sus ventas sumadas crudas).
 *    `agents.currency` trae `default 'COP'`, así que "sin configurar" y "vende en
 *    pesos" se ven IGUAL en la base — la única defensa es decirlo en pantalla.
 *
 * Ver ADR-0068 y ADR-0077.
 */
function CurrencyNote({
  currency,
  converted,
  excluded = 0,
  selected,
  marketCurrencies,
  agentCount,
}: {
  currency: CurrencyCode;
  converted: boolean;
  excluded?: number;
  /** Nombre del agente filtrado, o null viendo todos. */
  selected?: string | null;
  /** Monedas DISTINTAS configuradas entre los agentes del sistema. */
  marketCurrencies?: CurrencyCode[];
  agentCount?: number;
}) {
  const sospechoso =
    !selected && !converted && (marketCurrencies?.length ?? 0) === 1 && (agentCount ?? 0) > 1;

  const cuerpo = selected ? (
    <>
      <span className="font-medium">
        Leyendo en {currency} · {CURRENCY_LABELS[currency]}
      </span>{" "}
      — la moneda de {selected}. Sin conversiones: son sus precios tal cual.
    </>
  ) : converted ? (
    <>
      <span className="font-medium">Todos los mercados sumados en {currency}.</span> Las ventas en
      otra moneda se convierten para poder sumarlas: {rateNote(currency)}. Filtra un agente arriba
      para ver su mercado en su propia moneda.
    </>
  ) : sospechoso ? (
    <>
      <span className="font-medium">
        Los {agentCount} agentes están configurados en {currency}
      </span>
      , así que no hay nada que homologar. Si algún mercado vende en otra moneda, ponlo en{" "}
      <Link href="/dashboard/agents" className="font-medium underline underline-offset-2">
        Agentes
      </Link>{" "}
      → &quot;En qué moneda vende&quot;: hasta entonces sus ventas se suman como si fueran{" "}
      {currency}.
    </>
  ) : null;

  if (!cuerpo && excluded === 0) return null;

  // Ámbar = hay algo que revisar (una conversión de por medio o un mercado sin
  // configurar). Gris = solo estás informado de en qué moneda estás parado.
  const alerta = converted || sospechoso || excluded > 0;
  return (
    <p
      className={
        alerta
          ? "rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900"
          : "rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-500"
      }
    >
      {cuerpo}
      {excluded > 0 && (
        <>
          {cuerpo ? " " : ""}
          {excluded} {excluded === 1 ? "orden quedó" : "órdenes quedaron"} fuera del monto por
          estar en una moneda sin tasa (sí cuentan como órdenes).
        </>
      )}
    </p>
  );
}

function buildSummary(
  r: SalesReport,
  c: ConversionReport,
  roas: RoasScalingReport,
  speed: CloseSpeedReport,
  scope: string,
): string {
  // El retorno solo entra al resumen si hay una lectura consolidable (una moneda
  // y costo configurado); si no, se omite en vez de mandar un "—" al equipo.
  const roasLine =
    roas.total && roas.total.roas != null
      ? [
          // La FUENTE de la inversión va en el texto que se comparte: quien recibe
          // el resumen por WhatsApp no ve la etiqueta de la pantalla.
          `Retorno (ROAS): ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(roas.total.roas)}× · ${formatMoney(roas.total.revenue, roas.total.currency)} sobre ${formatMoney(roas.total.investment, roas.total.currency)} de pauta ${SPEND_SOURCE_STYLE[roas.spendSource] ? `(${SPEND_SOURCE_STYLE[roas.spendSource]!.text})` : ""} (${formatNumber(roas.total.chats)} chats)`,
        ]
      : [];
  const speedLine =
    speed.closes > 0
      ? [
          `Cierre mediano: ${formatMinutes(speed.medianMinutes)} · ${formatPercent(speed.withinHourRate)} en la primera hora`,
        ]
      : [];
  const month = roas.scaling.month;
  const projLine =
    month && roas.total
      ? [
          `Proyección del mes (a ritmo actual): ${formatMoney(month.projectedRevenue, roas.total.currency)} · ~${formatNumber(month.projectedOrders)} órdenes`,
        ]
      : [];
  return [
    `Reporte de ventas — ${scope}`,
    `Ventas confirmadas: ${r.confirmed.count} · ${formatMoney(r.confirmed.revenue, r.currency)}`,
    `En curso (sin confirmar): ${r.pipeline.count} · ${formatMoney(r.pipeline.revenue, r.currency)}`,
    `Órdenes generadas: ${r.generated.count} · ${formatMoney(r.generated.revenue, r.currency)}`,
    `Canceladas: ${r.cancelled.count}`,
    `Conversión: ${formatPercent(c.total.rate)} (${c.total.transactions}/${c.total.conversations} conversaciones)`,
    ...roasLine,
    ...speedLine,
    ...projLine,
    `Hoy: ${r.today.count} (${formatMoney(r.today.revenue, r.currency)}) · 7 días: ${r.last7.count} (${formatMoney(r.last7.revenue, r.currency)}) · 30 días: ${r.last30.count} (${formatMoney(r.last30.revenue, r.currency)})`,
    // Si el alcance mezcla mercados, el resumen que se comparte por WhatsApp tiene
    // que decir en qué moneda está leído: si no, alguien lee dólares como pesos.
    ...(r.converted ? [`Todos los mercados sumados en ${r.currency} · ${rateNote(r.currency)}`] : []),
  ].join("\n");
}

/** Un ROAS se lee como "×": 3.2 = por cada $1 de pauta entran $3,20. */
function formatRoas(roas: number | null): string {
  if (roas == null) return "—";
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(roas)}×`;
}

/** Verde si el retorno paga la pauta, ámbar si empata, rojo si pierde. */
function roasTone(roas: number | null): string {
  if (roas == null) return "text-slate-400";
  if (roas >= 2) return "text-emerald-700";
  if (roas >= 1) return "text-amber-700";
  return "text-rose-700";
}

/**
 * De dónde salió la plata que se muestra como inversión. Va pegado al número y no
 * en una nota al pie a propósito: "$4.200.000 de pauta" significa cosas MUY
 * distintas si es lo que cobró Meta o si es un promedio tecleado hace tres meses,
 * y quien mira la cifra tiene que enterarse ahí mismo. Ver ADR-0082.
 */
const SPEND_SOURCE_STYLE: Record<SpendSource, { text: string; cls: string; title: string } | null> = {
  real: {
    text: "real",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    title: "Gasto reportado por la plataforma de anuncios.",
  },
  mixed: {
    text: "mixto",
    cls: "border-amber-200 bg-amber-50 text-amber-800",
    title: "Unos días con gasto reportado y otros estimados con el costo por chat.",
  },
  estimated: {
    text: "estimado",
    cls: "border-slate-200 bg-slate-50 text-slate-500",
    title: "Calculado como chats × costo por chat configurado a mano.",
  },
  none: null,
};

function SpendSourceBadge({ source }: { source: SpendSource }) {
  const style = SPEND_SOURCE_STYLE[source];
  if (!style) return null;
  return (
    <span
      title={style.title}
      className={`ml-1 rounded-full border px-1.5 py-px align-middle text-[10px] font-medium ${style.cls}`}
    >
      {style.text}
    </span>
  );
}

/**
 * Estado del feed de gasto real: si llega, hasta qué día llegó, y cuántos leads
 * dice la plataforma frente a los chats que de verdad escribieron.
 *
 * La brecha leads↔chats NO es un error a corregir: la plataforma cuenta clics en
 * el anuncio y nosotros contamos gente que abrió conversación. Verla es el punto.
 */
function AdSpendNote({ roas }: { roas: RoasReport }) {
  const today = bogotaDayKey(Date.now());
  if (roas.realSpendDays === 0) {
    return (
      <p className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Todavía no llega <strong>gasto real de pauta</strong>: la inversión de arriba es una
        estimación (chats × costo por chat). Cuando la plataforma de anuncios empiece a mandar el
        gasto a la API, estos números pasan a ser el dinero que se pagó de verdad.
      </p>
    );
  }

  // "Hace cuántos días" contra hoy en Bogota. Si el último dato es de anteayer o
  // antes, el envío se cayó y hay que decirlo — el reporte se ve igual de bonito
  // con datos viejos, que es exactamente el problema.
  const lastMs = Date.parse(`${roas.lastRealSpendDate}T12:00:00-05:00`);
  const todayMs = Date.parse(`${today}T12:00:00-05:00`);
  const daysBehind = Math.round((todayMs - lastMs) / 86_400_000);
  const stale = daysBehind >= 2;
  const leads = roas.total?.platformLeads ?? null;

  return (
    <p
      className={`mt-2 rounded-xl border px-3 py-2 text-xs ${
        stale
          ? "border-amber-200 bg-amber-50/70 text-amber-900"
          : "border-emerald-200 bg-emerald-50/70 text-emerald-900"
      }`}
    >
      <span className="font-medium">
        Gasto real de pauta: {formatNumber(roas.realSpendDays)}{" "}
        {roas.realSpendDays === 1 ? "día reportado" : "días reportados"}
      </span>
      , el último el {formatDayKeyShort(roas.lastRealSpendDate!)}
      {stale ? ` (hace ${daysBehind} días — revisa el envío)` : ""}.
      {leads != null && roas.total ? (
        <>
          {" "}
          La plataforma reporta <strong>{formatNumber(leads)}</strong>{" "}
          {leads === 1 ? "lead" : "leads"} y llegaron{" "}
          <strong>{formatNumber(roas.total.chats)}</strong> chats
          {leads > 0 ? ` (${formatPercent(roas.total.chats / leads)} de los leads escribió)` : ""}.
        </>
      ) : null}{" "}
      Los días sin dato se estiman con el costo por chat del agente.
    </p>
  );
}

function RoasTableRow({ row, strong }: { row: RoasRow; strong?: boolean }) {
  const cell = strong ? "py-2 font-medium text-slate-900" : "py-2 text-slate-700";
  return (
    <tr className={strong ? "border-t-2 border-slate-200 bg-slate-50/60" : undefined}>
      <td className={cell}>
        {row.name}
        {row.brand ? <span className="ml-1 text-xs text-slate-400">{row.brand}</span> : null}
      </td>
      <td className={`${cell} text-right tabular-nums`}>{formatNumber(row.chats)}</td>
      <td className={`${cell} text-right tabular-nums`}>
        {row.costPerChat != null ? (
          formatMoney(row.costPerChat, row.currency)
        ) : (
          <span className="text-slate-400">sin configurar</span>
        )}
      </td>
      <td className={`${cell} text-right tabular-nums`}>
        {row.aiCostPerChat != null ? (
          formatMoney(row.aiCostPerChat, row.currency)
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className={`${cell} text-right tabular-nums`}>
        {formatMoney(row.investment, row.currency)}
        <SpendSourceBadge source={row.spendSource} />
      </td>
      <td className={`${cell} text-right tabular-nums`}>
        {formatMoney(row.revenue, row.currency)}
        <span className="ml-1 text-xs text-slate-400">{formatNumber(row.orders)}</span>
      </td>
      <td className={`${cell} text-right tabular-nums`}>
        {row.costPerOrder != null ? (
          formatMoney(row.costPerOrder, row.currency)
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className={`py-2 text-right font-semibold tabular-nums ${roasTone(row.roas)}`}>
        {formatRoas(row.roas)}
      </td>
      <td className={`py-2 text-right tabular-nums ${roasTone(row.confirmedRoas)}`}>
        {formatRoas(row.confirmedRoas)}
      </td>
      <td className={`py-2 text-right tabular-nums ${roasTone(row.roais)}`}>
        {formatRoas(row.roais)}
      </td>
    </tr>
  );
}

/** Sección de retorno: tabla por agente + barras de inversión vs. ventas por día. */
function RoasSection({
  roas,
  selected,
  marketCurrencies,
  agentCount,
}: {
  roas: RoasReport;
  selected: string | null;
  marketCurrencies: CurrencyCode[];
  agentCount: number;
}) {
  const maxDay = Math.max(1, ...roas.perDay.map((d) => Math.max(d.revenue, d.investment)));
  const chartCurrency = roas.currency;
  const mismatched = roas.rows.filter((r) => r.currencyMismatch);
  const invTotal14 = roas.perDay.reduce((s, d) => s + d.investment, 0);
  const revTotal14 = roas.perDay.reduce((s, d) => s + d.revenue, 0);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">Retorno (ROAS)</h2>
          <p className="max-w-prose text-xs text-slate-400">
            Ventas generadas ÷ lo que costó traer los chats. Un <strong>chat</strong> es una
            conversación en la que el cliente escribió. La inversión sale del{" "}
            <strong>gasto real</strong> que reporta la plataforma de anuncios cuando lo hay, y de
            lo contrario del costo por chat que cada agente tiene configurado (un promedio).{" "}
            <strong>ROAS 3×</strong> = por cada $1 de pauta entran $3.{" "}
            <strong>Costo IA/chat</strong> = todo el gasto de IA del agente (tokens, imágenes,
            audios y llamadas, convertido de USD) ÷ chats, y <strong>ROAIS</strong> = ventas ÷ ese
            gasto de IA. No incluye la tarifa de plantillas de Meta (aún no se registra).
          </p>
        </div>
        {roas.total ? (
          <div className="text-right">
            <p className={`text-2xl font-semibold tracking-tight ${roasTone(roas.total.roas)}`}>
              {formatRoas(roas.total.roas)}
            </p>
            <p className="text-xs text-slate-500">
              {formatMoney(roas.total.revenue, roas.total.currency)} sobre{" "}
              {formatMoney(roas.total.investment, roas.total.currency)}
              <SpendSourceBadge source={roas.spendSource} />
            </p>
          </div>
        ) : null}
      </div>

      <div className="mb-3">
        <CurrencyNote
          currency={roas.currency}
          converted={roas.converted}
          selected={selected}
          marketCurrencies={marketCurrencies}
          agentCount={agentCount}
        />
        <AdSpendNote roas={roas} />
        {roas.excludedAgents > 0 ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
            {roas.excludedAgents}{" "}
            {roas.excludedAgents === 1 ? "agente quedó" : "agentes quedaron"} fuera del consolidado:
            su moneda no tiene tasa configurada.
          </p>
        ) : null}
        {/* Vender en una moneda y pagar la pauta en otra es legítimo (Meta cobra en
            dólares), pero es también la forma exacta que toma el mercado a medio
            configurar. Se pregunta en vez de tragárselo. Ver ADR-0079. */}
        {mismatched.length > 0 ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
            <span className="font-medium">
              {mismatched.length === 1 ? "Un agente vende" : `${mismatched.length} agentes venden`}{" "}
              en una moneda y {mismatched.length === 1 ? "paga" : "pagan"} la pauta en otra:
            </span>{" "}
            {mismatched
              .map((r) => `${r.name} vende en ${r.currency} y pauta en ${r.costCurrency}`)
              .join(" · ")}
            . Si es así, todo bien (la pauta se convierte para calcular el retorno). Si no,
            corrígelo en{" "}
            <Link href="/dashboard/agents" className="font-medium underline underline-offset-2">
              Agentes
            </Link>
            .
          </p>
        ) : null}
      </div>

      {!roas.configured ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          No hay de dónde sacar la inversión todavía. Dos caminos, y se pueden usar los dos: manda
          el <strong>gasto real</strong> desde la plataforma de anuncios a la API (
          <code className="rounded bg-slate-100 px-1 py-px text-[11px]">POST /api/ingest/ad-spend</code>
          ), o configura un <strong>costo por chat</strong> promedio en{" "}
          <Link
            href="/dashboard/agents"
            className="font-medium text-slate-900 underline underline-offset-2"
          >
            Agentes
          </Link>{" "}
          (por ejemplo, 1.000 COP por chat en Colombia). Con cualquiera de los dos, este cuadro
          calcula el retorno; si llegan los dos, manda el gasto real día por día.
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="pb-2 font-medium">Agente</th>
              <th className="pb-2 text-right font-medium">Chats</th>
              <th className="pb-2 text-right font-medium">Costo/chat</th>
              <th className="pb-2 text-right font-medium">Costo IA/chat</th>
              <th className="pb-2 text-right font-medium">Inversión</th>
              <th className="pb-2 text-right font-medium">Ventas</th>
              <th className="pb-2 text-right font-medium">Costo/venta</th>
              <th className="pb-2 text-right font-medium">ROAS</th>
              <th className="pb-2 text-right font-medium">ROAS confirm.</th>
              <th className="pb-2 text-right font-medium">ROAIS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roas.rows.length === 0 ? (
              <tr>
                <td className="py-3 text-slate-400" colSpan={10}>
                  No hay agentes en este alcance.
                </td>
              </tr>
            ) : (
              roas.rows.map((r) => <RoasTableRow key={r.agentId ?? r.name} row={r} />)
            )}
            {roas.total && roas.rows.length > 1 ? (
              <RoasTableRow row={roas.total} strong />
            ) : null}
          </tbody>
        </table>
      </div>

      {roas.total === null ? (
        <p className="mt-3 text-xs text-amber-700">
          Los agentes de este alcance usan monedas distintas, así que no se consolidan ni se
          grafican: sumar pesos con dólares daría un retorno falso. Filtra por un agente para ver
          su serie.
        </p>
      ) : (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-rose-400" aria-hidden="true" />
              Inversión
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />
              Ventas
            </span>
            {roas.perDay.some((d) => d.real) ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full border border-emerald-500 bg-emerald-500"
                  aria-hidden="true"
                />
                Gasto reportado
              </span>
            ) : null}
            {/* El total del periodo, a la vista: el gráfico dice el día a día y
                esta línea dice cuánto fue en plata. */}
            <span className="ml-auto tabular-nums">
              Últimos 14 días: <span className="text-rose-600">{formatMoney(invTotal14, chartCurrency)}</span>{" "}
              → <span className="font-medium text-emerald-700">{formatMoney(revTotal14, chartCurrency)}</span>
            </span>
          </div>
          <ul className="space-y-2">
            {roas.perDay.map((d) => (
              <li
                key={d.date}
                className="flex items-center gap-3"
                title={`${formatDayKeyShort(d.date)} · Inversión ${formatMoney(d.investment, chartCurrency)} (${d.real ? "gasto reportado" : "estimada"}) · Ventas ${formatMoney(d.revenue, chartCurrency)} · ${d.chats} chats · ROAS ${formatRoas(d.roas)}`}
              >
                <span className="flex w-14 shrink-0 items-center gap-1 text-xs text-slate-500">
                  {/* Punto lleno = ese día la inversión es plata reportada; hueco =
                      estimada. Sin esto, dos barras idénticas cuentan historias
                      distintas y no hay forma de saber cuál es cuál. */}
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full border ${
                      d.real ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-transparent"
                    }`}
                  />
                  {formatDayKeyShort(d.date)}
                </span>
                {/* Dos barras a la misma escala: se ve de un vistazo si el verde
                    (ventas) le gana al rojo (pauta) ese día — con el monto al lado. */}
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 flex-1 overflow-hidden rounded bg-slate-100">
                      <div
                        className="h-full rounded bg-rose-400"
                        style={{ width: `${Math.round((d.investment / maxDay) * 100)}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-rose-500">
                      {formatMoney(d.investment, chartCurrency)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 flex-1 overflow-hidden rounded bg-slate-100">
                      <div
                        className="h-full rounded bg-emerald-500"
                        style={{ width: `${Math.round((d.revenue / maxDay) * 100)}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-[11px] font-medium tabular-nums text-emerald-700">
                      {formatMoney(d.revenue, chartCurrency)}
                    </span>
                  </div>
                </div>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {d.chats}
                </span>
                <span
                  className={`w-14 shrink-0 text-right text-xs font-medium tabular-nums ${roasTone(d.roas)}`}
                >
                  {formatRoas(d.roas)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Crecimiento con signo: +12,5 % en verde, −8 % en rojo, "—" si no hay base. */
function Growth({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  const tone = value > 0 ? "text-emerald-700" : value < 0 ? "text-rose-700" : "text-slate-500";
  return (
    <span className={`font-medium tabular-nums ${tone}`}>
      {value > 0 ? "+" : ""}
      {formatPercent(value)}
    </span>
  );
}

/**
 * Sección de escala (ADR-0070): cuánto deja CADA chat después de pauta e IA, a
 * dónde va el mes al ritmo actual y si la operación crece semana contra semana.
 */
/**
 * Color de cada agente en la barra apilada. Fijo por POSICIÓN (el orden de agentes
 * es estable entre semanas), para que un mercado no cambie de color de fila en fila.
 */
const AGENT_COLORS = ["#0f766e", "#6366f1", "#f59e0b", "#e11d48", "#0891b2", "#7c3aed"];

/**
 * Semana a semana: de dónde vinieron los chats y cuánto se vendió.
 *
 * El día a día de WhatsApp es ruido (un festivo, la pauta que arrancó tarde) y el
 * mes tarda demasiado en decir algo; la semana es la unidad en la que se decide
 * subir o bajar presupuesto. Partir los chats por agente responde la pregunta que
 * un total no responde: **cuál** mercado está creciendo. Ver ADR-0079.
 */
function WeeklySection({ weekly }: { weekly: WeeklyReport }) {
  const maxChats = Math.max(1, ...weekly.weeks.map((w) => w.chats));
  const maxRevenue = Math.max(1, ...weekly.weeks.map((w) => w.revenue));
  const hasData = weekly.weeks.some((w) => w.chats > 0 || w.orders > 0);
  const colorOf = (i: number) => AGENT_COLORS[i % AGENT_COLORS.length];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">
            Semana a semana · chats por agente y ventas
          </h2>
          <p className="max-w-prose text-xs text-slate-400">
            Semanas de lunes a domingo (hora Colombia). La barra son los <strong>chats</strong>
            {" "}que entraron, partidos por el agente que los atendió; a la derecha, las{" "}
            <strong>ventas</strong> cerradas esa semana y qué porcentaje de los chats
            terminó en orden. Un chat cuenta el día que llegó y una orden el día que se
            creó — las mismas bases que el ROAS.
            {weekly.converted ? ` Ventas homologadas a ${weekly.currency}.` : ""}
          </p>
        </div>
        {weekly.agents.length > 1 ? (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {weekly.agents.map((a, i) => (
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
        ) : null}
      </div>

      {!hasData ? (
        <p className="py-2 text-sm text-slate-400">Aún no hay actividad para agrupar por semana.</p>
      ) : (
        <ul className="space-y-2">
          {weekly.weeks.map((w) => (
            <li key={w.weekStart} className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr_11rem]">
              <span className="text-xs text-slate-500">
                {formatDayKeyShort(w.weekStart)}
                {w.partial ? (
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-600">
                    en curso
                  </span>
                ) : null}
              </span>

              <div className="flex items-center gap-2">
                {/* Barra apilada: un segmento por agente, ancho proporcional a la
                    semana más alta del periodo (no a cada fila) para poder
                    comparar semanas de un vistazo. */}
                <div className="flex h-5 flex-1 items-stretch overflow-hidden rounded bg-slate-100">
                  {w.byAgent.map((a, i) =>
                    a.chats > 0 ? (
                      <div
                        key={a.agentId}
                        title={`${a.name}: ${formatNumber(a.chats)} ${a.chats === 1 ? "chat" : "chats"}`}
                        style={{
                          width: `${(a.chats / maxChats) * 100}%`,
                          backgroundColor: colorOf(i),
                        }}
                      />
                    ) : null,
                  )}
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-700">
                  {formatNumber(w.chats)}
                </span>
              </div>

              <div className="flex items-center justify-end gap-3">
                {/* Segunda barra, escala propia: la plata no se compara con chats,
                    se compara con las otras semanas. */}
                <div className="hidden h-1.5 w-16 overflow-hidden rounded bg-slate-100 sm:block">
                  <div
                    className="h-full rounded bg-emerald-500/80"
                    style={{ width: `${Math.round((w.revenue / maxRevenue) * 100)}%` }}
                  />
                </div>
                <span
                  className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-900"
                  title={`${formatNumber(w.orders)} ${w.orders === 1 ? "orden" : "órdenes"}`}
                >
                  {formatMoney(w.revenue, weekly.currency)}
                </span>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {w.conversion != null ? formatPercent(w.conversion) : "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScalingSection({ scaling, currency }: { scaling: ScalingReport; currency: string }) {
  const { perChat, month, wow } = scaling;
  const projGrowth =
    month && month.prevRevenue > 0
      ? (month.projectedRevenue - month.prevRevenue) / month.prevRevenue
      : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3">
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">
          Escala: economía por chat y proyección
        </h2>
        <p className="max-w-prose text-xs text-slate-400">
          Lo que deja <strong>un chat</strong> después de pagar pauta e IA (antes de producto y
          logística), a dónde va el mes si sigue a este ritmo, y si la operación crece o se frena
          semana contra semana. Mismos hechos que el cuadro de retorno: los números cuadran.
        </p>
      </div>

      {perChat === null && month === null ? (
        <p className="text-xs text-amber-700">
          Los agentes de este alcance usan monedas distintas, así que no se consolida la plata.
          Filtra por un agente para ver su economía; el crecimiento de chats sí se muestra abajo.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {perChat ? (
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <p className="text-xs font-medium text-slate-500">Margen por chat</p>
            <p
              className={`mt-1 font-display text-xl font-semibold tracking-tight ${
                perChat.margin >= 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {formatMoney(perChat.margin, perChat.currency)}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-slate-500">
              vende {formatMoney(perChat.revenue, perChat.currency)} − pauta{" "}
              {formatMoney(perChat.adCost, perChat.currency)} − IA{" "}
              {formatMoney(perChat.aiCost, perChat.currency)}
            </p>
          </div>
        ) : null}

        {month ? (
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <p className="text-xs font-medium text-slate-500">Proyección del mes</p>
            <p className="mt-1 font-display text-xl font-semibold tracking-tight text-slate-900">
              {formatMoney(month.projectedRevenue, currency)}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-slate-500">
              van {formatMoney(month.revenueMtd, currency)} en {month.daysElapsed} de{" "}
              {month.daysInMonth} días · ~{formatNumber(month.projectedOrders)} órdenes
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-slate-500">
              mes pasado {formatMoney(month.prevRevenue, currency)}
              {projGrowth != null ? (
                <>
                  {" "}
                  → <Growth value={projGrowth} />
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <p className="text-xs font-medium text-slate-500">Crecimiento semanal</p>
          <p className="mt-1 font-display text-xl font-semibold tracking-tight text-slate-900">
            <Growth value={wow.chatsGrowth} />
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-slate-500">
            chats: {formatNumber(wow.chats7)} esta semana vs. {formatNumber(wow.chatsPrev7)} la
            anterior
          </p>
          {wow.revenue7 != null && wow.revenuePrev7 != null ? (
            <p className="mt-0.5 text-xs tabular-nums text-slate-500">
              ventas: {formatMoney(wow.revenue7, currency)} vs.{" "}
              {formatMoney(wow.revenuePrev7, currency)} · <Growth value={wow.revenueGrowth} />
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
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

/** Nombre largo del día, para la frase de la mejor franja. */
const WEEKDAY_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Franja de 3 horas: `[8,11)` se lee "8–11h". */
const BLOCK_HOURS = 3;

/**
 * Mapa de calor "cuándo se vende": día de la semana × hora (Colombia). Los cortes
 * sueltos por día y por hora que ya existían promedian la otra dimensión y
 * esconden lo único accionable — la FRANJA. Con esto se decide a qué hora
 * empujar pauta, cuándo reforzar la atención humana y a qué hora mandar los
 * retargets, en vez de repartir presupuesto plano las 24 horas.
 */
function SalesHeatmap({ report }: { report: SalesReport }) {
  const grid = report.byWeekdayHour;
  const maxCell = Math.max(1, ...grid.flat().map((b) => b.revenue));
  const totalRevenue = grid.flat().reduce((s, b) => s + b.revenue, 0);
  const totalCount = grid.flat().reduce((s, b) => s + b.count, 0);

  // Mejores franjas de 3 h: una hora suelta es ruido estadístico con pocas
  // órdenes; un bloque de 3 h es una decisión ("pauta de 6 a 9 de la noche").
  const blocks: Array<{ weekday: number; start: number; revenue: number; count: number }> = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h += BLOCK_HOURS) {
      let revenue = 0;
      let count = 0;
      for (let k = 0; k < BLOCK_HOURS; k++) {
        revenue += grid[d][h + k].revenue;
        count += grid[d][h + k].count;
      }
      blocks.push({ weekday: d, start: h, revenue, count });
    }
  }
  blocks.sort((a, b) => b.revenue - a.revenue || b.count - a.count);
  const top = blocks.filter((b) => b.count > 0).slice(0, 3);
  const topShare = totalRevenue > 0 ? top.reduce((s, b) => s + b.revenue, 0) / totalRevenue : 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">
            Cuándo se vende · día × hora
          </h2>
          <p className="max-w-prose text-xs text-slate-400">
            Cada celda es una hora de un día de la semana (hora Colombia): más oscuro = más plata
            vendida ahí. Sirve para decidir a qué hora empujar pauta, cuándo tener a alguien
            atento y a qué hora salen los retargets. Órdenes generadas (sin canceladas)
            {report.converted ? `, homologadas a ${report.currency}` : ""}.
          </p>
        </div>
        {top.length > 0 ? (
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500">Mejor franja</p>
            <p className="font-display text-lg font-semibold tracking-tight text-slate-900">
              {WEEKDAY_LONG[top[0].weekday]} {String(top[0].start).padStart(2, "0")}–
              {String(top[0].start + BLOCK_HOURS).padStart(2, "0")}h
            </p>
            <p className="text-xs text-slate-500">
              {formatMoney(top[0].revenue, report.currency)} · {formatNumber(top[0].count)}{" "}
              {top[0].count === 1 ? "orden" : "órdenes"}
            </p>
          </div>
        ) : null}
      </div>

      {totalCount === 0 ? (
        <p className="py-2 text-sm text-slate-400">Aún no hay órdenes para dibujar el mapa.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[40rem]">
              {/* Regla de horas: cada 3 h, alineada con las columnas de abajo. */}
              <div className="mb-1 flex items-center gap-1 pl-10">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="flex-1 text-center text-[10px] tabular-nums text-slate-400">
                    {h % BLOCK_HOURS === 0 ? String(h).padStart(2, "0") : ""}
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                {WEEKDAYS.map(({ i, l }) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className="w-10 shrink-0 text-xs text-slate-500">{l}</span>
                    {grid[i].map((cell, h) => {
                      // Escala relativa al mejor momento del periodo. Piso de 0,08
                      // para que una celda con UNA venta no se lea como vacía.
                      const intensity =
                        cell.revenue > 0 ? 0.08 + 0.92 * (cell.revenue / maxCell) : 0;
                      return (
                        <div
                          key={h}
                          title={`${l} ${String(h).padStart(2, "0")}:00 · ${formatNumber(cell.count)} ${cell.count === 1 ? "orden" : "órdenes"} · ${formatMoney(cell.revenue, report.currency)}`}
                          className={`h-6 flex-1 rounded-[3px] ${
                            cell.count === 0 ? "bg-slate-100" : "ring-1 ring-inset ring-emerald-900/5"
                          }`}
                          style={
                            intensity > 0
                              ? { backgroundColor: `rgba(5, 150, 105, ${intensity.toFixed(3)})` }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>Menos</span>
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <span
                  key={v}
                  className="h-3 w-6 rounded-[3px]"
                  style={{
                    backgroundColor:
                      v === 0 ? "rgb(241, 245, 249)" : `rgba(5, 150, 105, ${0.08 + 0.92 * v})`,
                  }}
                />
              ))}
              <span>Más</span>
            </div>
            {top.length > 0 ? (
              <p className="text-xs text-slate-500">
                Las 3 mejores franjas concentran{" "}
                <span className="font-medium text-slate-900">{formatPercent(topShare)}</span> de la
                plata:{" "}
                {top
                  .map(
                    (b) =>
                      `${WEEKDAY_LONG[b.weekday].slice(0, 3)} ${String(b.start).padStart(2, "0")}–${String(b.start + BLOCK_HOURS).padStart(2, "0")}h`,
                  )
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  const agents = await getAgents();
  // Etiquetas de método por su clave: las configuradas por los agentes (ADR-0055)
  // sobre los fallbacks históricos. Mismo helper que Órdenes y Conversaciones.
  const methodLabels = buildMethodLabels(agents);
  // Agente seleccionado: el del query (?agent=) si existe, o undefined = consolidado.
  const selected =
    searchParams.agent && agents.some((a) => a.id === searchParams.agent)
      ? agents.find((a) => a.id === searchParams.agent)!
      : null;
  const agentId = selected?.id;
  const scope = selected
    ? `${selected.name}${selected.brand ? ` · ${selected.brand}` : ""}`
    : "Todos los agentes";
  // Monedas DISTINTAS configuradas entre los agentes. Si hay varios mercados y
  // todos dicen lo mismo, huele a moneda sin configurar (ver `CurrencyNote`).
  const marketCurrencies = [...new Set(agents.map((a) => a.currency))];

  const [r, conv, ai, products, voice, roas, topProducts, speed] = await Promise.all([
    getSalesReport(agentId),
    getConversionReport(agentId),
    getAiCostReport(agentId),
    getProductConversion(agentId),
    getVoiceCallStats(agentId),
    getRoasReport(agentId),
    getTopProducts(agentId),
    getCloseSpeed(agentId),
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

  // Participación por producto (chats vs. plata): misma unidad (%) para poder
  // compararlas en un solo gráfico. Solo categorías reales (sin "Sin categoría").
  const prodShareRows = products.rows.filter((p) => p.category !== null).slice(0, 8);
  const totalProdConvs = Math.max(1, prodShareRows.reduce((s, p) => s + p.conversations, 0));
  const totalProdRevenue = Math.max(1, prodShareRows.reduce((s, p) => s + p.revenue, 0));

  const topRows = topProducts.rows.slice(0, 12);
  const maxTopRevenue = Math.max(1, ...topRows.map((p) => p.revenue));
  const maxSpeedBucket = Math.max(1, ...speed.buckets.map((b) => b.count));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes"
        description={
          selected ? (
            <>
              Ventas y actividad de <span className="font-medium text-slate-700">{scope}</span>.
              Comparte el resumen con el equipo.
            </>
          ) : (
            <>Ventas generadas por el agente. Comparte el resumen con el equipo.</>
          )
        }
        actions={<CopySummaryButton summary={buildSummary(r, conv, roas, speed, scope)} />}
      />

      {agents.length > 1 && (
        <AgentFilter
          agents={agents.map((a) => ({ id: a.id, name: a.name, brand: a.brand }))}
          current={agentId ?? ""}
        />
      )}

      {/* Titulares */}
      <section className="space-y-2">
        {/* El aviso va ARRIBA de los números, no en letra chica al final: quien
            lee "$1.156" tiene que saber, antes de creerlo, que ahí adentro hay
            dólares y pesos mexicanos convertidos. */}
        <CurrencyNote
          currency={r.currency}
          converted={r.converted}
          excluded={r.excluded}
          selected={selected ? scope : null}
          marketCurrencies={marketCurrencies}
          agentCount={agents.length}
        />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ReportCard
          label="Ventas confirmadas"
          value={formatMoney(r.confirmed.revenue, r.currency)}
          sub={`${formatNumber(r.confirmed.count)} ${r.confirmed.count === 1 ? "orden" : "órdenes"}`}
          accent="text-emerald-700"
        />
        <ReportCard
          label="En curso (sin confirmar)"
          value={formatMoney(r.pipeline.revenue, r.currency)}
          sub={`${formatNumber(r.pipeline.count)} en pipeline`}
          accent="text-indigo-700"
        />
        <ReportCard
          label="Órdenes generadas"
          value={formatNumber(r.generated.count)}
          sub={`${formatMoney(r.generated.revenue, r.currency)} · sin canceladas`}
        />
        <ReportCard
          label="Canceladas"
          value={formatNumber(r.cancelled.count)}
          sub={`de ${formatNumber(r.totalOrders)} en total`}
          accent="text-rose-700"
        />
      </div>
      </section>

      {/* Ventanas de tiempo */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Hoy", b: r.today },
          { label: "Últimos 7 días", b: r.last7 },
          { label: "Últimos 30 días", b: r.last30 },
        ].map((w) => (
          <div key={w.label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium text-slate-500">{w.label}</p>
            <p className="mt-1 font-display text-xl font-semibold tracking-tight text-slate-900">
              {formatMoney(w.b.revenue, r.currency)}
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
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">Costo IA</h2>
          <p className="text-xs text-slate-400">
            Consumo real del agente con gpt-5-mini. El costo de imágenes (visión) es estimado
            (sus tokens vienen dentro de los del modelo); el total es exacto.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
            label="Llamadas con IA"
            value={formatUsd4(voice.totalCostUsd)}
            sub={`${voice.completed} contestadas · ${voice.totalMinutes} min · estimado`}
          />
          <ReportCard
            label="Costo IA total"
            value={formatUsd4(ai.totalCostUsd + voice.totalCostUsd)}
            sub="texto + imágenes + audio + llamadas"
            accent="text-indigo-700"
          />
        </div>
      </section>

      {/* Retorno sobre el costo de adquirir cada chat (ADR-0065) */}
      <RoasSection
        roas={roas}
        selected={selected ? scope : null}
        marketCurrencies={marketCurrencies}
        agentCount={agents.length}
      />

      {/* Economía por chat, proyección del mes y crecimiento semanal (ADR-0070) */}
      <ScalingSection scaling={roas.scaling} currency={roas.currency} />

      {/* Semana a semana: chats por agente vs. ventas (ADR-0079) */}
      <WeeklySection weekly={roas.weekly} />

      {/* Conversión: conversaciones → transacciones */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">Conversión</h2>
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

      {/* Velocidad de cierre: primer contacto → primera orden (+ recompras) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">
              Velocidad de cierre
            </h2>
            <p className="max-w-prose text-xs text-slate-400">
              Tiempo entre el primer mensaje del cliente y su <strong>primera orden</strong> (sin
              canceladas). La mediana dice en cuánto cierra la mitad de las ventas; las órdenes
              siguientes de un mismo cliente cuentan como recompra, no como cierre.
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tracking-tight text-slate-900">
              {formatMinutes(speed.medianMinutes)}
            </p>
            <p className="text-xs text-slate-500">
              mediana de {formatNumber(speed.closes)} {speed.closes === 1 ? "cierre" : "cierres"}
            </p>
          </div>
        </div>

        {speed.closes === 0 ? (
          <p className="py-2 text-sm text-slate-400">Aún no hay órdenes para medir.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
            <ul className="space-y-1.5">
              {speed.buckets.map((b) => (
                <li key={b.label} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-slate-500">
                    {b.label}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full rounded bg-indigo-500/80"
                      style={{ width: `${Math.round((b.count / maxSpeedBucket) * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">
                    {b.count}
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-700">
                    {formatPercent(speed.closes > 0 ? b.count / speed.closes : 0)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-500">En la primera hora</p>
                <p className="mt-0.5 text-lg font-semibold tracking-tight text-emerald-700">
                  {formatPercent(speed.withinHourRate)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-500">En las primeras 24 h</p>
                <p className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">
                  {formatPercent(speed.withinDayRate)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-500">Recompras</p>
                <p className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">
                  {formatNumber(speed.repeatConversations)}
                </p>
                <p className="text-xs text-slate-500">
                  {speed.repeatConversations === 1 ? "cliente volvió" : "clientes volvieron"} a
                  comprar · {formatNumber(speed.repeatOrders)}{" "}
                  {speed.repeatOrders === 1 ? "orden extra" : "órdenes extra"}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Por estado */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-display text-[15px] font-semibold tracking-tight text-slate-900">Por estado</h2>
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
                    {formatMoney(r.byStatus[s].revenue, r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Por método */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-display text-[15px] font-semibold tracking-tight text-slate-900">Por método</h2>
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
                  <td className="py-2 text-slate-700">{methodLabel(m, methodLabels)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-900">
                    {formatNumber(r.byMethod[m].count)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-900">
                    {formatMoney(r.byMethod[m].revenue, r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Últimos 14 días */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-display text-[15px] font-semibold tracking-tight text-slate-900">
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
                {formatMoney(d.revenue, r.currency)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Mapa de calor día × hora: la lectura accionable de los horarios, así que
          va abierta; los cortes sueltos quedan abajo, en el desplegable. */}
      <SalesHeatmap report={r} />

      {/* Analítica de horarios: día de la semana + hora del día (hora Colombia) */}
      <Collapsible
        title="Horarios de venta · cortes sueltos"
        subtitle="Órdenes generadas por día de la semana y por hora (hora Colombia)."
      >
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-display text-[15px] font-semibold tracking-tight text-slate-900">Por día de la semana</h2>
          <p className="mb-3 text-xs text-slate-400">Órdenes generadas · hora Colombia.</p>
          <ul className="space-y-1.5">
            {WEEKDAYS.map(({ i, l }) => {
              const b = r.byWeekday[i];
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="w-10 shrink-0 text-xs text-slate-500">{l}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full rounded bg-teal-600/80"
                      style={{ width: `${Math.round((b.revenue / maxWeekdayRev) * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">
                    {b.count}
                  </span>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-700">
                    {formatMoney(b.revenue, r.currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-display text-[15px] font-semibold tracking-tight text-slate-900">Por hora del día</h2>
          <p className="mb-3 text-xs text-slate-400">Órdenes generadas · hora Colombia.</p>
          <ul className="space-y-1">
            {r.byHour.map((b, h) => (
              <li key={h} className="flex items-center gap-3">
                <span className="w-10 shrink-0 text-xs tabular-nums text-slate-500">
                  {String(h).padStart(2, "0")}h
                </span>
                <div className="h-3.5 flex-1 overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-full rounded bg-teal-600/80"
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
      </Collapsible>

      {/* Rendimiento por producto (conversaciones → órdenes → plata) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3">
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">Rendimiento por producto</h2>
          <p className="max-w-prose text-xs text-slate-400">
            Conversaciones agrupadas por su producto/fuente: cuántas terminaron en venta, cuántas
            órdenes y cuánta plata trajo cada una. <strong>Valor/chat</strong> = ventas ÷
            conversaciones: lo que vale un chat de ese producto. Se autocategoriza por palabra
            clave; también se ajusta a mano en cada conversación.
            {products.converted
              ? ` Montos homologados a ${products.currency} (${rateNote(products.currency)}).`
              : ""}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Producto</th>
                <th className="pb-2 text-right font-medium">Conversaciones</th>
                <th className="pb-2 text-right font-medium">Transacciones</th>
                <th className="pb-2 text-right font-medium">Órdenes</th>
                <th className="pb-2 text-right font-medium">Ventas</th>
                <th className="pb-2 text-right font-medium">Valor/chat</th>
                <th className="pb-2 text-right font-medium">Conversión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.rows.length === 0 ? (
                <tr>
                  <td className="py-3 text-slate-400" colSpan={7}>
                    Aún no hay conversaciones categorizadas.
                  </td>
                </tr>
              ) : (
                products.rows.map((p) => (
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
                    <td className="py-2 text-right tabular-nums text-slate-900">
                      {formatNumber(p.orders)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-900">
                      {formatMoney(p.revenue, products.currency)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-700">
                      {formatMoney(p.revenuePerConversation, products.currency)}
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

        {/* Atención vs. plata: % de chats vs. % de ventas de cada producto. Misma
            unidad (%), así que las dos barras SÍ son comparables: un producto con
            mucha barra gris y poca verde consume chats que no se vuelven plata. */}
        {prodShareRows.length > 1 ? (
          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" aria-hidden="true" />
                % de conversaciones
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />
                % de ventas
              </span>
              <span className="ml-auto">¿Qué producto se lleva los chats… y cuál la plata?</span>
            </div>
            <ul className="space-y-2">
              {prodShareRows.map((p) => {
                const convShare = p.conversations / totalProdConvs;
                const revShare = p.revenue / totalProdRevenue;
                return (
                  <li key={p.category} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-xs text-slate-500" title={p.category ?? undefined}>
                      {p.category}
                    </span>
                    <div className="flex-1 space-y-1">
                      <div className="h-2.5 overflow-hidden rounded bg-slate-100">
                        <div
                          className="h-full rounded bg-slate-300"
                          style={{ width: `${Math.round(convShare * 100)}%` }}
                        />
                      </div>
                      <div className="h-2.5 overflow-hidden rounded bg-slate-100">
                        <div
                          className="h-full rounded bg-emerald-500"
                          style={{ width: `${Math.round(revShare * 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500">
                      {formatPercent(convShare)}
                    </span>
                    <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums text-emerald-700">
                      {formatPercent(revShare)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>

      {/* Productos más vendidos: lo que salió en las órdenes (por SKU) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3">
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-slate-900">Productos más vendidos</h2>
          <p className="max-w-prose text-xs text-slate-400">
            Lo que de verdad salió en las órdenes (ítems por referencia), no lo que se preguntó.
            <strong> Cancelación</strong> = órdenes canceladas que incluían el producto.
            {topProducts.converted
              ? ` Montos homologados a ${topProducts.currency} (${rateNote(topProducts.currency)}).`
              : ""}
            {topProducts.unpriced > 0
              ? ` ${formatNumber(topProducts.unpriced)} ${topProducts.unpriced === 1 ? "ítem no tiene" : "ítems no tienen"} precio: cuentan unidades pero no suman ventas.`
              : ""}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Producto</th>
                <th className="pb-2 text-right font-medium">Unidades</th>
                <th className="pb-2 text-right font-medium">Órdenes</th>
                <th className="pb-2 text-right font-medium">Ventas</th>
                <th className="pb-2 text-right font-medium">Por orden</th>
                <th className="pb-2 text-right font-medium">Cancelación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {topRows.length === 0 ? (
                <tr>
                  <td className="py-3 text-slate-400" colSpan={6}>
                    Aún no hay ítems en las órdenes.
                  </td>
                </tr>
              ) : (
                topRows.map((p) => (
                  <tr key={p.sku}>
                    <td className="py-2 pr-4">
                      <p className="text-slate-700">
                        {p.name}
                        <span className="ml-1.5 text-xs text-slate-400">{p.sku}</span>
                      </p>
                      <div className="mt-1 h-1.5 max-w-[16rem] overflow-hidden rounded bg-slate-100">
                        <div
                          className="h-full rounded bg-emerald-500/80"
                          style={{ width: `${Math.round((p.revenue / maxTopRevenue) * 100)}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-900">
                      {formatNumber(p.units)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-900">
                      {formatNumber(p.orders)}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums text-slate-900">
                      {formatMoney(p.revenue, topProducts.currency)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-700">
                      {p.perOrder != null ? formatMoney(p.perOrder, topProducts.currency) : "—"}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        p.cancelRate >= 0.25 ? "font-medium text-rose-700" : "text-slate-500"
                      }`}
                    >
                      {formatPercent(p.cancelRate)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {topProducts.rows.length > topRows.length ? (
          <p className="mt-2 text-xs text-slate-400">
            Mostrando los {topRows.length} con más ventas de {formatNumber(topProducts.rows.length)}{" "}
            referencias.
          </p>
        ) : null}
      </section>
    </div>
  );
}
