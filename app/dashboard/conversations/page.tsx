import Link from "next/link";
import { getRecentConversations } from "@/lib/dashboard/queries";
import { ConversationList } from "../ui";
import type { ConversationStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type SearchParams = { range?: string; order?: string; status?: string };

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

  const convos = await getRecentConversations({
    limit: 100,
    sinceDays: rangeKey ? RANGE_DAYS[rangeKey] : undefined,
    hasOrder: orderKey === "with" ? true : orderKey === "without" ? false : undefined,
    status: statusKey,
  });

  // Construye un href preservando los demás filtros; "all" limpia esa dimensión.
  const current = { range: rangeKey, order: orderKey, status: statusKey };
  function hrefWith(key: keyof typeof current, value: string): string {
    const next = { ...current, [key]: value === "all" ? undefined : value };
    const qs = new URLSearchParams();
    if (next.range) qs.set("range", next.range);
    if (next.order) qs.set("order", next.order);
    if (next.status) qs.set("status", next.status);
    const s = qs.toString();
    return s ? `/dashboard/conversations?${s}` : "/dashboard/conversations";
  }

  const anyFilter = Boolean(rangeKey || orderKey || statusKey);

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

      <ConversationList rows={convos} filtered={anyFilter} />
    </div>
  );
}
