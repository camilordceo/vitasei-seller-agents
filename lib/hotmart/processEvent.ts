import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { sendTemplate, type CallbellCreds } from "@/lib/callbell/sender";
import { loadAgent, agentCallbellCreds } from "@/lib/agent/agents";
import type { Database, Json } from "@/lib/supabase/types";
import type { HotmartWebhookPayload, ExtractedCartData } from "./types";
import { extractCartData, isCartAbandonmentEvent } from "./types";
import { env } from "@/lib/env";

type DB = SupabaseClient<Database>;

export interface ProcessResult {
  success: boolean;
  /** Si el evento ya fue procesado antes (idempotencia). */
  duplicate: boolean;
  /** ID de la conversación creada/actualizada. */
  conversationId: string | null;
  /** Si el mensaje se envió exitosamente. */
  messageSent: boolean;
  /** Error si algo falló. */
  error: string | null;
}

/**
 * Procesa un evento de carrito abandonado de Hotmart.
 *
 * 1. Valida y extrae los datos del payload.
 * 2. Verifica idempotencia (¿ya procesamos este evento?).
 * 3. Get-or-create del contacto.
 * 4. Get-or-create de la conversación (con source='hotmart').
 * 5. Envía la plantilla de WhatsApp vía Callbell.
 * 6. Guarda el evento y el mensaje en Supabase.
 *
 * Ver: docs/17-hotmart-carritos.md, ADR-0035
 */
export async function processHotmartCartAbandonment(
  payload: unknown,
): Promise<ProcessResult> {
  // 1) Validar que sea un evento de carrito abandonado
  if (!isCartAbandonmentEvent(payload)) {
    return {
      success: false,
      duplicate: false,
      conversationId: null,
      messageSent: false,
      error: "Invalid or unsupported event type",
    };
  }

  // 2) Extraer datos relevantes
  const data = extractCartData(payload);
  if (!data) {
    return {
      success: false,
      duplicate: false,
      conversationId: null,
      messageSent: false,
      error: "Missing or invalid buyer phone",
    };
  }

  const supabase = createServiceClient();

  // 3) Idempotencia: ¿ya procesamos este evento?
  const { data: existing, error: dupErr } = await supabase
    .from("hotmart_events")
    .select("id, conversation_id, message_sent")
    .eq("hotmart_event_id", data.eventId)
    .maybeSingle();

  if (dupErr) {
    return {
      success: false,
      duplicate: false,
      conversationId: null,
      messageSent: false,
      error: `Idempotency check failed: ${dupErr.message}`,
    };
  }

  if (existing) {
    // Ya procesado — respondemos success pero sin reenviar
    return {
      success: true,
      duplicate: true,
      conversationId: existing.conversation_id,
      messageSent: existing.message_sent,
      error: null,
    };
  }

  // 4) Resolver el agente que manejará esta conversación
  const agent = await resolveHotmartAgent(supabase);
  if (!agent) {
    return {
      success: false,
      duplicate: false,
      conversationId: null,
      messageSent: false,
      error: "No active agent configured for Hotmart",
    };
  }

  // 5) Get-or-create del contacto
  const contactId = await getOrCreateContact(supabase, data);

  // 6) Get-or-create de la conversación
  const conversationId = await getOrCreateConversation(supabase, contactId, agent.id);

  // 7) Insertar el evento de Hotmart (antes del envío para trazabilidad)
  const { data: hotmartEvent, error: insertErr } = await supabase
    .from("hotmart_events")
    .insert({
      hotmart_event_id: data.eventId,
      event_type: "PURCHASE_OUT_OF_SHOPPING_CART",
      phone: data.phone,
      email: data.email,
      buyer_name: data.buyerName,
      product_id: data.productId,
      product_name: data.productName,
      offer_code: data.offerCode,
      contact_id: contactId,
      conversation_id: conversationId,
      agent_id: agent.id,
      message_sent: false,
      raw_payload: payload as unknown as Json,
    })
    .select("id")
    .single();

  if (insertErr) {
    return {
      success: false,
      duplicate: false,
      conversationId,
      messageSent: false,
      error: `Failed to save hotmart event: ${insertErr.message}`,
    };
  }

  // 8) Enviar la plantilla de WhatsApp
  const templateUuid = env.HOTMART_ABANDONED_CART_TEMPLATE_UUID;
  if (!templateUuid) {
    await supabase
      .from("hotmart_events")
      .update({ send_error: "HOTMART_ABANDONED_CART_TEMPLATE_UUID not configured" })
      .eq("id", hotmartEvent.id);

    return {
      success: true, // El evento se guardó, solo falta el template
      duplicate: false,
      conversationId,
      messageSent: false,
      error: "Template UUID not configured",
    };
  }

  const creds = agentCallbellCreds(agent);
  const sendResult = await sendHotmartTemplate(
    supabase,
    creds,
    conversationId,
    data,
    templateUuid,
  );

  // 9) Actualizar el evento con el resultado del envío
  await supabase
    .from("hotmart_events")
    .update({
      message_sent: sendResult.success,
      message_uuid: sendResult.messageUuid,
      send_error: sendResult.error,
    })
    .eq("id", hotmartEvent.id);

  // 10) Log del evento
  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "hotmart_cart_abandoned",
    payload: {
      hotmartEventId: data.eventId,
      productName: data.productName,
      messageSent: sendResult.success,
      error: sendResult.error,
    } as unknown as Json,
  });

  return {
    success: true,
    duplicate: false,
    conversationId,
    messageSent: sendResult.success,
    error: sendResult.error,
  };
}

