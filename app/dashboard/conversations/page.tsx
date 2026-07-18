import Link from "next/link";
import {
  getAgents,
  getConversationFilterOptions,
  getRecentConversations,
  type ConversationOrderBy,
} from "@/lib/dashboard/queries";
import { ConversationList } from "../ui";
import type { ConversationStatus } from "@/lib/supabase/types";
import { AgentFilter } from "./AgentFilter";
import { SelectFilter } from "./SelectFilter";

export const dynamic = "force-dynamic";

type SearchParams = {
  range?: string;
  order?: string;
  status?: string;
  sort?: string;
  agent?: string;
  tag?: string;
  product?: string;
  page?: string;
};

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

  // Agentes para el selector + validación del `?agent=` (ignora ids inexistentes).
  const agents = await getAgents();
  const agentKey =
    searchParams.agent && agents.some((a) => a.id === searchParams.agent)
      ? searchParams.agent
      : undefined;

  // Opciones de filtro (etiquetas en uso + productos) del ALCANCE actual (el agente
  // seleccionado, si hay). Sirven para pintar los selectores y para validar los
  // parámetros: un `?tag=`/`?product=` que no exista en el alcance se ignora (igual
  // que `?agent=`), así una URL vieja o de otro agente no rompe la lista.
  const filterOptions = await getConversationFilterOptions(agentKey);
  const tagKey =
    searchParams.tag && filterOptions.labels.some((l) => l.id === searchParams.tag)
      ? searchParams.tag
      : undefined;
  const productKey =
    searchParams.product && filterOptions.products.includes(searchParams.product)
      ? searchParams.product
      : undefined;

  // Pedimos UNA de más (PAGE_SIZE + 1) para saber si hay página siguiente sin un
  // count aparte: si vuelven más de PAGE_SIZE, hay "más antiguas".
  const fetched = await getRecentConversations({
    limit: PAGE_SIZE + 1,
    offset: (pageNum - 1) * PAGE_SIZE,
    sinceDays: rangeKey ? RANGE_DAYS[rangeKey] : undefined,
    hasOrder: orderKey === "with" ? true : orderKey === "without" ? false : undefined,
    status: statusKey,
    orderBy: sortKey,
    agentId: agentKey,
    labelId: tagKey,
    productCategory: productKey,
  });
  const hasNext = fetched.length > PAGE_SIZE;
  const convos = fetched.slice(0, PAGE_SIZE);
  const hasPrev = pageNum > 1;

  // Solo el orden NO-default ("outbound") se guarda en la URL (inbound = limpio).
  const sortParam = sortKey === "outbound" ? "outbound" : undefined;

  // Construye un href preservando los demás filtros; "all" (o "inbound" en sort)
  // limpia esa dimensión. Cambiar cualquier filtro/orden vuelve a la página 1.
  const current = {
    range: rangeKey,
    order: orderKey,
    status: statusKey,
    sort: sortParam,
    agent: agentKey,
    tag: tagKey,
    product: productKey,
  };
  function hrefWith(key: keyof typeof current, value: string): string {
    const clears = value === "all" || (key === "sort" && value === "inbound");
    const next = { ...current, [key]: clears ? undefined : value };
    const qs = new URLSearchParams();
    if (next.range) qs.set("range", next.range);
    if (next.order) qs.set("order", next.order);
    if (next.status) qs.set("status", next.status);
    if (next.sort) qs.set("sort", next.sort);
    if (next.agent) qs.set("agent", next.agent);
    if (next.tag) qs.set("tag", next.tag);
    if (next.product) qs.set("product", next.product);
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
    if (agentKey) qs.set("agent", agentKey);
    if (tagKey) qs.set("tag", tagKey);
    if (productKey) qs.set("product", productKey);
    if (target > 1) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `/dashboard/conversations?${s}` : "/dashboard/conversations";
  }

  // Filtros activos a conservar al cambiar UN selector, EXCLUYENDO su propia clave
  // (y `page`, para volver a la página 1). Lo usan los `<select>` de agente/etiqueta/
  // producto: cada uno preserva a los demás.
  function preservedExcept(omit: keyof typeof current): Record<string, string> {
    const p: Record<string, string> = {};
    if (rangeKey && omit !== "range") p.range = rangeKey;
    if (orderKey && omit !== "order") p.order = orderKey;
    if (statusKey && omit !== "status") p.status = statusKey;
    if (sortParam && omit !== "sort") p.sort = sortParam;
    if (agentKey && omit !== "agent") p.agent = agentKey;
    if (tagKey && omit !== "tag") p.tag = tagKey;
    if (productKey && omit !== "product") p.product = productKey;
    return p;
  }

  const anyFilter = Boolean(
    rangeKey || orderKey || statusKey || sortParam || agentKey || tagKey || productKey,
  );

  // Agente seleccionado (para el subtítulo). undefined = todos.
  const selectedAgent = agentKey ? agents.find((a) => a.id === agentKey) : undefined;
  const agentScope = selectedAgent
    ? `${selectedAgent.name}${selectedAgent.brand ? ` · ${selectedAgent.brand}` : ""}`
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Conversaciones</h1>
          <p className="text-sm text-slate-500">
            {agentScope ? (
              <>
                Conversaciones de <span className="font-medium text-slate-700">{agentScope}</span>.
              </>
            ) : (
              <>Todas las conversaciones del agente.</>
            )}
          </p>
        </div>
        <span className="text-sm text-slate-400">{convos.length}</span>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        {agents.length > 1 && (
          <AgentFilter
            agents={agents.map((a) => ({ id: a.id, name: a.name, brand: a.brand }))}
            current={agentKey ?? ""}
            preserved={preservedExcept("agent")}
          />
        )}
        {filterOptions.labels.length > 0 && (
          <SelectFilter
            label="Etiqueta"
            ariaLabel="Filtrar por etiqueta"
            paramName="tag"
            current={tagKey ?? ""}
            allLabel="Todas las etiquetas"
            options={filterOptions.labels.map((l) => ({ value: l.id, label: l.name }))}
            preserved={preservedExcept("tag")}
          />
        )}
        {filterOptions.products.length > 0 && (
          <SelectFilter
            label="Producto"
            ariaLabel="Filtrar por producto"
            paramName="product"
            current={productKey ?? ""}
            allLabel="Todos los productos"
            options={filterOptions.products.map((p) => ({ value: p, label: p }))}
            preserved={preservedExcept("product")}
          />
        )}
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
