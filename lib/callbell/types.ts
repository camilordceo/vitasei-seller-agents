/**
 * Tipos y helpers del webhook de Callbell.
 *
 * NOTA: El shape exacto del evento `message_created` se confirma contra un
 * webhook real en la aceptación del Sprint 1 (por eso guardamos el body crudo
 * en `events_log`). El parsing es defensivo: campos opcionales con fallbacks,
 * para no descartar mensajes inbound reales por un nombre de campo inesperado.
 */

export interface CallbellContact {
  uuid?: string;
  name?: string | null;
  phoneNumber?: string; // E.164 con '+', ej: +573001234567
  [key: string]: unknown;
}

export interface CallbellMessagePayload {
  uuid?: string;
  text?: string | null;
  type?: string; // text | image | audio | video | document | ...
  status?: string; // received | sent | ...
  channel?: string; // whatsapp
  from?: string; // origen del mensaje (contact / user / operator / bot ...)
  conversationHref?: string;
  contactUuid?: string;
  contact?: CallbellContact;
  [key: string]: unknown;
}

export interface CallbellWebhookBody {
  event?: string; // 'message_created'
  payload?: CallbellMessagePayload;
  [key: string]: unknown;
}

/**
 * Normaliza un teléfono a E.164 sin '+' → solo dígitos (ej: 573001234567).
 * Devuelve null si no quedan dígitos.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Orígenes que NO son del cliente (mensajes salientes/echo del bot u operador).
 * El webhook solo debe procesar mensajes inbound del cliente.
 */
const OUTBOUND_FROM = new Set([
  "user",
  "operator",
  "bot",
  "admin",
  "agent",
  "team",
]);

/**
 * ¿El payload corresponde a un mensaje saliente (no del cliente)?
 * Defensivo: solo lo consideramos outbound si `from` lo indica explícitamente.
 */
export function isOutbound(payload?: CallbellMessagePayload): boolean {
  const from = payload?.from?.toLowerCase();
  return from ? OUTBOUND_FROM.has(from) : false;
}

/**
 * ¿Es un evento de mensaje inbound del cliente que debemos procesar?
 */
export function isInboundMessageEvent(body: CallbellWebhookBody): boolean {
  return body.event === "message_created" && !isOutbound(body.payload);
}
