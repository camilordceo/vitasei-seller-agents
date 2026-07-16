/**
 * Tipos y parser del webhook de Kapso — lógica PURA (sin I/O), testeable.
 *
 * Kapso NO es un proveedor con API propia tipo Callbell: es un **proxy
 * Meta-compatible**. El payload del webhook (`X-Webhook-Payload-Version: v2`) es
 * propio de Kapso, pero el mensaje adentro tiene la forma de la Cloud API de Meta
 * (`message.text.body`, `message.image.caption`, …) más un bloque `message.kapso`
 * con los extras de la plataforma (dirección, media ya resuelta, transcripción).
 *
 * Dos formas de entrega (ver docs/24 §Webhook):
 *  - **Suelta:** `{ message, conversation, is_new_conversation, phone_number_id }`.
 *  - **En lote** (si el número tiene `buffer_enabled`): `{ type, batch: true,
 *    data: [ {suelta}, … ], batch_info }`. Cuando el buffering está encendido
 *    **TODOS** los eventos llegan así, incluso los de un solo mensaje.
 * `unwrapEvents` normaliza ambas a una lista.
 *
 * El parsing es DEFENSIVO a propósito: la doc de Kapso advierte textualmente
 * *"Do not assume `phone_number`, `from`, `to`, or `wa_id` are always present"*
 * (rollout de BSUID de Meta: identidad sin teléfono). Por eso cada dato se busca
 * en varios candidatos y nunca se asume presente.
 *
 * Ver docs/24-integracion-kapso.md, ADR-0056.
 */

import { normalizePhone } from "@/lib/messaging/phone";

/** Nombre del evento de mensaje entrante (llega en el header `X-Webhook-Event`). */
export const KAPSO_EVENT_MESSAGE_RECEIVED = "whatsapp.message.received";

/** Bloque `kapso` de un mensaje: los extras de la plataforma sobre la forma de Meta. */
export interface KapsoMessageExtras {
  /** `inbound` (del cliente) | `outbound` (nuestro). Es el filtro de eco. */
  direction?: string;
  status?: string;
  processing_status?: string;
  origin?: string;
  has_media?: boolean;
  /** Texto del mensaje ya resuelto por Kapso (respaldo de `message.text.body`). */
  content?: string | null;
  /** URL del adjunto ya resuelta por Kapso. Su auth NO está documentada (ver docs/24). */
  media_url?: string | null;
  media_data?: {
    url?: string | null;
    filename?: string | null;
    content_type?: string | null;
    byte_size?: number | null;
  } | null;
  /** Transcripción automática de notas de voz — nos ahorra la llamada a Whisper. */
  transcript?: { text?: string | null } | null;
  message_type_data?: { caption?: string | null } | null;
  [key: string]: unknown;
}

/** Mensaje con forma de Meta + el bloque `kapso`. */
export interface KapsoMessage {
  id?: string;
  timestamp?: string;
  /** text | image | audio | video | document | sticker | location | … */
  type?: string;
  /** Teléfono del cliente (solo dígitos). Puede faltar (BSUID). */
  from?: string | null;
  from_user_id?: string | null;
  username?: string | null;
  text?: { body?: string | null } | null;
  image?: { caption?: string | null; id?: string | null } | null;
  video?: { caption?: string | null; id?: string | null } | null;
  document?: { caption?: string | null; filename?: string | null; id?: string | null } | null;
  audio?: { id?: string | null; voice?: boolean } | null;
  kapso?: KapsoMessageExtras | null;
  [key: string]: unknown;
}

