import {
  getAgentsReactivationConfig,
  getAgentsRetargetConfig,
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
import { Collapsible } from "../Collapsible";
import { ReactivationSettings } from "./ReactivationSettings";
import { RetargetSettings } from "./RetargetSettings";

export const dynamic = "force-dynamic";

export default async function RetargetsPage() {
  const [stats, rows, agentsReact, reactStats, reactRows, agentsRetarget] = await Promise.all([
    getRetargetStats(),
    getRecentRetargets(100),
    getAgentsReactivationConfig(),
    getReactivationStats(),
    getRecentReactivations(100),
    getAgentsRetargetConfig(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Seguimientos</h1>
        <p className="text-sm text-slate-500">
          Los dos automatismos que recuperan conversaciones: retargets (el cliente dejó de
          responder) y reactivaciones (plantillas a los 7 y 15 días). Abre el que vayas a tocar.
        </p>
      </div>

      {/*
        Cada bloque va en el mismo orden: CONFIGURACIÓN (lo que se edita) → NÚMEROS
        (cómo va) → LISTA (el detalle largo). Antes la lista quedaba en medio y
        empujaba los totales fuera de pantalla.
      */}
      <Collapsible
        title="Retargets"
        subtitle="Seguimientos automáticos cuando el cliente deja de responder. Cada agente define cuántos y a qué hora (sin config = backstop 1h/8h/23h)."
        badge={`${rows.length} recientes`}
        defaultOpen
      >
        <div className="space-y-5">
          <RetargetSettings agents={agentsRetarget} />
          <RetargetStatsBar stats={stats} />
          <RetargetList rows={rows} />
        </div>
      </Collapsible>

      <Collapsible
        title="Reactivaciones · plantillas 7 y 15 días"
        subtitle="Plantillas de WhatsApp a los 7 y 15 días del primer contacto para reactivar a quien no compró. Se cancelan si la persona compra."
        badge={`${reactRows.length} recientes`}
      >
        <div className="space-y-5">
          <ReactivationSettings agents={agentsReact} />
          <ReactivationStatsBar stats={reactStats} />
          <ReactivationList rows={reactRows} />
        </div>
      </Collapsible>
    </div>
  );
}
