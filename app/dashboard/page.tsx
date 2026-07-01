import Link from "next/link";
import { getKpis, getRecentConversations } from "@/lib/dashboard/queries";
import { formatCOP, formatNumber, formatUsd, relativeTime } from "@/lib/dashboard/format";
import { KpiCard, StatusPill, MethodPill } from "./ui";

// Datos siempre frescos (nada de caché estática en el panel).
export const dynamic = "force-dynamic";

const IconMoney = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);
const IconReceipt = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M6 3.5h12v17l-3-1.5-3 1.5-3-1.5-3 1.5v-17Z" />
    <path d="M9 8h6M9 12h6" strokeLinecap="round" />
  </svg>
);
const IconChip = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3" strokeLinecap="round" />
  </svg>
);

export default async function DashboardPage() {
  const [kpis, convos] = await Promise.all([getKpis(), getRecentConversations(30)]);
  const totalTokens = kpis.inputTokens + kpis.outputTokens;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Resumen</h1>
        <p className="text-sm text-slate-500">Ventas, conversaciones y consumo del agente.</p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Ventas generadas"
          value={formatCOP(kpis.totalSales)}
          sub={`${formatNumber(kpis.txCount)} ${kpis.txCount === 1 ? "orden" : "órdenes"}`}
          icon={IconMoney}
        />
        <KpiCard
          label="Transacciones"
          value={formatNumber(kpis.txCount)}
          sub="órdenes creadas por el agente"
          icon={IconReceipt}
        />
        <KpiCard
          label="Costo de tokens (estimado)"
          value={formatUsd(kpis.estCostUsd)}
          sub={`${formatNumber(totalTokens)} tokens · placeholder`}
          icon={IconChip}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Conversaciones recientes</h2>
        {convos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm text-slate-500">Aún no hay conversaciones.</p>
            <p className="mt-1 text-xs text-slate-400">
              Aparecerán aquí cuando lleguen mensajes por WhatsApp.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {convos.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/conversations/${c.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {c.contactName ?? c.phone}
                      </span>
                      <StatusPill status={c.status} />
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
        )}
      </section>
    </div>
  );
}
