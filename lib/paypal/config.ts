/**
 * Config de PayPal POR AGENTE — lógica PURA (sin I/O), testeable directo.
 *
 * El agente de EE.UU. cierra con el tag `#paypal` (método `paypal`, ver ADR-0055)
 * y el backend genera el link de pago con la API de PayPal (Invoicing v2) usando
 * las credenciales guardadas en `agents.paypal_config`. Acá vive el parser de ese
 * jsonb y el armado del mensaje que acompaña al link. Ver ADR-0088.
 */

/** Clave de método de pago que dispara el link automático (tag `#paypal`). */
export const PAYPAL_METHOD = "paypal";

/** Placeholder del link dentro del mensaje configurable. */
export const PAYPAL_LINK_PLACEHOLDER = "{link}";

/** Mensaje por defecto si el agente no configuró uno. */
export const DEFAULT_PAYPAL_MESSAGE =
  "Perfecto ✅ Aquí tienes tu link de pago seguro con PayPal:\n{link}\n\nApenas completes el pago seguimos con tu pedido.";

/** Config de PayPal de un agente (de `agents.paypal_config`). */
export interface PaypalAgentConfig {
  /** Client ID de la app REST de PayPal (Live u, opcionalmente, Sandbox). */
  clientId: string;
  /** SECRETO — Client Secret de la misma app. Nunca sale al cliente. */
  clientSecret: string;
  /** true = api-m.sandbox.paypal.com (pruebas); false = producción. */
  sandbox: boolean;
  /** Mensaje que acompaña el link; `{link}` se reemplaza (o se anexa al final). */
  message: string;
  /** Impuesto (%) que PayPal aplica a cada ítem. 0 = sin impuesto. */
  taxPercent: number;
  /** Costo de envío fijo (moneda del agente). 0 = sin envío. */
  shippingAmount: number;
}

/**
 * Número decimal desde lo que la gente teclea ("7.25", "7,25", "$5.99", "8 %").
 * Inválido o negativo → 0 (la config nunca rompe el flujo).
 */
export function parseDecimal(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (typeof raw !== "string") return 0;
  const cleaned = raw.replace(/[^0-9.,]/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Normaliza el jsonb `agents.paypal_config`. Devuelve null si no hay credenciales
 * completas (feature apagado). Nunca lanza: cualquier cosa rara colapsa a null.
 */
export function parsePaypalConfig(raw: unknown): PaypalAgentConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const clientId = typeof rec.client_id === "string" ? rec.client_id.trim() : "";
  const clientSecret = typeof rec.client_secret === "string" ? rec.client_secret.trim() : "";
  if (!clientId || !clientSecret) return null;
  const message =
    typeof rec.message === "string" && rec.message.trim() ? rec.message.trim() : DEFAULT_PAYPAL_MESSAGE;
  return {
    clientId,
    clientSecret,
    sandbox: rec.sandbox === true,
    message,
    taxPercent: Math.min(100, parseDecimal(rec.tax_percent)),
    shippingAmount: parseDecimal(rec.shipping),
  };
}

/**
 * Mensaje final que ve el cliente: reemplaza `{link}` (todas las veces) o, si el
 * operador escribió un mensaje sin placeholder, anexa el link al final.
 */
export function buildPaypalMessage(message: string, url: string): string {
  const base = (message ?? "").trim() || DEFAULT_PAYPAL_MESSAGE;
  if (base.includes(PAYPAL_LINK_PLACEHOLDER)) {
    return base.split(PAYPAL_LINK_PLACEHOLDER).join(url);
  }
  return `${base}\n\n${url}`;
}

/** Campos del editor del dashboard (crudos, aunque la config esté incompleta). */
export interface PaypalEditorFields {
  paypalClientId: string;
  /** El secreto NUNCA sale al editor: solo si está puesto. */
  hasPaypalSecret: boolean;
  paypalSandbox: boolean;
  /** Como texto porque vienen de un `<input>`; vacío = 0/sin configurar. */
  paypalTaxPercent: string;
  paypalShipping: string;
  paypalMessage: string;
}

/**
 * Lee el jsonb CRUDO para el editor (sin exigir credenciales completas, para no
 * perder lo ya escrito) y sin exponer el secreto.
 */
export function readPaypalEditorFields(raw: unknown): PaypalEditorFields {
  const rec =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const tax = parseDecimal(rec.tax_percent);
  const shipping = parseDecimal(rec.shipping);
  return {
    paypalClientId: typeof rec.client_id === "string" ? rec.client_id.trim() : "",
    hasPaypalSecret: typeof rec.client_secret === "string" && rec.client_secret.trim().length > 0,
    paypalSandbox: rec.sandbox === true,
    paypalTaxPercent: tax > 0 ? String(tax) : "",
    paypalShipping: shipping > 0 ? String(shipping) : "",
    paypalMessage: typeof rec.message === "string" ? rec.message : "",
  };
}