export interface KapsoConversation {
  id?: string;
  /** Teléfono del cliente. Puede faltar (BSUID). */
  phone_number?: string | null;
  status?: string;
  /** El número de NEGOCIO al que llegó (Meta Phone Number ID). */
  phone_number_id?: string | null;
  kapso?: {
    contact_name?: string | null;
    last_inbound_at?: string | null;
    last_outbound_at?: string | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/** Un evento de mensaje (la forma "suelta" del webhook). */
export interface KapsoMessageEvent {
  message?: KapsoMessage | null;
  conversation?: KapsoConversation | null;
  is_new_conversation?: boolean;
  /** Número de negocio destino. Es el campo de ENRUTAMIENTO a `agents`. */
  phone_number_id?: string | null;
  [key: string]: unknown;
}

/** Body del webhook: suelto o en lote. */
export interface KapsoWebhookBody extends KapsoMessageEvent {
  /** Solo en lote: el nombre del evento (en los sueltos va únicamente en el header). */
  type?: string;
  batch?: boolean;
  data?: KapsoMessageEvent[];
  batch_info?: Record<string, unknown>;
}

/**
 * Devuelve la lista de eventos del body, venga en lote o suelto. Puro.
 * Un body sin mensaje reconocible devuelve `[]` (nunca lanza).
 */
export function unwrapEvents(body: KapsoWebhookBody | null | undefined): KapsoMessageEvent[] {
  if (!body || typeof body !== "object") return [];
  // Lote: `data` manda (el flag `batch` no siempre viene y no queremos depender de él).
  if (Array.isArray(body.data)) {
    return body.data.filter((e): e is KapsoMessageEvent => !!e && typeof e === "object");
  }
  return body.message ? [body] : [];
}

/**
 * ¿Es un mensaje ENTRANTE del cliente? Defensivo, igual que en Callbell: solo lo
 * descartamos si `direction` dice explícitamente que es nuestro. Así un payload sin
 * el bloque `kapso` no se pierde.
 */
export function isInboundEvent(event: KapsoMessageEvent | undefined): boolean {
  const direction = event?.message?.kapso?.direction?.toLowerCase();
  if (!direction) return true;
  return direction === "inbound";
}

/** Id del mensaje (`wamid…`) — clave de idempotencia y del debounce. */
export function getMessageId(event: KapsoMessageEvent | undefined): string | null {
  const id = event?.message?.id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

/** Tipo del mensaje tal como lo manda Kapso (`text`, `image`, `audio`, …). */
export function getMessageType(event: KapsoMessageEvent | undefined): string | null {
  const type = event?.message?.type;
  return typeof type === "string" && type.length > 0 ? type : null;
}

/**
 * Teléfono del cliente en E.164 sin '+'. Prueba `message.from` y, si falta (BSUID),
 * `conversation.phone_number`. Null si no hay ninguno → el webhook no puede procesar.
 */
export function getContactPhone(event: KapsoMessageEvent | undefined): string | null {
  return (
    normalizePhone(event?.message?.from) ?? normalizePhone(event?.conversation?.phone_number) ?? null
  );
}

/** Nombre del contacto (perfil de WhatsApp), si Kapso lo trae. */
export function getContactName(event: KapsoMessageEvent | undefined): string | null {
  const name = event?.conversation?.kapso?.contact_name;
  if (typeof name === "string" && name.trim().length > 0) return name.trim();
  const username = event?.message?.username;
  return typeof username === "string" && username.trim().length > 0 ? username.trim() : null;
}

/**
 * Número de negocio al que llegó el mensaje (Meta Phone Number ID) — el campo de
 * enrutamiento a `agents.kapso_phone_number_id`. Va top-level y también dentro de
 * `conversation`; se prueban los dos.
 */
export function getPhoneNumberId(event: KapsoMessageEvent | undefined): string | null {
  const top = event?.phone_number_id;
  if (typeof top === "string" && top.trim().length > 0) return top.trim();
  const nested = event?.conversation?.phone_number_id;
  return typeof nested === "string" && nested.trim().length > 0 ? nested.trim() : null;
}

/** Id de la conversación en Kapso (trazabilidad; equivalente al href de Callbell). */
export function getConversationId(event: KapsoMessageEvent | undefined): string | null {
  const id = event?.conversation?.id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

/**
 * Texto del mensaje: el cuerpo (`text.body`), el caption del adjunto
 * (`image/video/document.caption`) o, como respaldo, `kapso.content`.
 * Null si el mensaje no trae texto (p. ej. una imagen sin caption).
 */
export function getText(event: KapsoMessageEvent | undefined): string | null {
  const msg = event?.message;
  if (!msg) return null;
  const candidates = [
    msg.text?.body,
    msg.image?.caption,
    msg.video?.caption,
    msg.document?.caption,
    msg.kapso?.message_type_data?.caption,
    msg.kapso?.content,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c;
  }
  return null;
}

/**
 * URL del adjunto ya resuelta por Kapso (`kapso.media_url` / `kapso.media_data.url`).
 * Null si el mensaje no trae media. OJO: si esa URL necesita auth para descargarse
 * NO está documentado — `lib/kapso/mediaFetch.ts` lo maneja probando ambas.
 */
export function getMediaUrl(event: KapsoMessageEvent | undefined): string | null {
  const k = event?.message?.kapso;
  const candidates = [k?.media_url, k?.media_data?.url];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

/**
 * Transcripción de una nota de voz hecha por Kapso. Si viene, la guardamos como el
 * `content` del mensaje en la ingesta y el cerebro NO llama a Whisper (ver
 * `gatherPendingContent`: solo transcribe si el `content` está vacío). Ver ADR-0057.
 */
export function getTranscript(event: KapsoMessageEvent | undefined): string | null {
  const text = event?.message?.kapso?.transcript?.text;
  return typeof text === "string" && text.trim().length > 0 ? text.trim() : null;
}
