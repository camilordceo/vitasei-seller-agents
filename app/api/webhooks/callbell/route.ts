import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  type CallbellWebhookBody,
  isInboundMessageEvent,
  normalizePhone,
} from "@/lib/callbell/types";
import {
  ingestInboundMessage,
  runDebouncedReply,
} from "@/lib/agent/processMessage";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La respuesta corre en background (waitUntil): sleep del debounce + OpenAI + envío.
export const maxDuration = 60;

/** Respuesta estándar del webhook: Callbell espera SIEMPRE 200 `{"status":"ok"}`. */
function ok() {
  return NextResponse.json({ status: "ok" });
}

/**
 * Validación del secret compartido. Si `CALLBELL_WEBHOOK_SECRET` está
 * configurado, exigimos que coincida (header `x-callbell-secret` o `?secret=`).
 * Si NO está configurado (dev local), no bloqueamos.
 */
function secretIsValid(req: Request): boolean {
  const expected = process.env.CALLBELL_WEBHOOK_SECRET;
  if (!expected) return true;
  const fromHeader = req.headers.get("x-callbell-secret");
  const fromQuery = new URL(req.url).searchParams.get("secret");
  return fromHeader === expected || fromQuery === expected;
}

/**
 * Webhook de Callbell — ingesta inline + respuesta con debounce.
 *
 * 1) Valida y normaliza. 2) Ingesta síncrona (guarda el inbound, marca el
 * "último mensaje"). 3) Responde 200 y agenda la respuesta en background con
 * `waitUntil`: espera unos segundos y, si nadie escribió después, responde a
 * todos los mensajes juntos en una sola llamada (ver ADR-0012 y ADR-0013).
 * La idempotencia (`callbell_message_uuid`) protege ante reintentos de Callbell.
 */
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

  // 4) Normalizar y extraer lo necesario para idempotencia + debounce.
  const payload = body.payload ?? {};
  const phone = normalizePhone(payload.contact?.phoneNumber);
  const messageUuid = payload.uuid ?? null;

  // Sin teléfono o sin uuid no podemos procesar de forma idempotente → ack y salir.
  if (!phone || !messageUuid) return ok();

  const receivedAt = Date.now();

  // 5) Ingesta síncrona. Un error no debe tumbar el webhook: se registra y 200.
  try {
    const ingest = await ingestInboundMessage({
      phone,
      messageUuid,
      text: payload.text ?? null,
      messageType: payload.type ?? null,
      contactName: payload.contact?.name ?? null,
      callbellContactUuid: payload.contact?.uuid ?? null,
      conversationHref: payload.conversationHref ?? null,
      raw: body,
      receivedAt,
    });

    // 6) Duplicado → no reprogramar. Si no, agendar la respuesta con debounce.
    if (!ingest.duplicate) {
      waitUntil(
        runDebouncedReply({
          conversationId: ingest.conversationId,
          contactId: ingest.contactId,
          phone,
          messageUuid,
          receivedAt,
        }),
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[callbell webhook] ingest failed:", message);
    try {
      await createServiceClient()
        .from("events_log")
        .insert({
          type: "process_error",
          payload: { phase: "ingest", phone, messageUuid, error: message } as unknown as Json,
        });
    } catch {
      // best-effort: si ni el log entra, ya quedó en los logs de Vercel.
    }
  }

  return ok();
}

/** Algunos health-checks de Callbell hacen GET. Respondemos 200 ok. */
export async function GET() {
  return ok();
}
