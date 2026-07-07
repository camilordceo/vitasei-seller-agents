import { NextResponse } from "next/server";
import { processHotmartCartAbandonment } from "@/lib/hotmart/processEvent";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El envío de la plantilla puede tomar unos segundos
export const maxDuration = 30;

/**
 * Respuesta estándar del webhook: Hotmart espera un 2xx para confirmar recepción.
 */
function ok(data?: Record<string, unknown>) {
  return NextResponse.json({ status: "ok", ...data });
}

function error(message: string, status = 400) {
  return NextResponse.json({ status: "error", message }, { status });
}

/**
 * Validación del secret compartido. Si `HOTMART_WEBHOOK_SECRET` está
 * configurado, exigimos que coincida (query `?secret=`).
 * Si NO está configurado (dev local), no bloqueamos.
 */
function secretIsValid(req: Request): boolean {
  const expected = env.HOTMART_WEBHOOK_SECRET;
  if (!expected) return true; // Dev mode: no secret required
  const fromQuery = new URL(req.url).searchParams.get("secret");
  return fromQuery === expected;
}

/**
 * Log best-effort de eventos rechazados/errores.
 * No tiene `conversation_id` necesariamente y nunca debe tumbar el 200.
 */
async function logEvent(type: string, payload: unknown): Promise<void> {
  try {
    await createServiceClient()
      .from("events_log")
      .insert({ type, payload: payload as unknown as Json });
  } catch {
    // best-effort: si ni el log entra, queda en los logs de Vercel.
  }
}

/**
 * Webhook de Hotmart — Carritos Abandonados
 *
 * URL para configurar en Hotmart:
 * https://<tu-dominio>.vercel.app/api/webhooks/hotmart?secret=<HOTMART_WEBHOOK_SECRET>
 *
 * Evento soportado: PURCHASE_OUT_OF_SHOPPING_CART
 *
 * Flujo:
 * 1. Valida secret
 * 2. Parsea y valida el payload
 * 3. Procesa el evento (crea contacto/conversación, envía plantilla)
 * 4. Responde 200
 *
 * Ver: docs/17-hotmart-carritos.md, ADR-0035
 */
export async function POST(req: Request) {
  // 1) Validar secret
  if (!secretIsValid(req)) {
    await logEvent("hotmart_webhook_rejected", { reason: "invalid_secret" });
    // Respondemos 200 para no filtrar información (Hotmart reintentará si no)
    return ok({ processed: false, reason: "invalid_secret" });
  }

  // 2) Parsear body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await logEvent("hotmart_webhook_rejected", { reason: "invalid_json" });
    return error("Invalid JSON body");
  }

  // 3) Log del webhook recibido (antes de procesar)
  const eventId = (body as Record<string, unknown>)?.id;
  const eventType = (body as Record<string, unknown>)?.event;
  await logEvent("hotmart_webhook_received", { eventId, eventType });

  // 4) Solo procesamos carrito abandonado por ahora
  if (eventType !== "PURCHASE_OUT_OF_SHOPPING_CART") {
    return ok({
      processed: false,
      reason: "unsupported_event",
      event: eventType,
    });
  }

  // 5) Procesar el evento
  try {
    const result = await processHotmartCartAbandonment(body);

    if (!result.success && result.error) {
      console.error("[hotmart webhook] processing failed:", result.error);
    }

    return ok({
      processed: true,
      duplicate: result.duplicate,
      conversationId: result.conversationId,
      messageSent: result.messageSent,
      error: result.error,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[hotmart webhook] unexpected error:", message);
    await logEvent("hotmart_webhook_error", { eventId, error: message });

    // Respondemos 200 igual para que Hotmart no reintente indefinidamente
    return ok({
      processed: false,
      error: message,
    });
  }
}

/**
 * GET para verificar que el endpoint está activo.
 * Hotmart puede hacer health checks.
 */
export async function GET() {
  return ok({ endpoint: "hotmart", active: true });
}
