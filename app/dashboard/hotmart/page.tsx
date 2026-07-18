import Link from "next/link";
import {
  getHotmartTemplates,
  getRecentHotmartEvents,
  getAgents,
  getHotmartAgentId,
} from "@/lib/dashboard/queries";
import { formatDateTime } from "@/lib/dashboard/format";
import { HotmartTemplatesManager } from "./HotmartTemplatesManager";
import { HotmartAgentSelector } from "./HotmartAgentSelector";
import { Card, CardTitle, EmptyState, PageHeader } from "../ui-kit";

export const dynamic = "force-dynamic";

/** Los 3 pasos del flujo, para leer la sección de un vistazo (docs/17). */
const STEPS: Array<{ n: string; title: string; detail: string }> = [
  {
    n: "1",
    title: "Llega el carrito",
    detail: "Hotmart dispara el webhook cuando alguien abandona el checkout de un curso.",
  },
  {
    n: "2",
    title: "Sale la plantilla",
    detail: "Se envía la plantilla de WhatsApp configurada abajo para recuperar la venta.",
  },
  {
    n: "3",
    title: "El bot atiende",
    detail: "Si el cliente responde, la conversación sigue como flujo de Hotmart (cursos).",
  },
];

export default async function HotmartPage() {
  const [templates, agents, events, hotmartAgentId] = await Promise.all([
    getHotmartTemplates(),
    getAgents(),
    getRecentHotmartEvents(25),
    getHotmartAgentId(),
  ]);
  // El proveedor viaja al selector: al mover la línea de carritos de Callbell a
  // Kapso hay que ver de un vistazo por dónde va a salir. Ver ADR-0056.
  const agentOptions = agents.map((a) => ({
    id: a.id,
    name: a.name,
    brand: a.brand,
    provider: a.provider,
  }));
  const sent = events.filter((e) => e.messageSent).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hotmart · Carritos abandonados"
        description="Recupera ventas de cursos: cada carrito abandonado dispara una plantilla de WhatsApp. Plantilla y textos se cambian aquí, sin tocar código."
      />

      {/* El flujo completo en una línea: qué pasa y en qué orden. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="flex gap-3.5 rounded-2xl border border-slate-200 bg-white p-4">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-900 font-display text-sm font-semibold text-white">
              {s.n}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{s.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{s.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <HotmartAgentSelector agents={agentOptions} current={hotmartAgentId} />

      <HotmartTemplatesManager initial={templates} agents={agentOptions} />

      {/* Últimos carritos recibidos */}
      <Card>
        <CardTitle
          title="Últimos carritos"
          subtitle={
            events.length > 0
              ? `${sent} de ${events.length} con plantilla enviada`
              : undefined
          }
          right={<span className="text-xs tabular-nums text-slate-400">{events.length}</span>}
        />
        {events.length === 0 ? (
          <EmptyState
            title="Aún no llegan carritos"
            description="Cuando Hotmart dispare el webhook de carrito abandonado, aparecerán aquí con el estado del envío."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-900">{e.buyerName ?? "—"}</span>
                  <span className="ml-2 font-mono text-xs text-slate-400">{e.phone}</span>
                  {e.productName && (
                    <p className="truncate text-xs text-slate-500" title={e.productName}>
                      {e.productName}
                    </p>
                  )}
                </div>
                {e.messageSent ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    Enviado
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700"
                    title={e.sendError ?? undefined}
                  >
                    No enviado
                  </span>
                )}
                <span className="text-xs text-slate-400">{formatDateTime(e.createdAt)}</span>
                {e.conversationId && (
                  <Link
                    href={`/dashboard/conversations/${e.conversationId}`}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  >
                    Ver chat
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
