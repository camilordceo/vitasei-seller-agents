import { NextResponse } from "next/server";
import { runDueRetargets } from "@/lib/agent/retarget";
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
 * Cron de retargeting — procesa los seguimientos vencidos (ver ADR-0017).
 * Configurado en `vercel.json` (`/api/cron/retargets`, cada 5 min). Idempotente
 * y seguro de correr seguido: cada fila se toma con un claim atómico.
 */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const stats = await runDueRetargets();
    return NextResponse.json({ status: "ok", ...stats });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/retargets] failed:", message);
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}

// Vercel Cron usa GET; POST se acepta por si se dispara manualmente.
export const POST = GET;
