import Link from "next/link";
import { getHotmartTemplates, getRecentHotmartEvents, getAgents } from "@/lib/dashboard/queries";
import { formatDateTime } from "@/lib/dashboard/format";
import { HotmartTemplatesManager } from "./HotmartTemplatesManager";

export const dynamic = "force-dynamic";

export default async function HotmartPage() {
  const [templates, agents, events] = await Promise.all([
    getHotmartTemplates(),
    getAgents(),
    getRecentHotmartEvents(25),
  ]);
  const agentOptions = agents.map((a) => ({ id: a.id, name: a.name, brand: a.brand }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Hotmart · Carritos abandonados</h1>
        <p className="text-sm text-slate-500">
          Cuando llega un carrito abandonado de Hotmart, se envía una plantilla de WhatsApp para
          recuperar la venta. Configura aquí la plantilla de Callbell y el texto — se cambian sin
          tocar código. Si el cliente responde, el bot lo atiende como flujo de Hotmart.
        </p>
      </div>

      <HotmartTemplatesManager initial={templates} agents={agentOptions} />

      {/* Últimos carritos recibidos */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Últimos carritos <span className="font-normal text-slate-400">({events.length})</span>
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-slate-400">
            Aún no se han recibido carritos abandonados. Cuando Hotmart dispare el webhook, aparecerán
            aquí.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-800">{e.buyerName ?? "—"}</span>
                  <span className="ml-2 font-mono text-xs text-slate-400">{e.phone}</span>
                  {e.productName && (
                    <p className="truncate text-xs text-slate-500" title={e.productName}>
                      {e.productName}
                    </p>
                  )}
                </div>
                {e.messageSent ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    Enviado
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700"
                    title={e.sendError ?? undefined}
                  >
                    No enviado
                  </span>
                )}
                <span className="text-xs text-slate-400">{formatDateTime(e.createdAt)}</span>
                {e.conversationId && (
                  <Link
                    href={`/dashboard/conversations/${e.conversationId}`}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  >
                    Ver chat
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
