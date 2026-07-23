import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { Json } from "@/lib/supabase/types";
import type { ExtractedData } from "@/lib/synthflow/extractors";
import type { VoiceExtractor } from "@/lib/synthflow/types";
import {
  agentCurrency,
  loadAgent,
  loadPaymentMethods,
  providerForAgent,
  type Agent,
} from "@/lib/agent/agents";
import { methodLabelMap } from "@/lib/agent/paymentMethods";
import {
  buildOrderDraftFromCall,
  findOutcomeExtractor,
  isSaleOutcome,
  matchPaymentText,
  readOutcome,
} from "@/lib/agent/voiceOutcome";
import { buildSaleNotification, computeOrderTotal, normalizeQty } from "@/lib/agent/order";
import { cancelScheduledRetargets } from "@/lib/agent/retarget";
import { cancelScheduledReactivations } from "@/lib/agent/reactivation";

/**
 * Cuando la llamada termina en COMPRA, la orden se genera sola. Ver ADR-0083.
 *
 * Es el mismo desenlace que ya tenía WhatsApp (`#orden-lista` → orden + aviso al
 * dueño + cancelar seguimientos), pero disparado por el **extractor de resultado**
 * de la llamada en vez de por un tag del modelo. Se reusa toda la maquinaria de
 * órdenes a propósito: una venta por teléfono tiene que verse en Órdenes y en
 * Reportes exactamente igual que una por chat, o el negocio termina con dos
 * contabilidades.
 *
 * Todo aquí es **best-effort desde el punto de vista del cierre de la llamada**:
 * si algo falla, la llamada se cierra igual con su transcripción y sus datos —
 * lo que no puede pasar es perder el registro de la llamada por un problema al
 * armar la orden.
 */

type DB = ReturnType<typeof createServiceClient>;

export interface VoiceCallOrderInput {
  voiceCallId: string;
  conversationId: string | null;
  contactId: string | null;
  agentId: string | null;
  phone: string;
  /** Nombre que traía la campaña, si la llamada salió de un archivo. */
  contactName: string | null;
  extracted: ExtractedData;
}

export interface VoiceCallOrderResult {
  /** Resultado crudo de la llamada (`compra`, `no interesada`…). */
  outcome: string | null;
  isSale: boolean;
  orderId: string | null;
  /** Conversación en la que quedó la orden (puede haberse creado aquí). */
  conversationId: string | null;
  contactId: string | null;
  error?: string;
}

/**
 * Lee el resultado de la llamada y, si es venta, genera la orden.
 * Devuelve siempre el `outcome` (aunque no sea venta): esa es justamente la
 * columna que faltaba para enterarse de algo sin abrir la llamada.
 */
