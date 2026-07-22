import Link from "next/link";
import type { ReactNode } from "react";
import type {
  CallRequestRow,
  ConversationRow,
  OrderRow,
  ReactivationRow,
  ReactivationStats,
  RetargetRow,
  RetargetStats,
} from "@/lib/dashboard/queries";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatUsd,
  relativeTime,
} from "@/lib/dashboard/format";
import { setCallRequestStatus, setConversationManual } from "./actions";
import { InitialsAvatar, Kpi, type KpiTone } from "./ui-kit";
import { methodLabel } from "@/lib/dashboard/methodLabels";
import type {
  CallRequestStatus,
  ConversationStatus,
  FulfillmentMethod,
  OrderStatus,
  RetargetStatus,
} from "@/lib/supabase/types";

/** Píldoras de estado y método, y tarjeta KPI. Presentacional puro. */

const STATUS: Record<ConversationStatus, { label: string; cls: string }> = {
  active: { label: "Activa", cls: "bg-emerald-50 text-emerald-700" },
  handed_off: { label: "Con logística", cls: "bg-amber-50 text-amber-700" },
  closed: { label: "Cerrada", cls: "bg-slate-100 text-slate-600" },
};

export function StatusPill({ status }: { status: ConversationStatus }) {
  const s = STATUS[status] ?? STATUS.closed;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/**
 * Píldora de método de pago. Las etiquetas las define cada agente (ADR-0055), así
 * que se reciben por prop; sin mapa se cae a las claves históricas o al nombre
 * derivado de la clave. Ver ADR-0080.
 */
export function MethodPill({
  method,
  labels,
}: {
  method: FulfillmentMethod;
  labels?: Record<string, string>;
}) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
      {methodLabel(method, labels)}
    </span>
  );
}

/**
 * Píldora de producto/fuente: de qué pauta o palabra clave llegó el cliente
 * (`conversations.product_category`). Es la conexión entre la orden y la campaña
 * que la trajo — lo que permite ver qué pauta rinde. Ver ADR-0076.
 */
export function SourcePill({ source }: { source: string }) {
  return (
    <span
      className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800"
      title={`Producto / fuente de la conversación: ${source}`}
    >
      <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 12h4l3 8 4-16 3 8h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="truncate">{source}</span>
    </span>
  );
}

/** Píldora "Manual": la IA está pausada y un humano atiende la conversación. */
export function ManualPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-semibold text-purple-700">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M8 6v12M16 6v12" strokeLinecap="round" />
      </svg>
      Manual
    </span>
  );
}

/**
 * Botón para pasar la conversación a manual (IA en silencio) o reactivarla.
 * Usa la Server Action `setConversationManual` vía `<form action>` (funciona sin
 * JS; revalida las rutas del dashboard al terminar).
 */
export function ManualToggle({
  conversationId,
  paused,
}: {
  conversationId: string;
  paused: boolean;
}) {
  const action = setConversationManual.bind(null, conversationId, !paused);
  return (
    <form action={action}>
      <button
        type="submit"
        className={
          paused
            ? "inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            : "inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        }
      >
        {paused ? (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M8 5v14l11-7-11-7Z" strokeLinejoin="round" />
            </svg>
            Reactivar IA
          </>
        ) : (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M8 6v12M16 6v12" strokeLinecap="round" />
            </svg>
            Pasar a manual
          </>
        )}
      </button>
    </form>
  );
}

const ORDER_STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  pending_handoff: {
    label: "Pendiente de handoff",
    cls: "bg-amber-50 text-amber-700",
  },
  handed_off: { label: "Con logística", cls: "bg-indigo-50 text-indigo-700" },
  confirmed: { label: "Confirmada", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelada", cls: "bg-rose-50 text-rose-700" },
};

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS[status]?.label ?? status;
}

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/**
 * Badge compacto "Pedido" para la lista de conversaciones: indica que la
 * conversación tiene una orden. Se atenúa (gris) si el pedido está cancelado.
 */
