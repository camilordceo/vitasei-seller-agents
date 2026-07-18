import Link from "next/link";
import { getOrdersPage } from "@/lib/dashboard/queries";
import { formatMoney, formatNumber } from "@/lib/dashboard/format";
import { OrderList } from "../ui";
import { Kpi, PageHeader } from "../ui-kit";
import { NewOrderButton } from "./NewOrderButton";
import { OrderSearch } from "./OrderSearch";
import type { OrderStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/** Órdenes por página. */
const PAGE_SIZE = 50;

const FILTERS: Array<{ value: OrderStatus | "all"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "pending_handoff", label: "Pendientes" },
  { value: "handed_off", label: "Con logística" },
  { value: "confirmed", label: "Confirmadas" },
  { value: "cancelled", label: "Canceladas" },
];

const VALID = new Set<string>([
  "pending_handoff",
  "handed_off",
  "confirmed",
  "cancelled",
]);

const activeCls =
  "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
const idleCls =
  "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "teal" | "navy" | "neutral" | "emerald";
}) {
  return <Kpi label={label} value={value} sub={sub} tone={tone ?? "navy"} />;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string; sku?: string; page?: string };
}) {
  const raw = searchParams.status;
  const status = raw && VALID.has(raw) ? (raw as OrderStatus) : undefined;
  const q = (searchParams.q ?? "").slice(0, 100);
  const pageNum = Math.max(1, Math.floor(Number(searchParams.page)) || 1);

  const sku = (searchParams.sku ?? "").slice(0, 100);

  const { rows, summary, hasNext, products } = await getOrdersPage({
    status,
    q: q || undefined,
    sku: sku || undefined,
    page: pageNum,
    pageSize: PAGE_SIZE,
  });
  // El selector solo puede mostrar un SKU que exista en el catálogo de órdenes; si
  // llega uno viejo por URL el filtro sigue aplicando (y da 0), pero el `<select>`
  // no puede pintar una opción que no tiene.
  const skuForSelect = products.some((p) => p.sku === sku) ? sku : "";
  const hasPrev = pageNum > 1;
  const anyFilter = Boolean(status || q || sku);

  function hrefFor(next: {
    status?: OrderStatus;
    q?: string;
    sku?: string;
    page?: number;
  }): string {
    const qs = new URLSearchParams();
    if (next.status) qs.set("status", next.status);
    if (next.q) qs.set("q", next.q);
    if (next.sku) qs.set("sku", next.sku);
    if (next.page && next.page > 1) qs.set("page", String(next.page));
    const s = qs.toString();
    return s ? `/dashboard/orders?${s}` : "/dashboard/orders";
  }

  // Filtros a conservar cuando cambia la búsqueda/producto (sin `page`: vuelve a 1).
  const preserved: Record<string, string> = {};
  if (status) preserved.status = status;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Órdenes"
        description="Transacciones creadas por el agente. Ábrelas para ver o corregir los datos, o crea una orden manual."
        actions={<span className="text-sm tabular-nums text-slate-400">{formatNumber(summary.count)}</span>}
      />

      {/* Resumen del FILTRO completo (no solo de la página que se ve). */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Órdenes"
          value={formatNumber(summary.count)}
          sub={anyFilter ? "con este filtro" : "en total"}
          tone="navy"
        />
        <SummaryCard
          label="En ventas"
          value={formatMoney(summary.revenue, summary.currency)}
          sub={summary.currency ? "sin canceladas" : "sin canceladas · varias monedas"}
          tone="teal"
        />
        <SummaryCard
          label="Confirmadas"
          value={formatMoney(summary.confirmedRevenue, summary.currency)}
          sub="cobradas / entregadas"
          tone="emerald"
        />
        <SummaryCard
          label="Ticket promedio"
          value={formatMoney(summary.avgTicket, summary.currency)}
          sub="por orden con monto"
          tone="neutral"
        />
      </section>

      <NewOrderButton />

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
        <OrderSearch q={q} sku={skuForSelect} products={products} preserved={preserved} />

        <nav className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[11px] bg-slate-100 p-1">
          {FILTERS.map((f) => {
            const active = (f.value === "all" && !status) || f.value === status;
            const href = hrefFor({
              status: f.value === "all" ? undefined : (f.value as OrderStatus),
              q,
              sku,
            });
            return (
              <Link
                key={f.value}
                href={href}
                className={
                  active
                    ? "rounded-lg bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                    : "rounded-lg px-3.5 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                }
              >
                {f.label}
              </Link>
            );
          })}
        </nav>

        {anyFilter ? (
          <Link
            href="/dashboard/orders"
            className="inline-block text-sm text-slate-500 underline-offset-2 transition-colors hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Limpiar filtros
          </Link>
        ) : null}
      </div>

      {rows.length === 0 && hasPrev ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">No hay más órdenes en esta página.</p>
          <Link
            href={hrefFor({ status, q, sku, page: pageNum - 1 })}
            className="mt-2 inline-block text-sm text-slate-600 underline-offset-2 transition-colors hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            ‹ Volver a la página anterior
          </Link>
        </div>
      ) : (
        <OrderList rows={rows} />
      )}

      {hasPrev || hasNext ? (
        <nav className="flex items-center justify-between gap-2" aria-label="Paginación de órdenes">
          {hasPrev ? (
            <Link href={hrefFor({ status, q, sku, page: pageNum - 1 })} className={idleCls}>
              ‹ Más recientes
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <span className="text-xs font-medium text-slate-400">Página {pageNum}</span>
          {hasNext ? (
            <Link href={hrefFor({ status, q, sku, page: pageNum + 1 })} className={idleCls}>
              Más antiguas ›
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      ) : null}
    </div>
  );
}
