import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { sendTemplate, type CallbellCreds } from "@/lib/callbell/sender";
import { loadAgent, agentCallbellCreds, findHotmartAgentId } from "@/lib/agent/agents";
import type { Database, Json } from "@/lib/supabase/types";
import type { HotmartWebhookPayload, ExtractedCartData } from "./types";
import { extractCartData, isCartAbandonmentEvent } from "./types";
import {
  resolveHotmartTemplate,
  renderHotmartMessage,
  extractTemplateValues,
  DEFAULT_HOTMART_EVENT,
} from "./templates";
import { HOTMART_RECOVERY_TAG } from "./context";
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

  // 6.1) Marcar la conversación como "flujo hotmart". Es el rastro autoritativo y
  //      la compuerta para inyectar "Es flujo hotmart" cuando el cliente responda.
  //      Aplica a conversaciones NUEVAS y EXISTENTES (a diferencia de `source`, que
  //      solo se fija al crear). Best-effort y resiliente a que falte la columna.
  await markHotmartFlow(supabase, conversationId);

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

  // 8) Resolver la plantilla: primero el dashboard (`hotmart_templates`) y, si no
  //    hay, la env como fallback (retrocompatibilidad). El texto sale de la
  //    plantilla del dashboard con {{nombre}}/{{producto}} ya interpolados.
  const tpl = await resolveHotmartTemplate(supabase, {
    agentId: agent.id,
    eventType: DEFAULT_HOTMART_EVENT,
    productId: data.productId,
  });
  const templateUuid = tpl?.template_uuid ?? env.HOTMART_ABANDONED_CART_TEMPLATE_UUID ?? null;
  const messageText = renderHotmartMessage(tpl?.message_text, {
    name: data.buyerName,
    product: data.productName,
  });
  // Variables de la plantilla: se derivan de los tokens {{nombre}}/{{producto}} del
  // texto configurado en el dashboard. Plantilla de SOLO TEXTO → sin variables (no
  // falla por "parámetros de más"). Sin plantilla del dashboard (fallback por env,
  // legado), se mantienen los 2 valores de antes. Ver ADR-0040.
  const templateValues = tpl
    ? extractTemplateValues(tpl.message_text, { name: data.buyerName, product: data.productName })
    : [data.buyerName || "Hola", data.productName || "tu producto"];

  // Rastro de QUÉ plantilla ganó para ESTE curso. Con varios cursos en Hotmart es la
  // forma de ver, desde el dashboard, si el `product.id` del webhook casó con una
  // plantilla propia de ese curso o si cayó en la genérica / el fallback por env (que
  // mandaría el mensaje de otro curso). Ver ADR-0051.
  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "hotmart_template_resolved",
    payload: {
      productId: data.productId,
      productName: data.productName,
      templateId: tpl?.id ?? null,
      templateName: tpl?.name ?? null,
      // true = plantilla propia de ESTE curso; false = genérica (aplica a todos).
      matchedProduct: tpl != null && tpl.product_id === data.productId,
      // true = no había plantilla en el dashboard; se usó HOTMART_ABANDONED_CART_TEMPLATE_UUID.
      fallbackEnv: tpl == null,
    } as unknown as Json,
  });

  if (!templateUuid) {
    await supabase
      .from("hotmart_events")
      .update({ send_error: "No hay plantilla configurada (dashboard ni env)" })
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
    messageText,
    templateValues,
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
 * Orden de prioridad (ver ADR-0041):
 * 1. Agente marcado en el dashboard (`hotmart_enabled`) — autoritativo.
 * 2. `HOTMART_AGENT_ID` (env) — override legado.
 * 3. Primer agente activo en la base de datos (último recurso).
 */
async function resolveHotmartAgent(supabase: DB) {
  // 1) Agente designado desde el dashboard. Resiliente a que falte la columna.
  const flaggedId = await findHotmartAgentId(supabase);
  if (flaggedId) {
    const agent = await loadAgent(supabase, flaggedId);
    if (agent) return agent;
  }

  // 2) Env (fallback legado).
  const agentId = env.HOTMART_AGENT_ID;
  if (agentId) {
    const agent = await loadAgent(supabase, agentId);
    if (agent) return agent;
  }

  // 3) Fallback: primer agente activo.
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

/**
 * Marca la conversación como `hotmart_flow = true`. Best-effort: si la columna aún
 * no existe (42703, falta la migración 0019) o falla, se ignora — el rastro es un
 * plus y NUNCA debe tumbar el envío de la plantilla. Ver ADR-0040.
 */
async function markHotmartFlow(supabase: DB, conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ hotmart_flow: true })
    .eq("id", conversationId);
  if (error && error.code !== "42703") {
    console.error("[markHotmartFlow] update failed:", error.message);
  }
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
  /** Texto de la plantilla del dashboard, ya interpolado ({{nombre}}/{{producto}}). */
  messageText: string,
  /** Valores de las variables de la plantilla (derivados del texto; [] = solo texto). */
  templateValues: string[],
): Promise<SendTemplateResult> {
  try {
    // Texto que se muestra/guarda en el hilo: el de la plantilla del dashboard (ya
    // interpolado) o, si está vacío, una nota con el producto (comportamiento previo).
    const storedText =
      messageText.trim().length > 0
        ? messageText
        : `[Plantilla Hotmart: ${data.productName || "Carrito abandonado"}]`;

    const sent = await sendTemplate(creds, data.phone, templateUuid, {
      text: messageText.trim().length > 0 ? messageText : undefined,
      templateValues,
      metadata: { conversation_id: conversationId, source: "hotmart" },
    });

    // Guardar el mensaje outbound. El tag `hotmart-recovery` no es decorativo: es la
    // señal que `loadHotmartReplyContext` usa para saber que esta plantilla se envió
    // FUERA de la cadena de Responses y hay que dársela a la IA como contexto cuando
    // el cliente responda. Ver ADR-0051.
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      direction: "outbound",
      role: "assistant",
      type: "text",
      content: storedText,
      tags: [HOTMART_RECOVERY_TAG] as unknown as Json,
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
