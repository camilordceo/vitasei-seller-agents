import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  type CallbellWebhookBody,
  getAttachments,
  getChannelUuid,
  getDestinationNumber,
  getMessageType,
  isInboundMessageEvent,
  normalizePhone,
} from "@/lib/callbell/types";
import {
  ingestInboundMessage,
  runDebouncedReply,
} from "@/lib/agent/processMessage";
import { resolveAgentForInbound } from "@/lib/agent/agents";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La respuesta corre en background (waitUntil): sleep del debounce + OpenAI + envío.
// 300s, no 60. Con 60 la invocación se moría JUSTO antes del último paso y el
// video por palabra clave no salía nunca (Vitasei USA, 2026-07-22: respuestas de
// ~57s por el debounce de 12s + generación + envío de la imagen; el video quedaba
// fuera del presupuesto y no dejaba ni evento ni error). Ver ADR-0073.
export const maxDuration = 300;

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
 * Log best-effort del filtro de número (`inbox_rejected` / `inbox_indeterminate`).
 * No tiene `conversation_id` (aún no hay conversación) y nunca debe tumbar el 200.
 */
async function logInbox(type: string, payload: unknown): Promise<void> {
  try {
    await createServiceClient()
      .from("events_log")
      .insert({ type, payload: payload as unknown as Json });
  } catch {
    // best-effort: si ni el log entra, queda en los logs de Vercel.
  }
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

  // 5) Enrutamiento multi-agente: ¿a qué agente pertenece este inbound? Callbell
  //    tiene varios números/marcas y un solo webhook. Se resuelve por canal o
  //    número destino contra la tabla `agents` (con fallback a las env de Vercel
  //    para el agente actual). Sin agente → no es un número nuestro. Ver docs/16.
  const supabase = createServiceClient();
  let agentId: string;
  try {
    const agent = await resolveAgentForInbound(supabase, payload);
    if (!agent) {
      await logInbox("inbox_rejected", {
        phone,
        messageUuid,
        channelUuid: getChannelUuid(payload),
        dest: getDestinationNumber(payload),
      });
      return ok();
    }
    agentId = agent.id;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[callbell webhook] resolve-agent failed:", message);
    await logInbox("process_error", {
      phase: "resolve-agent",
      phone,
      messageUuid,
      error: message,
    });
    return ok();
  }

  const receivedAt = Date.now();

  // Adjunto (imagen/audio/…): Callbell lo trae en `attachments` (array de URLs).
  // Tomamos la primera; el resto queda en el `raw` del events_log. Ver docs/15.
  const mediaUrl = getAttachments(payload)[0] ?? null;

  // 6) Ingesta síncrona. Un error no debe tumbar el webhook: se registra y 200.
  try {
    const ingest = await ingestInboundMessage({
      phone,
      messageUuid,
      agentId,
      text: payload.text ?? null,
      // Callbell no manda `type`: se infiere del adjunto. Ver `getMessageType`.
      messageType: getMessageType(payload),
      mediaUrl,
      contactName: payload.contact?.name ?? null,
      callbellContactUuid: payload.contact?.uuid ?? null,
      conversationHref: payload.conversationHref ?? null,
      raw: body,
      receivedAt,
    });

    // 7) Duplicado → no reprogramar. Si no, agendar la respuesta con debounce.
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
