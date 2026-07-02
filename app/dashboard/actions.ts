"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { cancelScheduledRetargets } from "@/lib/agent/retarget";
import { computeOrderTotal, normalizeQty } from "@/lib/agent/order";
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