export function OrderBadge({ status }: { status: OrderStatus }) {
  const cancelled = status === "cancelled";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        cancelled
          ? "bg-slate-100 text-slate-500"
          : "bg-indigo-50 text-indigo-700"
      }`}
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 7h12l-1 13H7L6 7Z" strokeLinejoin="round" />
        <path d="M9 7a3 3 0 0 1 6 0" strokeLinecap="round" />
      </svg>
      {cancelled ? "Pedido cancelado" : "Pedido"}
    </span>
  );
}

/** Lista de órdenes (sección Órdenes). Enlaza al detalle editable. */
export function OrderList({
  rows,
  methodLabels,
}: {
  rows: OrderRow[];
  /** `method → etiqueta` según los agentes (ADR-0055). */
  methodLabels?: Record<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">No hay órdenes con este filtro.</p>
        <p className="mt-1 text-xs text-slate-400">
          El agente crea una orden cuando el cliente cierra la compra en WhatsApp.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {rows.map((o) => (
        <li key={o.id}>
          <Link
            href={`/dashboard/orders/${o.id}`}
            className="flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
          >
            <InitialsAvatar name={o.contactName || o.phone} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {o.contactName || o.phone || "Sin contacto"}
                </span>
                <OrderStatusPill status={o.status} />
                <MethodPill method={o.method} labels={methodLabels} />
                {/* De qué pauta/producto llegó el cliente: es lo que dice QUÉ campaña
                    está vendiendo, no solo qué se pidió. Ver ADR-0076. */}
                {o.productCategory ? <SourcePill source={o.productCategory} /> : null}
              </div>
              {/* Qué se pidió, sin abrir la orden. Con varios productos se nombra el
                  primero y se cuenta el resto: la fila no puede crecer sin control. */}
              {o.productNames.length > 0 ? (
                <p className="mt-0.5 truncate text-sm font-medium text-slate-700">
                  {o.productNames[0]}
                  {o.productNames.length > 1 ? ` +${o.productNames.length - 1} más` : ""}
                </p>
              ) : null}
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {o.itemsCount} {o.itemsCount === 1 ? "ítem" : "ítems"}
                {o.shippingCity ? ` · ${o.shippingCity}` : ""} · {formatDate(o.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {/* El monto va en la moneda de lectura; si es una conversión, debajo
                  queda el importe real que se cobró. Ver ADR-0068. */}
              <span className="text-sm font-semibold text-slate-900">
                {formatMoney(o.displayTotal ?? o.total, o.displayCurrency ?? o.currency)}
              </span>
              {o.displayCurrency && o.displayCurrency !== o.currency && o.total != null ? (
                <span className="text-xs text-slate-400">{formatMoney(o.total, o.currency)}</span>
              ) : (
                <span className="text-xs text-slate-400">{relativeTime(o.createdAt)}</span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "navy",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  tone?: KpiTone;
}) {
  return <Kpi label={label} value={value} sub={sub} icon={icon} tone={tone} />;
}

// --- Solicitudes de llamada (#llamada) -------------------------------------

const CALL_REQUEST_STATUS: Record<CallRequestStatus, { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "bg-amber-50 text-amber-700" },
  done: { label: "Llamado", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Descartada", cls: "bg-slate-100 text-slate-500" },
};

export function CallRequestStatusPill({ status }: { status: CallRequestStatus }) {
  const s = CALL_REQUEST_STATUS[status] ?? CALL_REQUEST_STATUS.cancelled;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/** Botones para cambiar el estado de una solicitud (Server Action vía <form action>). */
function CallRequestActions({ id, status }: { id: string; status: CallRequestStatus }) {
  const markDone = setCallRequestStatus.bind(null, id, "done");
  const discard = setCallRequestStatus.bind(null, id, "cancelled");
  const reopen = setCallRequestStatus.bind(null, id, "pending");

  if (status === "pending") {
    return (
      <div className="flex items-center gap-2">
        <form action={markDone}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Marcar llamado
          </button>
        </form>
        <form action={discard}>
          <button
            type="submit"
            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Descartar
          </button>
        </form>
      </div>
    );
  }
  return (
    <form action={reopen}>
      <button
        type="submit"
        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        Reabrir
      </button>
    </form>
  );
}

export function CallRequestList({ rows }: { rows: CallRequestRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">No hay solicitudes de llamada con este filtro.</p>
        <p className="mt-1 text-xs text-slate-400">
          Aparecen aquí cuando el agente detecta que el cliente pidió que lo llamen.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-3">
          <Link
            href={`/dashboard/conversations/${r.conversationId}`}
            className="-mx-2 min-w-0 flex-1 rounded-md px-2 py-1 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-slate-900">
                {r.contactName || r.phone || "Sin contacto"}
              </span>
              <CallRequestStatusPill status={r.status} />
            </div>
            <p className="mt-0.5 truncate text-sm text-slate-500">
              {r.phone ? `+${r.phone}` : "Sin número"} · {formatDate(r.createdAt)}
              {r.note ? ` · ${r.note}` : ""}
            </p>
          </Link>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-slate-400 sm:inline">
              {relativeTime(r.createdAt)}
            </span>
            <CallRequestActions id={r.id} status={r.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- Retargets (seguimientos automáticos) ----------------------------------

const RETARGET_STATUS: Record<RetargetStatus, { label: string; cls: string }> = {
  scheduled: { label: "Programado", cls: "bg-sky-50 text-sky-700" },
  processing: { label: "Procesando", cls: "bg-indigo-50 text-indigo-700" },
  sent: { label: "Enviado", cls: "bg-emerald-50 text-emerald-700" },
  skipped: { label: "Saltado", cls: "bg-slate-100 text-slate-600" },
  cancelled: { label: "Cancelado", cls: "bg-slate-100 text-slate-500" },
  failed: { label: "Falló", cls: "bg-rose-50 text-rose-700" },
};

export function RetargetStatusPill({ status }: { status: RetargetStatus }) {
  const s = RETARGET_STATUS[status] ?? RETARGET_STATUS.skipped;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/** "90" → "1.5h", "60" → "1h", "30" → "30m". Vacío si no hay dato. */
function formatDelayShort(min?: number | null): string {
  if (min == null || !Number.isFinite(min)) return "";
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

export function StagePill({ stage, delayMinutes }: { stage: number; delayMinutes?: number | null }) {
  const delay = formatDelayShort(delayMinutes);
  const label = delay ? `${stage}ª · ~${delay}` : `${stage}ª etapa`;
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
      {label}
    </span>
  );
}

/** Subtítulo de una fila de retarget según su estado. */
function retargetDetail(r: RetargetRow): string {
  switch (r.status) {
    case "sent":
      return `Enviado ${formatDateTime(r.sentAt)}`;
    case "scheduled":
    case "processing":
      return `Se dispara ${formatDateTime(r.scheduledAt)}`;
    default:
      return r.error ? `Motivo: ${r.error}` : "—";
  }
}

export function RetargetStatsBar({ stats }: { stats: RetargetStats }) {
  const items = [
    { label: "Programados", value: stats.scheduled + stats.processing, cls: "text-sky-700" },
    { label: "Enviados", value: stats.sent, cls: "text-emerald-700" },
    { label: "Cancelados", value: stats.cancelled, cls: "text-slate-600" },
    { label: "Saltados", value: stats.skipped, cls: "text-slate-600" },
    { label: "Fallidos", value: stats.failed, cls: "text-rose-700" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">{it.label}</p>
          <p className={`mt-1 font-display text-xl font-semibold tracking-tight ${it.cls}`}>
            {formatNumber(it.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function RetargetList({ rows }: { rows: RetargetRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">Aún no hay seguimientos.</p>
        <p className="mt-1 text-xs text-slate-400">
          Se agendan solos cuando un cliente deja de responder tras la respuesta del agente.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            href={`/dashboard/conversations/${r.conversationId}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {r.contactName || r.phone || "Sin contacto"}
                </span>
                <RetargetStatusPill status={r.status} />
                <StagePill stage={r.stage} delayMinutes={r.delayMinutes} />
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-500">{retargetDetail(r)}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs text-slate-400">
                {relativeTime(r.status === "sent" ? r.sentAt : r.scheduledAt)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// --- Reactivaciones por plantilla (7/15 días) ------------------------------

export function ReactivationStagePill({ stage }: { stage: number }) {
  const label = stage === 1 ? "Día 7" : stage === 2 ? "Día 15" : `Etapa ${stage}`;
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
      {label}
    </span>
  );
}

