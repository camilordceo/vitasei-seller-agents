import type { ReactNode } from "react";
import type { ConversationStatus, FulfillmentMethod, OrderStatus } from "@/lib/supabase/types";

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

const ORDER_STATUS: Record<OrderStatus, string> = {
  pending_handoff: "Pendiente de handoff",
  handed_off: "Con logística",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
};

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS[status] ?? status;
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
