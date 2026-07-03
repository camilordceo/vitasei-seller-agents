import {
  getAgentsReactivationConfig,
  getRecentReactivations,
  getRecentRetargets,
  getReactivationStats,
  getRetargetStats,
} from "@/lib/dashboard/queries";
import {
  ReactivationList,
  ReactivationStatsBar,
  RetargetList,
  RetargetStatsBar,
} from "../ui";
import { ReactivationSettings } from "./ReactivationSettings";

export const dynamic = "force-dynamic";

export default async function RetargetsPage() {
  const [stats, rows, agentsReact, reactStats, reactRows] = await Promise.all([
    getRetargetStats(),
    getRecentRetargets(100),
    getAgentsReactivationConfig(),
    getReactivationStats(),
    getRecentReactivations(100),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Retargets</h1>
            <p className="text-sm text-slate-500">
              Seguimientos automáticos ~1h y ~8h después de que el cliente deja de responder.
            </p>
          </div>
          <span className="text-sm text-slate-400">{rows.length}</span>
        </div>

        <RetargetList rows={rows} />
        <RetargetStatsBar stats={stats} />
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Reactivaciones · plantillas 7 y 15 días
          </h2>
          <p className="text-sm text-slate-500">
            Plantillas de WhatsApp automáticas a los 7 y 15 días del primer contacto para reactivar
            a quien no compró, a bajo costo. Se cancelan si la persona compra.
          </p>
        </div>

        <ReactivationSettings agents={agentsReact} />
        <ReactivationStatsBar stats={reactStats} />
        <ReactivationList rows={reactRows} />
      </section>
    </div>
  );
}
