import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  KAPSO_EVENT_MESSAGE_RECEIVED,
  getContactName,
  getContactPhone,
  getConversationId,
  getMediaUrl,
  getMessageId,
  getMessageType,
  getPhoneNumberId,
  getText,
  getTranscript,
  isInboundEvent,
  unwrapEvents,
  type KapsoMessageEvent,
  type KapsoWebhookBody,
} from "@/lib/kapso/types";
import { KAPSO_SIGNATURE_HEADER, verifyKapsoSignature } from "@/lib/kapso/signature";
import { ingestInboundMessage, runDebouncedReply } from "@/lib/agent/processMessage";
import { agentKapsoWebhookSecret, resolveKapsoAgentForInbound } from "@/lib/agent/agents";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La respuesta corre en background (waitUntil): sleep del debounce + OpenAI + envío.
export const maxDuration = 60;

/**
 * Respuesta estándar: Kapso espera **200 en menos de 10 segundos**. Si no, reintenta
 * (inmediato → 10s → 40s → 90s) y —esto es lo importante— **auto-pausa el webhook**
 * si en 15 min hay ≥20 entregas con ≥85% de fallos, y reactivarlo es MANUAL desde su
 * dashboard. Por eso acá se responde 200 casi siempre y el trabajo real va en
 * background con `waitUntil`. Ver docs/24 §Reintentos.
 */
function ok(data?: Record<string, unknown>) {
  return NextResponse.json({ status: "ok", ...data });
}

/** Log best-effort (sin `conversation_id`: aún no hay conversación). Nunca tumba el 200. */
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
 * Webhook de Kapso — ingesta inline + respuesta con debounce.
 *
 * Es el gemelo de `/api/webhooks/callbell`: cambia CÓMO se lee el mensaje (payload
 * propio de Kapso, con la forma de Meta adentro) pero desemboca en el MISMO cerebro
 * (`ingestInboundMessage` + `runDebouncedReply`), así que el debounce, el gate
 * anti-alucinación, el cierre de venta, los retargets y Hotmart se comportan igual
 * en los dos proveedores. Ver docs/24, ADR-0056.
 *
 * URL a registrar en Kapso (por número):
 *   POST /platform/v1/whatsapp/phone_numbers/{phone_number_id}/webhooks
 *   { "whatsapp_webhook": { "kind": "kapso", "url": "https://<dominio>/api/webhooks/kapso",
 *     "events": ["whatsapp.message.received"], "secret_key": "<KAPSO_WEBHOOK_SECRET>",
 *     "buffer_enabled": false } }
 *
 * `buffer_enabled: false` a propósito: el debounce lo hace nuestro backend (ADR-0013)
 * y así los dos proveedores se comportan idéntico. Aun así el parser tolera lotes,
 * porque si alguien lo enciende en el dashboard TODOS los eventos pasan a llegar
 * en lote. Ver ADR-0058.
 */
