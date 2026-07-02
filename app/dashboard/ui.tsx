import Link from "next/link";
import type { ReactNode } from "react";
import type {
  ConversationRow,
  OrderRow,
  RetargetRow,
  RetargetStats,
} from "@/lib/dashboard/queries";
import { formatCOP, formatDate, formatDateTime, formatNumber, relativeTime } from "@/lib/dashboard/format";
import { setConversationManual } from "./actions";
import type {
  ConversationStatus,
  FulfillmentMethod,
  OrderStatus,
  RetargetStatus,
} from "@/lib/supabase/types";

/** Píldoras de estado y método, y tarjeta KPI. Presentacional puro. */

const STATUS: Record<ConversationStatus, { label: string; cls: string }> = {
  active: { label: "Activa", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  handed_off: { label: "Con logística", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  closed: { label: "Cerrada", cls: "bg-slate-100 text-slate-600 ring-slate-500/20" },
};

export function StatusPill({ status }: { status: ConversationStatus }) {
  const s = STATUS[status] ?? STATUS.closed;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

const METHOD: Record<FulfillmentMethod, string> = {
  addi: "Addi",
  cod: "Contra entrega",
  undecided: "Sin definir",
};

export function MethodPill({ method }: { method: FulfillmentMethod }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20">
      {METHOD[method] ?? METHOD.undecided}
    </span>
  );
}

/** Píldora "Manual": la IA está pausada y un humano atiende la conversación. */
export function ManualPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-600/20">
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
            : "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
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
    cls: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  handed_off: { label: "Con logística", cls: "bg-indigo-50 text-indigo-700 ring-indigo-600/20" },
  confirmed: { label: "Confirmada", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  cancelled: { label: "Cancelada", cls: "bg-rose-50 text-rose-700 ring-rose-600/20" },
};

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS[status]?.label ?? status;
}

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 ring-slate-500/20" };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/** Lista de órdenes (sección Órdenes). Enlaza al detalle editable. */
export function OrderList({ rows }: { rows: OrderRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">No hay órdenes con este filtro.</p>
        <p className="mt-1 text-xs text-slate-400">
          El agente crea una orden cuando el cliente cierra la compra en WhatsApp.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {rows.map((o) => (
        <li key={o.id}>
          <Link
            href={`/dashboard/orders/${o.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {o.contactName || o.phone || "Sin contacto"}
                </span>
                <OrderStatusPill status={o.status} />
                <MethodPill method={o.method} />
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {o.itemsCount} {o.itemsCount === 1 ? "ítem" : "ítems"}
                {o.shippingCity ? ` · ${o.shippingCity}` : ""} · {formatDate(o.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-sm font-semibold text-slate-900">{formatCOP(o.total)}</span>
              <span className="text-xs text-slate-400">{relativeTime(o.createdAt)}</span>
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
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className="text-slate-400" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

// --- Retargets (seguimientos automáticos) ----------------------------------

const RETARGET_STATUS: Record<RetargetStatus, { label: string; cls: string }> = {
  scheduled: { label: "Programado", cls: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  processing: { label: "Procesando", cls: "bg-indigo-50 text-indigo-700 ring-indigo-600/20" },
  sent: { label: "Enviado", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  skipped: { label: "Saltado", cls: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  cancelled: { label: "Cancelado", cls: "bg-slate-100 text-slate-500 ring-slate-400/20" },
  failed: { label: "Falló", cls: "bg-rose-50 text-rose-700 ring-rose-600/20" },
};

export function RetargetStatusPill({ status }: { status: RetargetStatus }) {
  const s = RETARGET_STATUS[status] ?? RETARGET_STATUS.skipped;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

export function StagePill({ stage }: { stage: number }) {
  const label = stage === 1 ? "1ª · ~1h" : stage === 2 ? "2ª · ~8h" : `Etapa ${stage}`;
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20">
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
        <div key={it.label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-xs font-medium text-slate-500">{it.label}</p>
          <p className={`mt-1 text-xl font-semibold tracking-tight ${it.cls}`}>
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
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">Aún no hay seguimientos.</p>
        <p className="mt-1 text-xs text-slate-400">
          Se agendan solos cuando un cliente deja de responder tras la respuesta del agente.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            href={`/dashboard/conversations/${r.conversationId}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {r.contactName || r.phone || "Sin contacto"}
                </span>
                <RetargetStatusPill status={r.status} />
                <StagePill stage={r.stage} />
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

export function ConversationList({ rows }: { rows: ConversationRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">Aún no hay conversaciones.</p>
        <p className="mt-1 text-xs text-slate-400">
          Aparecerán aquí cuando lleguen mensajes por WhatsApp.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {rows.map((c) => (
        <li key={c.id}>
          <Link
            href={`/dashboard/conversations/${c.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {c.contactName || c.phone || "Sin contacto"}
                </span>
                <StatusPill status={c.status} />
                {c.aiPaused ? <ManualPill /> : null}
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {c.lastMessage ?? "Sin mensajes"}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs text-slate-400">{relativeTime(c.lastActivity)}</span>
              <MethodPill method={c.method} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
