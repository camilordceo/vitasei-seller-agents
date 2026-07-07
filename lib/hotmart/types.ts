/**
 * Tipos para la integración con Hotmart (carritos abandonados).
 * Basado en: https://developers.hotmart.com/docs/en/2.0.0/webhook/cart-abandonment-webhook/
 * Ver: docs/17-hotmart-carritos.md, ADR-0035
 */

/**
 * Payload del webhook de Hotmart para el evento PURCHASE_OUT_OF_SHOPPING_CART.
 */
export interface HotmartWebhookPayload {
  /** UUID único del evento (idempotencia). */
  id: string;
  /** Timestamp de creación del evento (epoch ms). */
  creation_date: number;
  /** Tipo de evento. */
  event: HotmartEventType;
  /** Versión del webhook (2.0.0). */
  version: string;
  /** Datos del evento. */
  data: HotmartEventData;
}

export type HotmartEventType =
  | "PURCHASE_OUT_OF_SHOPPING_CART" // Carrito abandonado
  | "PURCHASE_COMPLETE"             // Compra completada (futuro)
  | "PURCHASE_CANCELED"             // Compra cancelada (futuro)
  | "PURCHASE_REFUNDED"             // Reembolso (futuro)
  | "PURCHASE_CHARGEBACK";          // Contracargo (futuro)

export interface HotmartEventData {
  /** ¿Venta de afiliado? */
  affiliate?: boolean;
  /** Información del producto. */
  product: HotmartProduct;
  /** Información del comprador. */
  buyer: HotmartBuyer;
  /** Información de la oferta. */
  offer?: HotmartOffer;
  /** País del checkout. */
  checkout_country?: HotmartCountry;
  /** IP del comprador. */
  buyer_ip?: string;
}

export interface HotmartProduct {
  /** ID del producto en Hotmart. */
  id: number;
  /** Nombre del producto. */
  name: string;
}

export interface HotmartBuyer {
  /** Nombre del comprador. */
  name: string;
  /** Email del comprador. */
  email: string;
  /** Teléfono del comprador (puede venir con o sin '+'). */
  phone?: string;
}

export interface HotmartOffer {
  /** Código de la oferta. */
  code: string;
}

export interface HotmartCountry {
  /** Nombre del país. */
  name: string;
  /** Código ISO del país (ej: "CO", "BR"). */
  iso: string;
}

/**
 * Valida si el payload es un evento de carrito abandonado válido.
 */
export function isCartAbandonmentEvent(payload: unknown): payload is HotmartWebhookPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    p.event === "PURCHASE_OUT_OF_SHOPPING_CART" &&
    typeof p.data === "object" &&
    p.data !== null
  );
}

/**
 * Extrae el teléfono del comprador del payload de Hotmart.
 * Devuelve null si no hay teléfono o es inválido.
 */
export function extractBuyerPhone(payload: HotmartWebhookPayload): string | null {
  const phone = payload.data?.buyer?.phone;
  if (!phone || typeof phone !== "string") return null;
  // Limpiar: quitar +, espacios, guiones, paréntesis
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  // Validar: debe ser solo dígitos y tener al menos 10 caracteres
  if (!/^\d{10,15}$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Extrae la información relevante del payload para el procesamiento.
 */
export interface ExtractedCartData {
  eventId: string;
  phone: string;
  email: string | null;
  buyerName: string | null;
  productId: string | null;
  productName: string | null;
  offerCode: string | null;
  country: string | null;
}

export function extractCartData(payload: HotmartWebhookPayload): ExtractedCartData | null {
  const phone = extractBuyerPhone(payload);
  if (!phone) return null;

  return {
    eventId: payload.id,
    phone,
    email: payload.data.buyer?.email || null,
    buyerName: payload.data.buyer?.name || null,
    productId: payload.data.product?.id?.toString() || null,
    productName: payload.data.product?.name || null,
    offerCode: payload.data.offer?.code || null,
    country: payload.data.checkout_country?.iso || null,
  };
}
