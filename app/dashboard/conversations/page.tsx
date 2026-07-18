import Link from "next/link";
import {
  getAgents,
  getConversationFilterOptions,
  getRecentConversations,
  type ConversationOrderBy,
} from "@/lib/dashboard/queries";
import { isDayKey } from "@/lib/dashboard/report";
import { ConversationList } from "../ui";
import { Collapsible } from "../Collapsible";
import { PageHeader } from "../ui-kit";
import type { ConversationStatus } from "@/lib/supabase/types";
import { AgentFilter } from "./AgentFilter";
import { DateRangeFilter } from "./DateRangeFilter";
import { SelectFilter } from "./SelectFilter";
import { TextFilter } from "./TextFilter";

export const dynamic = "force-dynamic";

type SearchParams = {
  range?: string;
  from?: string;
  to?: string;
  order?: string;
  status?: string;
  sort?: string;
  agent?: string;
  tag?: string;
  product?: string;
  call?: string;
  q?: string;
  kw?: string;
  page?: string;
};

/** Valor del filtro de etiqueta que significa "sin ninguna etiqueta". */
const TAG_NONE = "__none__";

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
  "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
const idleCls =
  "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";

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
  // Rango exacto (desde/hasta) y atajo de días son EXCLUYENTES: los dos acotan la
  // misma clave de orden, así que mezclarlos daría una ventana ambigua. Gana el
  // rango explícito; si viene invertido (desde > hasta) se ignora en vez de
  // devolver una lista vacía sin explicación.
  let fromKey = isDayKey(searchParams.from) ? searchParams.from : undefined;
  let toKey = isDayKey(searchParams.to) ? searchParams.to : undefined;
  if (fromKey && toKey && fromKey > toKey) {
    fromKey = undefined;
    toKey = undefined;
  }
  const hasDateRange = Boolean(fromKey || toKey);

  const rangeKey =
    !hasDateRange && searchParams.range && RANGE_DAYS[searchParams.range]
      ? searchParams.range
      : undefined;
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
  // `__none__` (sin etiqueta) es un valor sintético: no es un id de `labels`, así
  // que se valida aparte de los ids reales.
  const tagKey =
    searchParams.tag === TAG_NONE
      ? TAG_NONE
      : searchParams.tag && filterOptions.labels.some((l) => l.id === searchParams.tag)
        ? searchParams.tag
        : undefined;
  const productKey =
    searchParams.product && filterOptions.products.includes(searchParams.product)
      ? searchParams.product
      : undefined;

  // "Tuvo llamada con IA": el único valor válido es `with` (el resto se ignora,
  // igual que los demás filtros). Ver docs/25.
  const callKey = searchParams.call === "with" ? "with" : undefined;

  // Búsquedas de texto libre: cliente (nombre o teléfono) y palabra clave en los
  // mensajes. Se recortan a 60 caracteres (mismo tope que el input) para que una
  // URL manipulada no mande un término kilométrico a la consulta. Ver ADR-0071.
  const searchKey = searchParams.q?.trim().slice(0, 60) || undefined;
  const keywordKey = searchParams.kw?.trim().slice(0, 60) || undefined;

  // Pedimos UNA de más (PAGE_SIZE + 1) para saber si hay página siguiente sin un
  // count aparte: si vuelven más de PAGE_SIZE, hay "más antiguas".
  const fetched = await getRecentConversations({
    limit: PAGE_SIZE + 1,
    offset: (pageNum - 1) * PAGE_SIZE,
    sinceDays: rangeKey ? RANGE_DAYS[rangeKey] : undefined,
    fromDate: fromKey,
    toDate: toKey,
    hasOrder: orderKey === "with" ? true : orderKey === "without" ? false : undefined,
    status: statusKey,
    orderBy: sortKey,
    agentId: agentKey,
    labelId: tagKey === TAG_NONE ? undefined : tagKey,
    withoutLabel: tagKey === TAG_NONE,
    productCategory: productKey,
    hasVoiceCall: callKey === "with" ? true : undefined,
    contactSearch: searchKey,
    keyword: keywordKey,
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
    from: fromKey,
    to: toKey,
    order: orderKey,
    status: statusKey,
    sort: sortParam,
    agent: agentKey,
    tag: tagKey,
    product: productKey,
    call: callKey,
    q: searchKey,
    kw: keywordKey,
  };

  /** Serializa un juego de filtros a la URL de la lista (omite los vacíos). */
  function hrefFor(next: Partial<typeof current> & { page?: number }): string {
    const qs = new URLSearchParams();
    if (next.range) qs.set("range", next.range);
    if (next.from) qs.set("from", next.from);
    if (next.to) qs.set("to", next.to);
    if (next.order) qs.set("order", next.order);
    if (next.status) qs.set("status", next.status);
    if (next.sort) qs.set("sort", next.sort);
    if (next.agent) qs.set("agent", next.agent);
    if (next.tag) qs.set("tag", next.tag);
    if (next.product) qs.set("product", next.product);
    if (next.call) qs.set("call", next.call);
    if (next.q) qs.set("q", next.q);
    if (next.kw) qs.set("kw", next.kw);
    if (next.page && next.page > 1) qs.set("page", String(next.page));
    const s = qs.toString();
    return s ? `/dashboard/conversations?${s}` : "/dashboard/conversations";
  }

  function hrefWith(key: keyof typeof current, value: string): string {
    const clears = value === "all" || (key === "sort" && value === "inbound");
    const next = { ...current, [key]: clears ? undefined : value };
    // El atajo de días y el rango exacto son excluyentes: elegir uno limpia el otro.
    if (key === "range") {
      next.from = undefined;
      next.to = undefined;
    }
    return hrefFor(next);
  }

  // Href de paginación: preserva los filtros actuales y fija la página (1 = sin ?page).
  function hrefWithPage(target: number): string {
    return hrefFor({ ...current, page: target });
  }

  // Filtros activos a conservar al cambiar UN selector, EXCLUYENDO su propia clave
  // (y `page`, para volver a la página 1). Lo usan los `<select>` de agente/etiqueta/
  // producto: cada uno preserva a los demás.
  function preservedExcept(omit: keyof typeof current): Record<string, string> {
    const p: Record<string, string> = {};
    if (rangeKey && omit !== "range") p.range = rangeKey;
    // El rango exacto viaja junto (from+to) y compite con `range`: el filtro de
    // fechas los omite los tres para poder reemplazar la ventana entera.
    if (fromKey && omit !== "from") p.from = fromKey;
    if (toKey && omit !== "to") p.to = toKey;
    if (orderKey && omit !== "order") p.order = orderKey;
    if (statusKey && omit !== "status") p.status = statusKey;
    if (sortParam && omit !== "sort") p.sort = sortParam;
    if (agentKey && omit !== "agent") p.agent = agentKey;
    if (tagKey && omit !== "tag") p.tag = tagKey;
    if (productKey && omit !== "product") p.product = productKey;
    if (callKey && omit !== "call") p.call = callKey;
    if (searchKey && omit !== "q") p.q = searchKey;
    if (keywordKey && omit !== "kw") p.kw = keywordKey;
    return p;
  }

  const anyFilter = Boolean(
    rangeKey ||
      hasDateRange ||
      orderKey ||
      statusKey ||
      sortParam ||
      agentKey ||
      tagKey ||
      productKey ||
      callKey ||
      searchKey ||
      keywordKey,
  );

  // El filtro de fechas reemplaza la VENTANA entera, así que preserva todo lo
  // demás menos las tres claves que la definen (`range`, `from`, `to`).
  const preservedForDates = (() => {
    const p = preservedExcept("from");
    delete p.to;
    delete p.range;
    return p;
  })();

  // Agente seleccionado (para el subtítulo y el resumen). undefined = todos.
  const selectedAgent = agentKey ? agents.find((a) => a.id === agentKey) : undefined;
  const agentScope = selectedAgent
    ? `${selectedAgent.name}${selectedAgent.brand ? ` · ${selectedAgent.brand}` : ""}`
    : null;

  // Resumen de lo que está filtrando, para leerlo con el bloque plegado.
  const activeSummary: string[] = [];
  if (agentScope) activeSummary.push(agentScope);
  if (searchKey) activeSummary.push(`Cliente: “${searchKey}”`);
  if (keywordKey) activeSummary.push(`Texto: “${keywordKey}”`);
  if (hasDateRange) {
    activeSummary.push(
      fromKey && toKey ? `${fromKey} → ${toKey}` : fromKey ? `desde ${fromKey}` : `hasta ${toKey}`,
    );
  } else if (rangeKey) {
    activeSummary.push(RANGE_FILTERS.find((f) => f.value === rangeKey)!.label);
  }
  if (tagKey) {
    activeSummary.push(
      tagKey === TAG_NONE
        ? "Sin etiqueta"
        : (filterOptions.labels.find((l) => l.id === tagKey)?.name ?? "Etiqueta"),
    );
  }
  if (productKey) activeSummary.push(productKey);
  if (statusKey) activeSummary.push(STATUS_FILTERS.find((f) => f.value === statusKey)!.label);
  if (orderKey) activeSummary.push(ORDER_FILTERS.find((f) => f.value === orderKey)!.label);
  if (callKey) activeSummary.push("Con llamada");
  if (sortParam) activeSummary.push("Última respuesta");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Conversaciones"
        description={
          agentScope ? (
            <>
              Conversaciones de <span className="font-medium text-slate-700">{agentScope}</span>.
            </>
          ) : (
            <>Todas las conversaciones del agente.</>
          )
        }
        actions={<span className="text-sm tabular-nums text-slate-400">{convos.length}</span>}
      />

      <Collapsible
        title="Filtros"
        subtitle={
          activeSummary.length > 0
            ? activeSummary.join(" · ")
            : "Cliente, palabras clave, agente, fechas, etiqueta, producto, estado y orden."
        }
        badge={activeSummary.length > 0 ? `${activeSummary.length} activo(s)` : undefined}
      >
        <div className="space-y-3">
          {agents.length > 1 && (
            <AgentFilter
              agents={agents.map((a) => ({ id: a.id, name: a.name, brand: a.brand }))}
              current={agentKey ?? ""}
              preserved={preservedExcept("agent")}
            />
          )}
          <TextFilter
            label="Cliente"
            ariaLabel="Buscar por nombre o teléfono"
            paramName="q"
            placeholder="Nombre o teléfono…"
            current={searchKey ?? ""}
            preserved={preservedExcept("q")}
          />
          <TextFilter
            label="Palabras"
            ariaLabel="Buscar por palabras clave en los mensajes"
            paramName="kw"
            placeholder="Palabra clave en los mensajes…"
            current={keywordKey ?? ""}
            preserved={preservedExcept("kw")}
          />
          <SelectFilter
            label="Etiqueta"
            ariaLabel="Filtrar por etiqueta"
            paramName="tag"
            current={tagKey ?? ""}
            allLabel="Todas las etiquetas"
            options={[
              // "Sin etiqueta" primero: es la cola por clasificar, no una etiqueta más.
              { value: TAG_NONE, label: "Sin etiqueta" },
              ...filterOptions.labels.map((l) => ({ value: l.id, label: l.name })),
            ]}
            preserved={preservedExcept("tag")}
          />
          <SelectFilter
            label="Llamada IA"
            ariaLabel="Filtrar por llamada con IA"
            paramName="call"
            current={callKey ?? ""}
            allLabel="Todas"
            options={[{ value: "with", label: "Con llamada" }]}
            preserved={preservedExcept("call")}
          />
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
            active={hasDateRange ? "" : (rangeKey ?? "all")}
            makeHref={(v) => hrefWith("range", v)}
          />
          <DateRangeFilter
            from={fromKey ?? ""}
            to={toKey ?? ""}
            preserved={preservedForDates}
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
                className="text-sm text-slate-500 underline-offset-2 transition-colors hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                Limpiar filtros
              </Link>
            </div>
          ) : null}
        </div>
      </Collapsible>

      {convos.length === 0 && hasPrev ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">No hay más conversaciones en esta página.</p>
          <Link
            href={hrefWithPage(pageNum - 1)}
            className="mt-2 inline-block text-sm text-slate-600 underline-offset-2 transition-colors hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
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
