import Link from "next/link";
import { getOrders } from "@/lib/dashboard/queries";
import { OrderList } from "../ui";
import { NewOrderButton } from "./NewOrderButton";
import type { OrderStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

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

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const raw = searchParams.status;
  const status = raw && VALID.has(raw) ? (raw as OrderStatus) : undefined;
  const orders = await getOrders({ status });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Órdenes</h1>
          <p className="text-sm text-slate-500">
            Transacciones creadas por el agente. Ábrelas para ver o corregir los datos, o crea una
            orden manual.
          </p>
        </div>
        <span className="shrink-0 text-sm text-slate-400">{orders.length}</span>
      </div>

      <NewOrderButton />

      <nav className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = (f.value === "all" && !status) || f.value === status;
          const href = f.value === "all" ? "/dashboard/orders" : `/dashboard/orders?status=${f.value}`;
          return (
            <Link
              key={f.value}
              href={href}
              className={
                active
                  ? "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              }
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <OrderList rows={orders} />
    </div>
  );
}