export function ReactivationStatsBar({ stats }: { stats: ReactivationStats }) {
  const items = [
    {
      label: "Programadas",
      value: formatNumber(stats.scheduled + stats.processing),
      cls: "text-sky-700",
    },
    { label: "Enviadas", value: formatNumber(stats.sent), cls: "text-emerald-700" },
    { label: "Canceladas", value: formatNumber(stats.cancelled), cls: "text-slate-600" },
    {
      label: "Saltadas / fallidas",
      value: formatNumber(stats.skipped + stats.failed),
      cls: "text-slate-600",
    },
    { label: "Costo plantillas", value: formatUsd(stats.costUsd), cls: "text-slate-900" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">{it.label}</p>
          <p className={`mt-1 font-display text-xl font-semibold tracking-tight ${it.cls}`}>{it.value}</p>
        </div>
      ))}
    </div>
  );
}

function reactivationDetail(r: ReactivationRow): string {
  switch (r.status) {
    case "sent":
      return `Enviada ${formatDateTime(r.sentAt)}${r.costUsd != null ? ` · ${formatUsd(r.costUsd)}` : ""}`;
    case "scheduled":
    case "processing":
      return `Se dispara ${formatDateTime(r.scheduledAt)}`;
    default:
      return r.error ? `Motivo: ${r.error}` : "—";
  }
}