export async function applyVoiceCallOutcome(
  supabase: DB,
  input: VoiceCallOrderInput,
  extractors: ReadonlyArray<VoiceExtractor>,
): Promise<VoiceCallOrderResult> {
  const base: VoiceCallOrderResult = {
    outcome: null,
    isSale: false,
    orderId: null,
    conversationId: input.conversationId,
    contactId: input.contactId,
  };

  const outcomeExtractor = findOutcomeExtractor(extractors);
  const outcome = readOutcome(input.extracted, outcomeExtractor);
  base.outcome = outcome;
  if (!outcome || !isSaleOutcome(outcome, outcomeExtractor?.saleValues)) return base;
  base.isSale = true;

  if (!input.agentId) {
    base.error = "La llamada no tiene agente: no se puede generar la orden.";
    return base;
  }
  const agent = await loadAgent(supabase, input.agentId);
  if (!agent) {
    base.error = "No se encontró el agente de la llamada.";
    return base;
  }

  // 1) Contacto y conversación. En una campaña el número es frío: la
  //    conversación se crea AHORA, que es cuando por fin significa algo.
  const contactId = input.contactId ?? (await ensureContact(supabase, input.phone, input.contactName));
  const conversationId =
    input.conversationId ?? (await ensureConversation(supabase, contactId, agent.id));
  base.contactId = contactId;
  base.conversationId = conversationId;

  // 2) ¿Ya hay una orden viva en esa conversación? No se duplica ni se re-avisa
  //    (misma regla que el flujo de WhatsApp, ADR-0059).
  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("conversation_id", conversationId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    base.orderId = (existing as { id: string }).id;
    return base;
  }

  // 3) Los datos extraídos, mapeados a campos de orden.
  const { draft, paymentText, productText } = buildOrderDraftFromCall(extractors, input.extracted);
  const methods = await loadPaymentMethods(supabase, agent.id);
  const method = matchPaymentText(paymentText, methods) ?? "undecided";

  // El SKU no se inventa: se busca el producto del agente por nombre y, si no
  // aparece, la orden queda sin ítem y el producto dicho va en las notas.
  const product = productText ? await findProductByName(supabase, agent.id, productText) : null;
  if (product && draft.items.length > 0) {
    draft.items[0] = {
      sku: product.sku,
      name: product.name,
      qty: normalizeQty(draft.items[0].qty),
      unit_price: product.price,
    };
  }
  const total = computeOrderTotal(draft.items);
  draft.total = total;

  const notes = [
    "Orden generada por una llamada con IA.",
    productText && !product ? `Producto dicho en la llamada: ${productText}` : null,
    paymentText && method === "undecided" ? `Pago dicho en la llamada: ${paymentText}` : null,
    draft.notes,
  ]
    .filter(Boolean)
    .join(" · ");
  draft.notes = notes;

  // 4) La orden.
  const { data: order, error: ordErr } = await supabase
    .from("orders")
    .insert({
      conversation_id: conversationId,
      contact_id: contactId,
      status: "pending_handoff",
      fulfillment_method: method,
      shipping_name: draft.shipping.name ?? input.contactName,
      shipping_address: draft.shipping.address,
      shipping_city: draft.shipping.city,
      shipping_phone: draft.shipping.phone ?? input.phone,
      notes: draft.notes,
      total,
      currency: agentCurrency(agent),
    })
    .select("id")
    .single();
  if (ordErr) {
    base.error = `No se pudo crear la orden: ${ordErr.message}`;
    return base;
  }
  base.orderId = order.id;

  if (draft.items.length > 0 && draft.items[0].sku) {
    const { error: itErr } = await supabase.from("order_items").insert(
      draft.items.map((it) => ({
        order_id: order.id,
        sku: it.sku as string,
        name: it.name,
        qty: normalizeQty(it.qty),
        unit_price: it.unit_price,
      })),
    );
    if (itErr) console.error("[applyVoiceCallOutcome] order_items:", itErr.message);
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "order_created",
    payload: {
      orderId: order.id,
      method,
      items: draft.items.length,
      total,
      // Marca de origen: en Reportes una venta por teléfono se debe poder aislar.
      source: "voice_call",
      voiceCallId: input.voiceCallId,
      outcome,
    } as unknown as Json,
  });

  // 5) Compró: sobran los seguimientos, las reactivaciones y las llamadas que
  //    quedaran programadas para esa conversación.
  await quietly(() => cancelScheduledRetargets(supabase, conversationId, "converted"));
  await quietly(() => cancelScheduledReactivations(supabase, conversationId, "converted"));
  await quietly(async () => {
    await supabase
      .from("voice_calls")
      .update({ status: "cancelled", error: "converted" })
      .eq("conversation_id", conversationId)
      .eq("status", "scheduled");
  });

  // 6) Aviso al dueño por WhatsApp, igual que una venta por chat.
  await notifyOwner(supabase, agent, {
    conversationId,
    clientPhone: input.phone,
    orderId: order.id,
    method,
    methodLabel: methodLabelMap(methods)[method] ?? null,
    total,
    draft,
    outcome,
  });

  return base;
}

// --- Piezas -----------------------------------------------------------------

