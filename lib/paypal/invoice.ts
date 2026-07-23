/**
 * Armado del invoice de PayPal (Invoicing v2) — lógica PURA, testeable sin I/O.
 *
 * Por qué Invoicing y no Orders v2: el link del invoice se paga SOLO (PayPal o
 * tarjeta) sin sitio de retorno ni captura server-side — en el webview de
 * WhatsApp un redirect de vuelta es frágil y sin captura la plata no entra.
 * El invoice soporta ítems con precio, impuesto (%) y envío, que es exactamente
 * lo que pide el flujo. Ver ADR-0088.
 */

import { normalizeQty } from "@/lib/agent/order";

/** Ítem de la orden tal como sale de `order_items`. */
export interface PaypalInvoiceItemInput {
  name: string | null;
  qty: number;
  unit_price: number | null;
}

export interface PaypalInvoiceInput {
  /** Marca del agente (nota del invoice + ítem de respaldo). */
  brand: string;
  /** Moneda ISO del agente (para EE.UU.: USD). */
  currency: string;
  items: PaypalInvoiceItemInput[];
  /** Total de la orden — respaldo si ningún ítem trae precio. */
  orderTotal: number | null;
  /** Impuesto (%) por ítem; 0 = sin impuesto. */
  taxPercent: number;
  /** Envío fijo; 0 = sin envío. */
  shippingAmount: number;
  /** Referencia interna (id de la orden) para conciliar en PayPal. */
  reference: string | null;
}

/** Monto como string de 2 decimales, como lo exige PayPal ("25.00"). */
export function moneyValue(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Porcentaje como string sin ceros colgantes ("7.25", "8"). */
export function percentValue(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Cuerpo del POST /v2/invoicing/invoices. Devuelve null si no hay NINGÚN monto
 * cobrable (ningún ítem con precio y sin total) — sin monto no hay link.
 *
 * Ítems sin precio se omiten (PayPal exige unit_amount); si ninguno lo trae pero
 * la orden tiene total, va un solo ítem "Pedido {marca}" por el total.
 */
export function buildInvoicePayload(input: PaypalInvoiceInput): Record<string, unknown> | null {
  const currency = (input.currency || "USD").toUpperCase();
  const tax =
    input.taxPercent > 0
      ? { name: "Tax", percent: percentValue(Math.min(100, input.taxPercent)) }
      : null;

  const priced = input.items.filter(
    (it) => it.unit_price != null && Number.isFinite(it.unit_price) && it.unit_price > 0,
  );

  let items: Array<Record<string, unknown>>;
  if (priced.length > 0) {
    items = priced.map((it) => ({
      name: (it.name ?? "").trim() || "Producto",
      quantity: String(normalizeQty(it.qty)),
      unit_amount: { currency_code: currency, value: moneyValue(it.unit_price!) },
      ...(tax ? { tax } : {}),
    }));
  } else if (input.orderTotal != null && input.orderTotal > 0) {
    items = [
      {
        name: `Pedido ${input.brand}`.trim(),
        quantity: "1",
        unit_amount: { currency_code: currency, value: moneyValue(input.orderTotal) },
        ...(tax ? { tax } : {}),
      },
    ];
  } else {
    return null;
  }

  const payload: Record<string, unknown> = {
    detail: {
      currency_code: currency,
      ...(input.reference ? { reference: input.reference.slice(0, 120) } : {}),
      note: `Pedido ${input.brand} por WhatsApp`.slice(0, 4000),
    },
    items,
  };

  if (input.shippingAmount > 0) {
    payload.amount = {
      breakdown: {
        shipping: { amount: { currency_code: currency, value: moneyValue(input.shippingAmount) } },
      },
    };
  }

  return payload;
}