/**
 * Resuelve qué agente debe manejar los eventos de Hotmart.
 * Orden de prioridad:
 * 1. HOTMART_AGENT_ID (env) — agente específico para Hotmart.
 * 2. Primer agente activo en la base de datos.
 */
async function resolveHotmartAgent(supabase: DB) {
  const agentId = env.HOTMART_AGENT_ID;

  if (agentId) {
    return loadAgent(supabase, agentId);
  }

  // Fallback: primer agente activo
  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data;
}

/**
 * Obtiene o crea un contacto por teléfono.
 */
async function getOrCreateContact(supabase: DB, data: ExtractedCartData): Promise<string> {
  const { data: existing, error: selErr } = await supabase
    .from("contacts")
    .select("id")
    .eq("phone", data.phone)
    .maybeSingle();

  if (selErr) throw new Error(`Contact lookup failed: ${selErr.message}`);

  if (existing) {
    // Actualizar nombre si lo tenemos y no lo tenía
    if (data.buyerName) {
      await supabase
        .from("contacts")
        .update({ name: data.buyerName })
        .eq("id", existing.id)
        .is("name", null);
    }
    return existing.id;
  }

  const { data: inserted, error: insErr } = await supabase
    .from("contacts")
    .insert({
      phone: data.phone,
      name: data.buyerName,
    })
    .select("id")
    .single();

  if (insErr) throw new Error(`Contact insert failed: ${insErr.message}`);
  return inserted.id;
}

/**
 * Obtiene la conversación activa del contacto o crea una nueva con source='hotmart'.
 */
async function getOrCreateConversation(
  supabase: DB,
  contactId: string,
  agentId: string,
): Promise<string> {
  // Buscar conversación activa para este contacto y agente
  const { data: existing, error: selErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .eq("agent_id", agentId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selErr) throw new Error(`Conversation lookup failed: ${selErr.message}`);

  if (existing) {
    return existing.id;
  }

  // Crear nueva conversación con source='hotmart'
  const { data: inserted, error: insErr } = await supabase
    .from("conversations")
    .insert({
      contact_id: contactId,
      agent_id: agentId,
      status: "active",
      source: "hotmart",
    })
    .select("id")
    .single();

  if (insErr) throw new Error(`Conversation insert failed: ${insErr.message}`);
  return inserted.id;
}

interface SendTemplateResult {
  success: boolean;
  messageUuid: string | null;
  error: string | null;
}

/**
 * Envía la plantilla de WhatsApp para carrito abandonado.
 * Guarda el mensaje outbound en `messages`.
 */
async function sendHotmartTemplate(
  supabase: DB,
  creds: CallbellCreds,
  conversationId: string,
  data: ExtractedCartData,
  templateUuid: string,
): Promise<SendTemplateResult> {
  try {
    // Variables de la plantilla: {{1}} = nombre, {{2}} = producto
    const templateValues = [
      data.buyerName || "Hola",
      data.productName || "tu producto",
    ];

    const sent = await sendTemplate(creds, data.phone, templateUuid, {
      templateValues,
      metadata: { conversation_id: conversationId, source: "hotmart" },
    });

    // Guardar el mensaje outbound
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      direction: "outbound",
      role: "assistant",
      type: "text",
      content: `[Plantilla Hotmart: ${data.productName || "Carrito abandonado"}]`,
      tags: ["hotmart-recovery"] as unknown as Json,
      callbell_message_uuid: sent.uuid,
    });

    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "hotmart_template_sent",
      payload: {
        templateUuid,
        phone: data.phone,
        productName: data.productName,
        uuid: sent.uuid,
        status: sent.status,
      } as unknown as Json,
    });

    return {
      success: true,
      messageUuid: sent.uuid,
      error: null,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[sendHotmartTemplate] failed:", error);

    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "hotmart_template_failed",
      payload: {
        templateUuid,
        phone: data.phone,
        error,
      } as unknown as Json,
    });

    return {
      success: false,
      messageUuid: null,
      error,
    };
  }
}