export function ReactivationList({ rows }: { rows: ReactivationRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">Aún no hay reactivaciones.</p>
        <p className="mt-1 text-xs text-slate-400">
          Se agendan al primer contacto cuando el feature está encendido.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            href={`/dashboard/conversations/${r.conversationId}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {r.contactName || r.phone || "Sin contacto"}
                </span>
                <RetargetStatusPill status={r.status} />
                <ReactivationStagePill stage={r.stage} />
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-500">{reactivationDetail(r)}</p>
            </div>
            <span className="shrink-0 text-xs text-slate-400">
              {relativeTime(r.status === "sent" ? r.sentAt : r.scheduledAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Texto claro u oscuro según la luminancia del color de la etiqueta (contraste). */
function labelTextClass(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "text-white";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "text-slate-800" : "text-white";
}

/** Chip de etiqueta (presentacional) para la lista de conversaciones. */
function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className={`inline-flex max-w-[10rem] items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${labelTextClass(color)}`}
      style={{ backgroundColor: color }}
      title={name}
    >
      {name}
    </span>
  );
}

/**
 * Chip del agente dueño de la conversación (marca/país: "Colombia", "USA", ...).
 * Neutro y con borde, para no competir con las etiquetas de color ni los estados.
 */
function AgentChip({ name, brand }: { name: string; brand: string | null }) {
  return (
    <span
      className="inline-flex max-w-[10rem] items-center truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600"
      title={brand ? `${name} · ${brand}` : name}
    >
      {name}
    </span>
  );
}

export function ConversationList({
  rows,
  filtered = false,
  showAgent = true,
  methodLabels,
}: {
  rows: ConversationRow[];
  /** `method → etiqueta` según los agentes (ADR-0055). */
  methodLabels?: Record<string, string>;
  /** Cambia el mensaje de vacío cuando hay filtros activos. */
  filtered?: boolean;
  /** Chip con el agente de cada fila (se apaga al filtrar por UN agente: sería repetirlo 50 veces). */
  showAgent?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">
          {filtered ? "No hay conversaciones con este filtro." : "Aún no hay conversaciones."}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {filtered
            ? "Prueba con otro rango de fecha, estado o quita el filtro de pedido."
            : "Aparecerán aquí cuando lleguen mensajes por WhatsApp."}
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {rows.map((c) => (
        <li key={c.id}>
          <Link
            href={`/dashboard/conversations/${c.id}`}
            className="flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
          >
            <InitialsAvatar name={c.contactName || c.phone} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {c.contactName || c.phone || "Sin contacto"}
                </span>
                {showAgent && c.agentName ? (
                  <AgentChip name={c.agentName} brand={c.agentBrand} />
                ) : null}
                <StatusPill status={c.status} />
                {c.hasOrder && c.orderStatus ? <OrderBadge status={c.orderStatus} /> : null}
                {c.aiPaused ? <ManualPill /> : null}
                {c.labels.map((l) => (
                  <LabelChip key={l.id} name={l.name} color={l.color} />
                ))}
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {c.lastMessage ?? "Sin mensajes"}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs text-slate-400">{relativeTime(c.lastActivity)}</span>
              <MethodPill method={c.method} labels={methodLabels} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