/** Contacto por teléfono: el que ya existe o uno nuevo. */
async function ensureContact(
  supabase: DB,
  phone: string,
  name: string | null,
): Promise<string> {
  const { data: existing } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("phone", phone)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const row = existing as { id: string; name: string | null };
    if (name && !row.name) {
      await supabase.from("contacts").update({ name }).eq("id", row.id);
    }
    return row.id;
  }
  const { data: inserted, error } = await supabase
    .from("contacts")
    .insert({ phone, name })
    .select("id")
    .single();
  if (error) throw new Error(`ensureContact: ${error.message}`);
  return inserted.id;
}

/**
 * Conversación del contacto con ese agente: la activa, o una nueva con
 * `source = 'voice'`. Solo se llega aquí cuando hubo VENTA — un número frío que
 * no compró no deja conversación, para no inflar los chats de los reportes ni
 * el ROAS (ver ADR-0084).
 */
async function ensureConversation(supabase: DB, contactId: string, agentId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data: inserted, error } = await supabase
    .from("conversations")
    .insert({ contact_id: contactId, agent_id: agentId, status: "active", source: "voice" })
    .select("id")
    .single();
  if (error) throw new Error(`ensureConversation: ${error.message}`);
  return inserted.id;
}

/** Quita tildes y baja a minúsculas. */
function deburr(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Producto del agente que mejor casa con lo que el cliente dijo por teléfono.
 * Se busca por contención en ambos sentidos ("colageno" ↔ "Colágeno hidrolizado
 * x 300g") y gana el nombre más corto que contenga lo dicho. Si no hay una
 * coincidencia clara devuelve null: **una orden sin SKU es honesta; una con el
 * SKU equivocado es un despacho equivocado.**
 */
async function findProductByName(
  supabase: DB,
  agentId: string,
  text: string,
): Promise<{ sku: string; name: string; price: number | null } | null> {
  const target = deburr(text);
  if (target.length < 3) return null;

  const { data, error } = await supabase
    .from("products")
    .select("sku, name, price")
    .eq("agent_id", agentId)
    .limit(500);
  if (error || !data) return null;

  const rows = data as unknown as Array<{ sku: string; name: string; price: number | null }>;
  let best: { sku: string; name: string; price: number | null } | null = null;
  for (const row of rows) {
    const name = deburr(row.name ?? "");
    if (!name) continue;
    if (name === target) return row;
    if (name.includes(target) || target.includes(name)) {
      if (!best || row.name.length < best.name.length) best = row;
    }
  }
  return best;
}

/** Aviso de venta al dueño por WhatsApp. Nunca rompe el cierre de la llamada. */
async function notifyOwner(
  supabase: DB,
  agent: Agent,
  info: {
    conversationId: string;
    clientPhone: string;
    orderId: string;
    method: string;
    methodLabel: string | null;
    total: number | null;
    draft: Parameters<typeof buildSaleNotification>[0]["draft"];
    outcome: string;
  },
): Promise<void> {
  const ownerPhone = env.SALES_NOTIFY_PHONE;
  if (!ownerPhone) return;
  try {
    const text = `${buildSaleNotification({
      clientPhone: info.clientPhone,
      method: info.method,
      methodLabel: info.methodLabel,
      brand: agent.brand ?? agent.name,
      total: info.total,
      draft: info.draft,
    })}\n\nOrigen: llamada con IA (${info.outcome}).`;

    const sent = await providerForAgent(agent).sendText(ownerPhone, text, {
      metadata: { conversation_id: info.conversationId, sales_notification: true },
    });
    await supabase.from("events_log").insert({
      conversation_id: info.conversationId,
      type: "sales_notification_sent",
      payload: {
        ownerPhone,
        orderId: info.orderId,
        uuid: sent.uuid,
        source: "voice_call",
      } as unknown as Json,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[voiceOrder.notifyOwner] falló:", message);
    await quietly(async () => {
      await supabase.from("events_log").insert({
        conversation_id: info.conversationId,
        type: "sales_notification_failed",
        payload: { ownerPhone, orderId: info.orderId, error: message } as unknown as Json,
      });
    });
  }
}

/** Ejecuta y se traga el error (con log). Para los pasos accesorios. */
async function quietly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error("[voiceOrder] paso accesorio falló:", e instanceof Error ? e.message : String(e));
  }
}
