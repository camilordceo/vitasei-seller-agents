import { getRecentRetargets, getRetargetStats } from "@/lib/dashboard/queries";
import { RetargetList, RetargetStatsBar } from "../ui";

export const dynamic = "force-dynamic";

export default async function RetargetsPage() {
  const [stats, rows] = await Promise.all([getRetargetStats(), getRecentRetargets(100)]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Retargets</h1>
          <p className="text-sm text-slate-500">
            Seguimientos automáticos ~1h y ~8h después de que el cliente deja de responder.
          </p>
        </div>
        <span className="text-sm text-slate-400">{rows.length}</span>
      </div>

      <RetargetStatsBar stats={stats} />
      <RetargetList rows={rows} />
    </div>
  );
}
