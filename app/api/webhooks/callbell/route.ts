import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import {
  type CallbellWebhookBody,
  isInboundMessageEvent,
  normalizePhone,
} from "@/lib/callbell/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Respuesta estándar del webhook. Callbell hace health-checks y espera SIEMPRE
 * un 200 `{"status":"ok"}`; si no respondemos ~10 min, alerta al admin.
 * Por eso nunca hacemos trabajo pesado inline: validamos, encolamos y 200.
 */
function ok() {
  return NextResponse.json({ status: "ok" });
}

/**
 * Validación del secret compartido. Callbell aún no tiene un mecanismo de firma
 * confirmado (TODO endurecer en Sprint 7). Si `CALLBELL_WEBHOOK_SECRET` está
 * configurado, exigimos que coincida (header `x-callbell-secret` o `?secret=`).
 * Si NO está configurado (dev local), no bloqueamos.
 */
function secretIsValid(req: Request): boolean {
  const expected = process.env.CALLBELL_WEBHOOK_SECRET;
  if (!expected) return true; // dev: sin secret configurado, no exigimos
  const fromHeader = req.headers.get("x-callbell-secret");
  const fromQuery = new URL(req.url).searchParams.get("secret");
  return fromHeader === expected || fromQuery === expected;
}

export async function POST(req: Request) {
  // 1) Validar secret. Si no es válido, respondemos 200 igual (no filtrar info).
  if (!secretIsValid(req)) return ok();

  // 2) Parsear body. Un ping/health-check sin JSON válido → 200 ok.
  let body: CallbellWebhookBody;
  try {
    body = (await req.json()) as CallbellWebhookBody;
  } catch {
    return ok();
  }

  // 3) Filtrar: solo `message_created` inbound del cliente.
  if (!body || !isInboundMessageEvent(body)) return ok();

  // 4) Normalizar y extraer lo necesario para idempotencia + concurrencia.
  const payload = body.payload ?? {};
  const phone = normalizePhone(payload.contact?.phoneNumber);
  const messageUuid = payload.uuid ?? null;

  // Sin teléfono o sin uuid no podemos procesar de forma idempotente → ack y salir.
  if (!phone || !messageUuid) return ok();

  // 5) Encolar en Inngest (el loop corre fuera del request del webhook).
  await inngest.send({
    name: "whatsapp/message.received",
    data: {
      phone,
      messageUuid,
      text: payload.text ?? null,
      messageType: payload.type ?? null,
      contactName: payload.contact?.name ?? null,
      callbellContactUuid: payload.contact?.uuid ?? null,
      conversationHref: payload.conversationHref ?? null,
      raw: body,
    },
  });

  return ok();
}

/**
 * Algunos health-checks de Callbell hacen GET. Respondemos 200 ok.
 */
export async function GET() {
  return ok();
}
