import { NextResponse } from "next/server";
import { runDueVoiceCalls, reconcileVoiceCalls } from "@/lib/agent/voiceCall";
import { refreshRunningCampaigns } from "@/lib/agent/voiceCampaign";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Colocar N llamadas + reconciliar las abiertas: mismo margen que los retargets.
export const maxDuration = 60;

/**
 * Autorización del cron. Igual que `/api/cron/retargets`: Vercel Cron manda
 * `Authorization: Bearer <CRON_SECRET>`; sin secret (dev local) no bloqueamos;
 * `?secret=` sirve para pruebas manuales.
 */
function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

/**
 * Cron de llamadas con IA (ver docs/25, ADR-0063). Hace dos cosas:
 *
 *  1. **Colocar** las llamadas vencidas (`scheduled` y `scheduled_at <= now`),
 *     cada una con claim atómico para que dos ejecuciones solapadas no marquen
 *     el mismo número dos veces.
 *  1'. Las llamadas de **campaña** (ADR-0084) entran por el mismo camino, con una
 *     guarda extra: no se coloca la siguiente hasta que pasó el intervalo desde
 *     la anterior. Por eso este cron corre cada MINUTO: es la resolución con la
 *     que se puede honrar un "una llamada cada 2 minutos".
 *  2. **Reconciliar** las llamadas ya colocadas que siguen sin desenlace,
 *     leyéndolas por API. Esto es lo que hace que la feature funcione **aunque
 *     el webhook nunca se configure** — el caso realista cuando el assistant de
 *     Synthflow es compartido y ya apunta a otro sistema (ADR-0061).
 *
 *  3. **Cerrar** las campañas que ya no tienen nada pendiente.
 *
 * Registrado en `vercel.json` cada minuto (antes cada 5): el ritmo de las
 * campañas no puede ser más fino que la frecuencia del cron.
 */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    // Independientes: que falle uno no debe impedir el otro.
    const [due, reconciled, campaigns] = await Promise.allSettled([
      runDueVoiceCalls(),
      reconcileVoiceCalls(),
      refreshRunningCampaigns(),
    ]);
    return NextResponse.json({
      status: "ok",
      enabled: env.VOICE_CALLS_ENABLED,
      calls: due.status === "fulfilled" ? due.value : { error: String(due.reason) },
      reconciled:
        reconciled.status === "fulfilled" ? reconciled.value : { error: String(reconciled.reason) },
      campaigns: campaigns.status === "fulfilled" ? campaigns.value : 0,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/voice-calls] failed:", message);
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}

// Vercel Cron usa GET; POST se acepta por si se dispara manualmente.
export const POST = GET;
