import Link from "next/link";
import { getRecentConversations, type ConversationOrderBy } from "@/lib/dashboard/queries";
import { ConversationList } from "../ui";
import type { ConversationStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type SearchParams = { range?: string; order?: string; status?: string; sort?: string; page?: string };

/** Conversaciones por página (para el "siguiente" / "más antiguas"). */
const PAGE_SIZE = 50;

/** Ventanas de fecha (por actividad reciente, `updated_at`). */
const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

const RANGE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Todo" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
];

const ORDER_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "with", label: "Con pedido" },
  { value: "without", label: "Sin pedido" },
];

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "active", label: "Activas" },
  { value: "handed_off", label: "Con logística" },
  { value: "closed", label: "Cerradas" },
];

// Orden por actividad: por el último mensaje del cliente o por la última respuesta.
const SORT_FILTERS: Array<{ value: string; label: string }> = [
  { value: "inbound", label: "Último del cliente" },
  { value: "outbound", label: "Última respuesta" },
];

const VALID_STATUS = new Set<string>(["active", "handed_off", "closed"]);

const activeCls =
  "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";
const idleCls =
  "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";

function FilterRow({
  label,
  filters,
  active,
  makeHref,
}: {
  label: string;
  filters: Array<{ value: string; label: string }>;
  active: string;
  makeHref: (value: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      {filters.map((f) => (
        <Link
          key={f.value}
          href={makeHref(f.value)}
          className={f.value === active ? activeCls : idleCls}
        >
          {f.label}
        </Link>
      ))}
    </div>
  );
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const rangeKey =
    searchParams.range && RANGE_DAYS[searchParams.range] ? searchParams.range : undefined;
  const orderKey =
    searchParams.order === "with" || searchParams.order === "without"
      ? searchParams.order
      : undefined;
  const statusKey =
    searchParams.status && VALID_STATUS.has(searchParams.status)
      ? (searchParams.status as ConversationStatus)
      : undefined;
  // Default "inbound" (último del cliente). Solo "outbound" cambia la clave.
  const sortKey: ConversationOrderBy =
    searchParams.sort === "outbound" ? "outbound" : "inbound";

  const pageNum = Math.max(1, Math.floor(Number(searchParams.page)) || 1);

  // Pedimos UNA de más (PAGE_SIZE + 1) para saber si hay página siguiente sin un
  // count aparte: si vuelven más de PAGE_SIZE, hay "más antiguas".
  const fetched = await getRecentConversations({
    limit: PAGE_SIZE + 1,
    offset: (pageNum - 1) * PAGE_SIZE,
    sinceDays: rangeKey ? RANGE_DAYS[rangeKey] : undefined,
    hasOrder: orderKey === "with" ? true : orderKey === "without" ? false : undefined,
    status: statusKey,
    orderBy: sortKey,
  });
  const hasNext = fetched.length > PAGE_SIZE;
  const convos = fetched.slice(0, PAGE_SIZE);
  const hasPrev = pageNum > 1;

  // Solo el orden NO-default ("outbound") se guarda en la URL (inbound = limpio).
  const sortParam = sortKey === "outbound" ? "outbound" : undefined;

  // Construye un href preservando los demás filtros; "all" (o "inbound" en sort)
  // limpia esa dimensión. Cambiar cualquier filtro/orden vuelve a la página 1.
  const current = { range: rangeKey, order: orderKey, status: statusKey, sort: sortParam };
  function hrefWith(key: keyof typeof current, value: string): string {
    const clears = value === "all" || (key === "sort" && value === "inbound");
    const next = { ...current, [key]: clears ? undefined : value };
    const qs = new URLSearchParams();
    if (next.range) qs.set("range", next.range);
    if (next.order) qs.set("order", next.order);
    if (next.status) qs.set("status", next.status);
    if (next.sort) qs.set("sort", next.sort);
    const s = qs.toString();
    return s ? `/dashboard/conversations?${s}` : "/dashboard/conversations";
  }

  // Href de paginación: preserva los filtros actuales y fija la página (1 = sin ?page).
  function hrefWithPage(target: number): string {
    const qs = new URLSearchParams();
    if (rangeKey) qs.set("range", rangeKey);
    if (orderKey) qs.set("order", orderKey);
    if (statusKey) qs.set("status", statusKey);
    if (sortParam) qs.set("sort", sortParam);
    if (target > 1) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `/dashboard/conversations?${s}` : "/dashboard/conversations";
  }

  const anyFilter = Boolean(rangeKey || orderKey || statusKey || sortParam);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Conversaciones</h1>
          <p className="text-sm text-slate-500">Todas las conversaciones del agente.</p>
        </div>
        <span className="text-sm text-slate-400">{convos.length}</span>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        <FilterRow
          label="Fecha"
          filters={RANGE_FILTERS}
          active={rangeKey ?? "all"}
          makeHref={(v) => hrefWith("range", v)}
        />
        <FilterRow
          label="Pedido"
          filters={ORDER_FILTERS}
          active={orderKey ?? "all"}
          makeHref={(v) => hrefWith("order", v)}
        />
        <FilterRow
          label="Estado"
          filters={STATUS_FILTERS}
          active={statusKey ?? "all"}
          makeHref={(v) => hrefWith("status", v)}
        />
        <FilterRow
          label="Orden"
          filters={SORT_FILTERS}
          active={sortKey}
          makeHref={(v) => hrefWith("sort", v)}
        />
        {anyFilter ? (
          <div className="pt-1">
            <Link
              href="/dashboard/conversations"
              className="text-sm text-slate-500 underline-offset-2 transition-colors hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              Limpiar filtros
            </Link>
          </div>
        ) : null}
      </div>

      {convos.length === 0 && hasPrev ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">No hay más conversaciones en esta página.</p>
          <Link
            href={hrefWithPage(pageNum - 1)}
            className="mt-2 inline-block text-sm text-slate-600 underline-offset-2 transition-colors hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            ‹ Volver a la página anterior
          </Link>
        </div>
      ) : (
        <ConversationList rows={convos} filtered={anyFilter} />
      )}

      {hasPrev || hasNext ? (
        <nav
          className="flex items-center justify-between gap-2"
          aria-label="Paginación de conversaciones"
        >
          {hasPrev ? (
            <Link href={hrefWithPage(pageNum - 1)} className={idleCls}>
              ‹ Más recientes
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <span className="text-xs font-medium text-slate-400">Página {pageNum}</span>
          {hasNext ? (
            <Link href={hrefWithPage(pageNum + 1)} className={idleCls}>
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
