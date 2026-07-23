import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingProvider } from "@/lib/messaging/types";
import { buildPaypalMessage, type PaypalAgentConfig } from "@/lib/paypal/config";
import { buildInvoicePayload } from "@/lib/paypal/invoice";
import { createInvoiceLink } from "@/lib/paypal/client";
import type { Database, Json } from "@/lib/supabase/types";

type DB = SupabaseClient<Database>;

/**
 * Link de pago de PayPal por WhatsApp (ADR-0088). Cuando el cierre es con el
 * método `paypal` y hay orden, genera el invoice (Invoicing v2) con los ítems de
 * la orden + tax/envío de la config del agente, y manda el link junto al mensaje
 * configurado. Best-effort: cualquier fallo se loguea y NUNCA rompe la respuesta
 * (la venta quedó registrada; el operador puede mandar el link a mano como antes).
 *
 * Idempotencia por `orders.payment_link`: la misma orden nunca genera dos
 * invoices; si el modelo vuelve a emitir `#paypal` ("mándame el link otra vez"),
 * se REENVÍA el mismo link.
 */
export async function sendPaypalLinkForOrder(
  supabase: DB,
  messaging: MessagingProvider,
  args: {
    conversationId: string;
    orderId: string;
    phone: string;
    /** Marca del agente (nota del invoice + ítem de respaldo). */
    brand: string;
    /** Moneda de venta del agente (la de la orden; EE.UU. = USD). */
    currency: string;
    config: PaypalAgentConfig;
  },
): Promise<void> {
  const { conversationId, orderId, phone, brand, currency, config } = args;

  const logEvent = async (type: string, payload: Record<string, unknown>): Promise<void> => {
    await supabase
      .from("events_log")
      .insert({ conversation_id: conversationId, type, payload: payload as unknown as Json })
      .then(
        () => undefined,
        () => undefined,
      );
  };

  try {
    // Orden + link previo (idempotencia). Si falta la migración 0034 en orders
    // (42703), no hay dónde anclar el link: se registra y se sale.
    const { data: order, error: ordErr } = await supabase
      .from("orders")
      .select("id, total, currency, payment_link, payment_link_id")
      .eq("id", orderId)
      .maybeSingle();
    if (ordErr || !order) {
      await logEvent("paypal_link_skipped", {
        orderId,
        reason: ordErr?.code === "42703" ? "missing-migration-0034" : "order-not-found",
        error: ordErr?.message ?? null,
      });
      return;
    }

    // ¿Ya hay link? Reenvía el MISMO (no crear otro invoice por la misma venta).
    if (order.payment_link) {
      const text = buildPaypalMessage(config.message, order.payment_link);
      const sent = await messaging.sendText(phone, text, {
        metadata: { conversation_id: conversationId, paypal_link: true },
      });
      await saveOutboundText(supabase, conversationId, text, sent.uuid);
      await logEvent("paypal_link_resent", {
        orderId,
        invoiceId: order.payment_link_id,
        uuid: sent.uuid,
      });
      return;
    }

    // Ítems de la orden → cuerpo del invoice (tax/envío de la config del agente).
    const { data: items, error: itErr } = await supabase
      .from("order_items")
      .select("name, qty, unit_price")
      .eq("order_id", orderId);
    if (itErr) {
      await logEvent("paypal_link_failed", { orderId, step: "load-items", error: itErr.message });
      return;
    }

    const payload = buildInvoicePayload({
      brand,
      currency: order.currency || currency,
      items: items ?? [],
      orderTotal: order.total,
      taxPercent: config.taxPercent,
      shippingAmount: config.shippingAmount,
      reference: orderId,
    });
    if (!payload) {
      // Sin ningún monto cobrable (extracción sin precios): no hay link posible.
      // La venta quedó registrada; el aviso al dueño ya salió — que lo mande a mano.
      await logEvent("paypal_link_skipped", { orderId, reason: "no-amount" });
      return;
    }

    const { invoiceId, url } = await createInvoiceLink(
      { clientId: config.clientId, clientSecret: config.clientSecret, sandbox: config.sandbox },
      payload,
    );

    // Anclar el link a la orden ANTES de enviar: si el envío falla, el reintento
    // reenvía este mismo invoice en vez de crear otro.
    {
      const { error: updErr } = await supabase
        .from("orders")
        .update({ payment_link: url, payment_link_id: invoiceId })
        .eq("id", orderId);
      if (updErr)
        await logEvent("paypal_link_save_failed", { orderId, invoiceId, error: updErr.message });
    }

    const text = buildPaypalMessage(config.message, url);
    const sent = await messaging.sendText(phone, text, {
      metadata: { conversation_id: conversationId, paypal_link: true },
    });
    await saveOutboundText(supabase, conversationId, text, sent.uuid);
    await logEvent("paypal_link_sent", {
      orderId,
      invoiceId,
      url,
      uuid: sent.uuid,
      sandbox: config.sandbox,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[sendPaypalLinkForOrder] failed:", message);
    await logEvent("paypal_link_failed", { orderId, error: message });
  }
}

/** Guarda el mensaje del link en el hilo (para que el operador lo vea en el panel). */
async function saveOutboundText(
  supabase: DB,
  conversationId: string,
  content: string,
  uuid: string | null,
): Promise<void> {
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    role: "assistant",
    type: "text",
    content,
    tags: ["#paypal-link"] as unknown as Json,
    callbell_message_uuid: uuid,
  });
  if (error) console.error("[sendPaypalLinkForOrder] save outbound failed:", error.message);
}
