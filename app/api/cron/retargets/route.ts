import { NextResponse } from "next/server";
import { runDueRetargets } from "@/lib/agent/retarget";
import { runDueReactivations } from "@/lib/agent/reactivation";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Genera + envía por cada seguimiento vencido; damos margen como el webhook.
export const maxDuration = 60;

/**
 * Autorización del cron. Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`
 * cuando la env `CRON_SECRET` está configurada. Si no hay secret (dev local), no
 * bloqueamos. También aceptamos `?secret=` para pruebas manuales.
 */
function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

/**
 * Cron — procesa los seguimientos (retargets 1h/8h, ADR-0017) y las
 * reactivaciones por plantilla (7d/15d, ADR-0021) vencidos. Configurado en
 * `vercel.json` (`/api/cron/retargets`, cada 5 min). Idempotente y seguro de
 * correr seguido: cada fila se toma con un claim atómico.
 */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    // Independientes: un fallo en uno no debe impedir el otro.
    const [retargets, reactivations] = await Promise.allSettled([
      runDueRetargets(),
      runDueReactivations(),
    ]);
    return NextResponse.json({
      status: "ok",
      retargets: retargets.status === "fulfilled" ? retargets.value : { error: String(retargets.reason) },
      reactivations:
        reactivations.status === "fulfilled"
          ? reactivations.value
          : { error: String(reactivations.reason) },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/retargets] failed:", message);
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}

// Vercel Cron usa GET; POST se acepta por si se dispara manualmente.
export const POST = GET;
