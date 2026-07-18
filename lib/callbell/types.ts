import { normalizePhone } from "@/lib/messaging/phone";
import { kindFromUrl } from "@/lib/messaging/media";

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
  // Adjuntos del mensaje (imagen/audio/video/documento): array de URLs. WhatsApp
  // manda un adjunto por mensaje. Ver docs/04 §1 y docs/15.
  attachments?: string[] | null;
  // Según la versión de Callbell puede venir como string ("whatsapp") o como
  // objeto con datos del canal (uuid/phoneNumber). Lo tratamos defensivamente.
  channel?: string | Record<string, unknown>;
  from?: string; // origen del mensaje (contact / user / operator / bot ...)
  conversationHref?: string;
  contactUuid?: string;
  contact?: CallbellContact;
  // Campos que identifican a QUÉ número/canal llegó el mensaje. El shape exacto
  // se confirma contra un webhook real (por eso miramos varios candidatos en
  // getDestinationNumber/getChannelUuid). Los dejamos opcionales/laxos.
  to?: string | null; // número de negocio destino (E.164) en algunas versiones
  channelUuid?: string;
  channel_uuid?: string;
  [key: string]: unknown;
}

export interface CallbellWebhookBody {
  event?: string; // 'message_created'
  payload?: CallbellMessagePayload;
  [key: string]: unknown;
}

/**
 * Normaliza un teléfono a E.164 sin '+' → solo dígitos (ej: 573001234567).
 * La implementación vive en `lib/messaging/phone.ts` (compartida con Kapso desde
 * ADR-0056); se re-exporta acá para no tocar a quien ya la importaba de este módulo.
 */
export { normalizePhone };

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

/**
 * URLs de adjuntos del mensaje (imagen/audio/video/documento). Defensivo: solo
 * strings no vacíos. Ver docs/15.
 */
export function getAttachments(payload?: CallbellMessagePayload): string[] {
  const raw = payload?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
}

/**
 * Tipo del mensaje (`text` | `image` | `audio` | `video` | `document`).
 *
 * OJO — Callbell **no manda `type`** en `message_created`. Se verificó contra los
 * payloads reales guardados en `events_log`: las claves del payload son
 * `to, from, text, uuid, status, channel, contact, createdAt` (+ `attachments`
 * cuando hay adjunto), y `type` no aparece nunca. La doc sugería lo contrario y por
 * eso el código lo leía directo: el resultado era que TODO mensaje entraba como
 * `other` y `gatherPendingContent` descartaba el adjunto sin dejar rastro — audios
 * e imágenes del cliente no se procesaban jamás.
 *
 * Se mantiene `payload.type` como primera opción (si Callbell lo agrega algún día,
 * manda) y se cae a inferirlo por la extensión del adjunto, que sí viene en el path
 * (`/uploads/<uuid>.mp3`). Sin adjunto es un mensaje de texto.
 */
export function getMessageType(payload?: CallbellMessagePayload): string {
  const declared = payload?.type;
  if (typeof declared === "string" && declared.trim().length > 0) return declared.trim();

  const attachment = getAttachments(payload)[0];
  if (!attachment) return "text";

  const kind = kindFromUrl(attachment);
  // `other` = hay adjunto pero la extensión no lo identifica. Se devuelve tal cual:
  // la red de seguridad de `gatherPendingContent` lo resuelve por content-type real.
  return kind;
}

// ---------------------------------------------------------------------------
// Filtro por número de la IA
//
// Callbell tiene varios números en la cuenta y **un solo webhook**: este endpoint
// recibe inbound de TODOS los números. Solo debemos responder a los que llegan al
// número de la IA. El shape del webhook no está 100% confirmado, así que:
//  1º intentamos por el número de negocio destino (si el payload lo trae),
//  2º si no, por el `channel_uuid` (el canal del número de la IA),
//  3º si no se puede determinar y hay filtro configurado → `indeterminate`
//     (el caller decide; por defecto procesa y loguea para confirmar el campo).
// ---------------------------------------------------------------------------

/** Camina varias rutas candidatas del payload y devuelve el primer string no vacío. */
function firstString(...candidates: Array<unknown>): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

/**
 * Número de negocio destino (a QUÉ número escribió el cliente), si el webhook lo
 * incluye. Devuelve E.164 sin '+' o null. Campo exacto a confirmar contra un
 * webhook real; por eso probamos varios candidatos.
 */
export function getDestinationNumber(payload?: CallbellMessagePayload): string | null {
  if (!payload) return null;
  const channelObj = asObject(payload.channel);
  const raw = firstString(
    payload.to,
    payload.channelPhoneNumber,
    payload.channelSource,
    channelObj?.phoneNumber,
    channelObj?.number,
    channelObj?.source,
  );
  return normalizePhone(raw);
}

/** UUID del canal por el que entró el mensaje (identifica el número), si viene. */
export function getChannelUuid(payload?: CallbellMessagePayload): string | null {
  if (!payload) return null;
  const channelObj = asObject(payload.channel);
  return firstString(payload.channelUuid, payload.channel_uuid, channelObj?.uuid);
}

/** Devuelve el valor como objeto indexable si lo es (algunas versiones mandan `channel` como objeto). */
function asObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

export type InboxDecision = "match" | "reject" | "indeterminate";

export interface InboxClassification {
  decision: InboxDecision;
  dest: string | null;
  channelUuid: string | null;
}

/**
 * Decide si un inbound es para el número de la IA.
 * @param agentNumber      número de la IA (E.164 sin '+') o undefined (filtro off).
 * @param agentChannelUuid channel_uuid del número de la IA (fallback) o undefined.
 */
export function classifyInbox(
  payload: CallbellMessagePayload | undefined,
  agentNumber: string | undefined,
  agentChannelUuid: string | undefined,
): InboxClassification {
  const dest = getDestinationNumber(payload);
  const channelUuid = getChannelUuid(payload);

  // Sin filtro configurado (dev): procesar todo.
  if (!agentNumber && !agentChannelUuid) {
    return { decision: "match", dest, channelUuid };
  }
  // 1º por número destino.
  if (agentNumber && dest) {
    return { decision: dest === agentNumber ? "match" : "reject", dest, channelUuid };
  }
  // 2º por channel_uuid.
  if (agentChannelUuid && channelUuid) {
    return {
      decision: channelUuid === agentChannelUuid ? "match" : "reject",
      dest,
      channelUuid,
    };
  }
  // 3º no se pudo determinar el destino con lo que trae el webhook.
  return { decision: "indeterminate", dest, channelUuid };
}
