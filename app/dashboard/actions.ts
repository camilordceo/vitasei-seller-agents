"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { cancelScheduledRetargets } from "@/lib/agent/retarget";
import { computeOrderTotal, normalizeQty } from "@/lib/agent/order";
import { sendText } from "@/lib/callbell/sender";
import type { Json } from "@/lib/supabase/types";
import type { OrderEditInput } from "./orders/types";

/**
 * Server Actions del dashboard.
 *
 * Corren server-side con el cliente service-role (nunca llega al browser) y
 * quedan protegidas por el Basic Auth del dashboard (middleware). Ver docs/11.
 */

/**
 * Pasa una conversación a modo manual (IA en silencio) o la reactiva. Al pausar,
 * cancela también los retargets pendientes (no queremos nudges mientras un humano
 * la atiende). Loguea `manual_on`/`manual_off` para auditoría.
 */
export async function setConversationManual(
  conversationId: string,
  paused: boolean,
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("conversations")
    .update({ ai_paused: paused })
    .eq("id", conversationId);
  if (error) throw new Error(`setConversationManual: ${error.message}`);

  if (paused) {
    // Best-effort: si falla el cancel, el worker igual descarta por `manual-mode`.
    try {
      await cancelScheduledRetargets(supabase, conversationId, "manual-mode");
    } catch {
      // no-op
    }
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: paused ? "manual_on" : "manual_off",
    payload: {} as unknown as Json,
  });

  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard");
}

/** Convierte un texto de formulario a string limpio o null si queda vacío. */
function textOrNull(v: string): string | null {
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Edita una orden: corrige la cabecera (estado, método, envío, notas, total) y
 * REEMPLAZA sus ítems por los enviados. Sirve para arreglar lo que la IA marcó
 * mal al cerrar la venta. Corre server-side con service-role (protegida por el
 * Basic Auth del dashboard). Loguea `order_edited` para auditoría. Ver docs/12.
 */
export async function saveOrder(orderId: string, input: OrderEditInput): Promise<void> {
  const supabase = createServiceClient();

  // Necesitamos la conversación para revalidar su detalle y anclar el evento.
  const { data: existing, error: findErr } = await supabase
    .from("orders")
    .select("conversation_id")
    .eq("id", orderId)
    .maybeSingle();
  if (findErr) throw new Error(`saveOrder find: ${findErr.message}`);
  if (!existing) throw new Error("saveOrder: la orden no existe");
  const conversationId = existing.conversation_id;

  // Normalizar ítems: descartar filas vacías (sin sku ni nombre); qty entero >= 1.
  const items = input.items
    .map((it) => ({
      sku: it.sku.trim(),
      name: textOrNull(it.name),
      qty: normalizeQty(it.qty),
      unit_price:
        it.unitPrice != null && Number.isFinite(it.unitPrice) ? Number(it.unitPrice) : null,
    }))
    .filter((it) => it.sku.length > 0 || it.name != null);

  const total = input.recomputeTotal
    ? computeOrderTotal(items)
    : input.total != null && Number.isFinite(input.total)
      ? Number(input.total)
      : null;

  // 1) Cabecera.
  const { error: updErr } = await supabase
    .from("orders")
    .update({
      status: input.status,
      fulfillment_method: input.method,
      shipping_name: textOrNull(input.shippingName),
      shipping_address: textOrNull(input.shippingAddress),
      shipping_city: textOrNull(input.shippingCity),
      shipping_phone: textOrNull(input.shippingPhone),
      notes: textOrNull(input.notes),
      total,
    })
    .eq("id", orderId);
  if (updErr) throw new Error(`saveOrder update: ${updErr.message}`);

  // 2) Reemplazar ítems (borrar + insertar). Volumen bajo; sin transacción cross-statement.
  const { error: delErr } = await supabase.from("order_items").delete().eq("order_id", orderId);
  if (delErr) throw new Error(`saveOrder delete items: ${delErr.message}`);

  if (items.length > 0) {
    const rows = items.map((it) => ({ order_id: orderId, ...it }));
    const { error: insErr } = await supabase.from("order_items").insert(rows);
    if (insErr) throw new Error(`saveOrder insert items: ${insErr.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "order_edited",
    payload: {
      orderId,
      status: input.status,
      method: input.method,
      items: items.length,
      total,
      source: "dashboard",
    } as unknown as Json,
  });

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/conversations/${conversationId}`);
}

/**
 * Actualiza la config del feature de reactivaciones (fila única `app_settings`):
 * el ON/OFF global y los UUID de plantilla (día 7 y día 15), editables desde el
 * dashboard. Service-role, protegida por el Basic Auth. Ver docs/14, ADR-0021.
 */
export async function updateReactivationSettings(input: {
  enabled: boolean;
  template7d: string;
  template15d: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const clean = (s: string): string | null => {
    const t = s.trim();
    return t.length > 0 ? t : null;
  };

  const { error } = await supabase
    .from("app_settings")
    .update({
      reactivation_enabled: input.enabled,
      reactivation_template_7d: clean(input.template7d),
      reactivation_template_15d: clean(input.template15d),
    })
    .eq("id", 1);
  if (error) throw new Error(`updateReactivationSettings: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "reactivation_settings_updated",
    payload: {
      enabled: input.enabled,
      has7d: clean(input.template7d) != null,
      has15d: clean(input.template15d) != null,
    } as unknown as Json,
  });

  revalidatePath("/dashboard/retargets");
  revalidatePath("/dashboard");
}

/**
 * Envía un mensaje manual escrito por un operador al cliente por WhatsApp
 * (Callbell). Guarda el outbound marcado `manual` (para distinguirlo del bot) y
 * loguea `manual_message_sent`. No alimenta el contexto de la IA
 * (`previous_response_id`): es una intervención humana fuera de banda. Corre
 * server-side con service-role, protegida por el Basic Auth. Ver docs/13, ADR-0020.
 */
export async function sendManualMessage(conversationId: string, text: string): Promise<void> {
  const clean = text.trim();
  if (clean.length === 0) throw new Error("El mensaje está vacío.");

  const supabase = createServiceClient();

  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convoErr) throw new Error(`sendManualMessage convo: ${convoErr.message}`);
  if (!convo) throw new Error("La conversación no existe.");

  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", convo.contact_id)
    .maybeSingle();
  if (contactErr) throw new Error(`sendManualMessage contact: ${contactErr.message}`);
  if (!contact?.phone) throw new Error("El contacto no tiene teléfono.");

  // Enviar por Callbell (lanza si la API responde error, p. ej. fuera de la ventana 24h).
  const sent = await sendText(contact.phone, clean, {
    metadata: { conversation_id: conversationId, source: "dashboard-manual" },
  });

  const { error: msgErr } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    role: "assistant",
    type: "text",
    content: clean,
    tags: ["manual"] as unknown as Json,
    callbell_message_uuid: sent.uuid,
  });
  if (msgErr) throw new Error(`sendManualMessage save: ${msgErr.message}`);

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "manual_message_sent",
    payload: { uuid: sent.uuid, status: sent.status, chars: clean.length } as unknown as Json,
  });

  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard");
}
