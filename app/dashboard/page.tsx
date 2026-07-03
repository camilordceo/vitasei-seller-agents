import Link from "next/link";
import { getKpis, getRecentConversations } from "@/lib/dashboard/queries";
import { formatCOP, formatNumber, formatUsd } from "@/lib/dashboard/format";
import { KpiCard, ConversationList } from "./ui";

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
  const [kpis, convos] = await Promise.all([getKpis(), getRecentConversations({ limit: 8 })]);
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Conversaciones recientes</h2>
          <Link
            href="/dashboard/conversations"
            className="rounded-md text-sm text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            Ver todas
          </Link>
        </div>
        <ConversationList rows={convos} />
      </section>
    </div>
  );
}
