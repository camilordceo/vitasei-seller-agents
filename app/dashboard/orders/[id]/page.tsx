import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/dashboard/queries";
import { formatCOP, formatDateTime } from "@/lib/dashboard/format";
import { OrderStatusPill, MethodPill } from "../../ui";
import { OrderEditor, type OrderEditorInitial } from "../OrderEditor";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const order = await getOrder(params.id);
  if (!order) notFound();

  const title = order.contact?.name ?? order.contact?.phone ?? "Orden";

  const initial: OrderEditorInitial = {
    status: order.status,
    method: order.method,
    shippingName: order.shippingName ?? "",
    shippingAddress: order.shippingAddress ?? "",
    shippingCity: order.shippingCity ?? "",
    shippingPhone: order.shippingPhone ?? "",
    notes: order.notes ?? "",
    total: order.total,
    items: order.items.map((it) => ({
      name: it.name ?? "",
      sku: it.sku,
      qty: it.qty,
      unitPrice: it.unitPrice,
    })),
  };

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/orders"
        className="inline-flex items-center gap-1 rounded-md text-sm text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Órdenes
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <OrderStatusPill status={order.status} />
        <MethodPill method={order.method} />
        <span className="ml-auto text-lg font-semibold text-slate-900">
          {formatCOP(order.total)}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Editor */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Editar orden</h2>
            <OrderEditor orderId={order.id} initial={initial} />
          </div>
        </div>

        {/* Meta */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Datos</h2>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Cliente</dt>
                <dd className="text-right text-slate-900">{order.contact?.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Teléfono</dt>
                <dd className="text-right font-mono text-slate-900">
                  {order.contact?.phone ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Creada</dt>
                <dd className="text-right text-slate-900">{formatDateTime(order.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Últ. edición</dt>
                <dd className="text-right text-slate-900">{formatDateTime(order.updatedAt)}</dd>
              </div>
            </dl>
            <Link
              href={`/dashboard/conversations/${order.conversationId}`}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 5h16v11H8l-4 4V5Z" strokeLinejoin="round" />
              </svg>
              Ver conversación
            </Link>
          </div>

          <p className="px-1 text-xs text-slate-400">
            Corrige aquí lo que el agente haya marcado mal (estado, método, envío, ítems o total).
            Marca la orden como <span className="font-medium text-slate-500">Confirmada</span> cuando
            la venta quede cerrada para que sume en Reportes.
          </p>
        </aside>
      </div>
    </div>
  );
}