export async function POST(req: Request) {
  // 1) Cuerpo CRUDO: la firma se calcula sobre estos bytes, así que no se puede
  //    usar `req.json()` (re-serializar cambiaría el HMAC). Ver `verifyKapsoSignature`.
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return ok();
  }

  let body: KapsoWebhookBody;
  try {
    body = JSON.parse(raw) as KapsoWebhookBody;
  } catch {
    return ok(); // ping / health-check sin JSON válido
  }

  // 2) Evento: en los payloads sueltos el nombre viaja SOLO en el header
  //    (`X-Webhook-Event`); en los de lote también en `body.type`. Si viene y no es
  //    un mensaje recibido (sent/delivered/read/failed), no es para nosotros.
  const eventName = req.headers.get("x-webhook-event") ?? body.type ?? null;
  if (eventName && eventName !== KAPSO_EVENT_MESSAGE_RECEIVED) return ok({ ignored: eventName });

  // 3) Normalizar a lista (suelto o lote) y quedarnos con los del cliente.
  const events = unwrapEvents(body).filter(isInboundEvent);
  if (events.length === 0) return ok();

  // 4) Enrutar: todos los eventos de un request son de la misma conversación, así
  //    que basta con resolver el agente una vez (por `phone_number_id`).
  const phoneNumberId = getPhoneNumberId(events[0]);
  const supabase = createServiceClient();

  let agent;
  try {
    agent = await resolveKapsoAgentForInbound(supabase, {
      phoneNumberId,
      number: null, // Kapso no manda el número de negocio, solo su id
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[kapso webhook] resolve-agent failed:", message);
    await logEvent("process_error", { phase: "resolve-agent", phoneNumberId, error: message });
    return ok();
  }

  // 5) Firma. Va ANTES de cualquier escritura: resolver el agente es solo una
  //    lectura, pero a partir de acá todo deja rastro y este endpoint es público.
  //    El secreto sale del agente (cada proyecto de Kapso puede tener el suyo) y,
  //    si el número no es nuestro, del global. Sin secreto configurado no se
  //    bloquea (dev), igual que en Callbell.
  const secret = agent ? agentKapsoWebhookSecret(agent) : env.KAPSO_WEBHOOK_SECRET;
  if (secret && !verifyKapsoSignature(raw, req.headers.get(KAPSO_SIGNATURE_HEADER), secret)) {
    // A los logs de Vercel y NO a `events_log`: un request sin firma válida no debe
    // poder escribir en la base (si no, cualquiera que conozca la URL podría inflar
    // la tabla). El caso real de este error es un secreto mal pegado, y para eso
    // basta con verlo en los logs. 200 para no filtrar información.
    console.warn(`[kapso webhook] firma inválida (phone_number_id ${phoneNumberId ?? "?"})`);
    return ok();
  }

  if (!agent) {
    // No es un número nuestro, o falta pegar el Phone Number ID en el dashboard.
    await logEvent("inbox_rejected", { provider: "kapso", phoneNumberId });
    return ok();
  }

  // 6) Ingesta de cada mensaje. Un fallo se registra y NUNCA tumba el 200.
  for (const event of events) {
    try {
      await ingestKapsoEvent(event, agent.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[kapso webhook] ingest failed:", message);
      await logEvent("process_error", {
        phase: "ingest",
        provider: "kapso",
        messageId: getMessageId(event),
        error: message,
      });
    }
  }

  return ok();
}

/**
 * Normaliza UN evento de Kapso al `InboundMessage` del cerebro y lo ingesta. Si es
 * nuevo, agenda la respuesta con debounce (igual que Callbell).
 */
async function ingestKapsoEvent(event: KapsoMessageEvent, agentId: string): Promise<void> {
  const phone = getContactPhone(event);
  const messageId = getMessageId(event);

  // Sin teléfono (BSUID: Meta ya no siempre lo manda) o sin id no hay forma de
  // procesar de manera idempotente. Se registra para poder verlo y se sigue.
  if (!phone || !messageId) {
    await logEvent("inbox_indeterminate", {
      provider: "kapso",
      reason: !phone ? "no-phone" : "no-message-id",
      messageId,
    });
    return;
  }

  const receivedAt = Date.now();

  // Kapso transcribe las notas de voz por su cuenta y manda el texto en el webhook.
  // Guardarlo como `content` hace que `gatherPendingContent` NO llame a Whisper (solo
  // transcribe si el content está vacío): sale gratis y sin tocar el cerebro. Ver ADR-0057.
  const text = getTranscript(event) ?? getText(event);

  const ingest = await ingestInboundMessage({
    phone,
    messageUuid: messageId,
    agentId,
    text,
    messageType: getMessageType(event),
    mediaUrl: getMediaUrl(event),
    contactName: getContactName(event),
    // Kapso no expone un uuid de contacto propio; la identidad es el teléfono.
    callbellContactUuid: null,
    // Se reusa la columna del href de Callbell para el id de conversación de Kapso
    // (solo trazabilidad; no se renderiza en ningún lado). Ver ADR-0056.
    conversationHref: getConversationId(event),
    raw: event,
    receivedAt,
  });

  if (!ingest.duplicate) {
    waitUntil(
      runDebouncedReply({
        conversationId: ingest.conversationId,
        contactId: ingest.contactId,
        phone,
        messageUuid: messageId,
        receivedAt,
      }),
    );
  }
}

/** Kapso puede hacer health-checks por GET. */
export async function GET() {
  return ok({ endpoint: "kapso", active: true });
}
