import "server-only";
import { env } from "@/lib/env";

/**
 * Sender de Callbell — `POST /v1/messages/send`.
 * Abstrae `sendText`/`sendImage`/`sendTemplate`; cada envío devuelve el `uuid`
 * para guardar en `messages.callbell_message_uuid`. El handoff (`team_uuid` +
 * `bot_status`) es del Sprint 5.
 *
 * MULTI-AGENTE: cada envío recibe las credenciales del agente (`CallbellCreds`:
 * API key + canal), porque distintas marcas viven en distintas cuentas de
 * Callbell. `credsFromEnv()` da el fallback single-agent. Ver docs/16, ADR-0023.
 */

const BASE = "https://api.callbell.eu/v1";

export interface SentMessage {
  uuid: string | null;
  status: string | null;
}

/**
 * Credenciales de Callbell del agente: qué cuenta (API key) y qué número/canal
 * (`channelUuid`) usar para enviar. `lib/agent/agents.ts` las arma por agente
 * con fallback a env.
 */
export interface CallbellCreds {
  apiKey: string;
  channelUuid: string | null;
}

/** Fallback single-agent: credenciales desde las env globales de Vercel. */
export function credsFromEnv(): CallbellCreds {
  return {
    apiKey: env.CALLBELL_API_KEY,
    channelUuid: env.CALLBELL_WHATSAPP_CHANNEL_UUID ?? null,
  };
}

/** Opciones de envío. `teamUuid` + `botStatus` se usan para el handoff (S5). */
export interface SendOptions {
  metadata?: Record<string, unknown>;
  /** Reasigna la conversación a un equipo (ej. logística). */
  teamUuid?: string | null;
  /** `bot_end` detiene el bot en esa conversación. */
  botStatus?: "bot_start" | "bot_end";
}

interface SendBody {
  to: string;
  from: "whatsapp";
  // Callbell manda video/audio/documento TODOS como `document` (WhatsApp infiere
  // el tipo por la extensión del archivo). Solo `image` admite caption. Ver
  // https://docs.callbell.eu/api/reference/messages_api/post_send_messages/
  type: "text" | "image" | "document";
  content: Record<string, unknown>;
  channel_uuid?: string;
  metadata?: Record<string, unknown>;
  team_uuid?: string;
  bot_status?: "bot_start" | "bot_end";
  /** Plantilla aprobada (obligatoria fuera de la ventana de 24h). */
  template_uuid?: string;
  /** Valores de las variables de la plantilla (si tiene). */
  template_values?: string[];
  /** Confirma que el contacto dio opt-in (requerido por Callbell en plantillas). */
  optin_contact?: boolean;
}

/**
 * Callbell exige que TODOS los valores de `metadata` sean strings: un número o
 * booleano devuelve HTTP 400 `{"error":{"metadata":["must be string"]}}` y el
 * envío NO sale (así fallaron en silencio todas las reactivaciones y varios
 * avisos al dueño). Se normaliza aquí — el único punto de salida — para que
 * ningún call site pueda volver a romperlo.
 */
function stringifyMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

async function send(creds: CallbellCreds, body: SendBody): Promise<SentMessage> {
  const res = await fetch(`${BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, metadata: stringifyMetadata(body.metadata) }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Callbell send HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as {
    message?: { uuid?: string; status?: string };
  };
  return { uuid: data.message?.uuid ?? null, status: data.message?.status ?? null };
}

// --- Diagnóstico ------------------------------------------------------------

/**
 * Estado REAL de un mensaje ya enviado — `GET /v1/messages/status/:uuid`.
 *
 * `enqueued` (lo que devuelve el envío) solo dice que Callbell lo aceptó, no que
 * WhatsApp lo entregó. Una plantilla mal armada se acepta con 200 y muere después:
 * el único lugar donde eso se ve es acá (o en el webhook `message_status_updated`).
 * Estados: `enqueued`, `sent`, `delivered`, `read`, `failed`, `mismatch`, `deleted`.
 */
export interface MessageStatus {
  status: string | null;
  /** Razón del fallo (o el payload crudo del proveedor) para mostrarla tal cual. */
  detail: string | null;
}

export async function getMessageStatus(
  creds: CallbellCreds,
  uuid: string,
): Promise<MessageStatus> {
  const res = await fetch(`${BASE}/messages/status/${uuid}`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Callbell status HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => ({}))) as {
    message?: { status?: string; messageStatusPayload?: unknown };
  };
  return {
    status: data.message?.status ?? null,
    detail: describeStatusPayload(data.message?.messageStatusPayload),
  };
}

/**
 * Saca la razón legible de un `messageStatusPayload` (misma forma en el webhook).
 * Callbell no documenta el nombre del campo del fallo, así que se buscan los
 * candidatos conocidos y, si no hay ninguno, se devuelve el JSON crudo recortado:
 * más vale un JSON feo que un "no se sabe".
 */
export function describeStatusPayload(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const outer = raw as Record<string, unknown>;
  const inner = (outer.payload && typeof outer.payload === "object"
    ? (outer.payload as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  for (const source of [inner, outer]) {
    for (const key of ["reason", "error", "message", "description", "title"]) {
      const v = source[key];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
  }
  const json = JSON.stringify(outer.payload ?? outer);
  return json && json !== "{}" ? json.slice(0, 300) : null;
}

/** Plantilla aprobada tal como la lista Callbell (`GET /v1/templates`). */
export interface CallbellTemplate {
  uuid: string;
  title: string | null;
  /** `text`, `image`, `document`… — tiene que cuadrar con si mandamos imagen o no. */
  templateType: string | null;
  status: string | null;
  text: string | null;
}

/**
 * Lista las plantillas aprobadas de la cuenta. Sirve para responder sin adivinar
 * las dos preguntas que rompen las reactivaciones: ¿el UUID pegado en el dashboard
 * existe en ESTA cuenta? ¿la plantilla lleva header de imagen o es de solo texto?
 */
export async function listTemplates(creds: CallbellCreds): Promise<CallbellTemplate[]> {
  const res = await fetch(`${BASE}/templates`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Callbell templates HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => ({}))) as {
    templates?: Array<Record<string, unknown>>;
  };
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return (data.templates ?? []).map((t) => ({
    uuid: String(t.uuid ?? ""),
    title: str(t.title),
    templateType: str(t.templateType),
    status: str(t.status),
    text: str(t.text),
  }));
}

/**
 * Envía un mensaje de texto con las credenciales del agente (`creds`). Con
 * `options.teamUuid` + `options.botStatus:"bot_end"` hace el handoff (reasigna a
 * un equipo y apaga el bot) en el mismo envío.
 */
export function sendText(
  creds: CallbellCreds,
  to: string,
  text: string,
  options?: SendOptions,
): Promise<SentMessage> {
  return send(creds, {
    to,
    from: "whatsapp",
    type: "text",
    content: { text },
    channel_uuid: creds.channelUuid ?? undefined,
    metadata: options?.metadata,
    team_uuid: options?.teamUuid ?? undefined,
    bot_status: options?.botStatus,
  });
}

/**
 * Envía un mensaje de PLANTILLA aprobada (WhatsApp). Es lo único permitido fuera
 * de la ventana de 24h. `optin_contact: true` porque el cliente nos escribió primero.
 *
 * Dos formas según si la plantilla tiene header de imagen (ver docs/14, ADR-0021/0044):
 *  - **Sin imagen** (`imageUrl` vacío): `type:"text"`, la variable única va en
 *    `content.text` (convención de Callbell para plantillas de una variable).
 *  - **Con imagen** (`imageUrl`): `type:"image"`, el header viaja en `content.url`
 *    (como en `sendImage`) y la variable va en `content.text` **y también** en
 *    `template_values`.
 *
 * Por qué las dos: la doc de Callbell pone SIEMPRE el valor de la variable en
 * `content.text` (su ejemplo de varias variables manda `content.text` **y**
 * `template_values`). ADR-0044 lo omitió con imagen por miedo a que fuera un
 * caption, y el resultado fue que la plantilla de día 7 (la única con imagen) salía
 * con el cuerpo sin variable: Callbell devolvía `enqueued` y WhatsApp la descartaba
 * después — 339 envíos, 0 respuestas. Ver ADR-0081.
 *
 * `templateValues` es para plantillas con varias variables (tiene prioridad).
 */
export function sendTemplate(
  creds: CallbellCreds,
  to: string,
  templateUuid: string,
  options?: {
    text?: string;
    templateValues?: string[];
    /** Header de imagen de la plantilla. Si viene, el envío es `type:"image"`. */
    imageUrl?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<SentMessage> {
  const templateValues =
    options?.templateValues && options.templateValues.length > 0
      ? options.templateValues
      : undefined;

  if (options?.imageUrl) {
    const values = templateValues ?? (options.text ? [options.text] : undefined);
    // El valor de la variable va en content.text (convención de Callbell) ADEMÁS de
    // en template_values: sin él, el cuerpo de la plantilla viajaba sin variable.
    const first = values?.[0] ?? options.text ?? "";
    return send(creds, {
      to,
      from: "whatsapp",
      type: "image",
      content: first ? { url: options.imageUrl, text: first } : { url: options.imageUrl },
      channel_uuid: creds.channelUuid ?? undefined,
      template_uuid: templateUuid,
      template_values: values,
      optin_contact: true,
      metadata: options?.metadata,
    });
  }

  return send(creds, {
    to,
    from: "whatsapp",
    type: "text",
    content: { text: options?.text ?? "" },
    channel_uuid: creds.channelUuid ?? undefined,
    template_uuid: templateUuid,
    template_values: templateValues,
    optin_contact: true,
    metadata: options?.metadata,
  });
}

/**
 * Envía una imagen por URL (la del `#ID` validado) con caption opcional. El
 * `caption` viaja en `content.text`, así la imagen y el texto van en el MISMO
 * mensaje (una sola llamada a Callbell). Límite de caption de WhatsApp ~1024.
 */
export function sendImage(
  creds: CallbellCreds,
  to: string,
  url: string,
  caption?: string | null,
  options?: { metadata?: Record<string, unknown> },
): Promise<SentMessage> {
  const content: Record<string, unknown> = { url };
  if (caption) content.text = caption;
  return send(creds, {
    to,
    from: "whatsapp",
    type: "image",
    content,
    channel_uuid: creds.channelUuid ?? undefined,
    metadata: options?.metadata,
  });
}

/**
 * Envía un VIDEO por URL. Callbell lo manda como `type: "document"` con
 * `content: { url }` (WhatsApp reconoce el video por la extensión, ej. .mp4).
 * Requiere una cuenta con la API oficial de WhatsApp Business.
 *
 * `caption`: la doc de Callbell solo documenta caption para `image`, pero WhatsApp
 * soporta caption en video, así que lo mandamos igual vía `content.text` para que
 * el texto y el video queden en UN mismo mensaje. Si Callbell no lo reenvía, el
 * video llega sin caption (no rompe). Ver docs/20. Doc:
 * https://docs.callbell.eu/api/reference/messages_api/post_send_messages/
 */
export function sendVideo(
  creds: CallbellCreds,
  to: string,
  url: string,
  caption?: string | null,
  options?: { metadata?: Record<string, unknown> },
): Promise<SentMessage> {
  const content: Record<string, unknown> = { url };
  if (caption) content.text = caption;
  return send(creds, {
    to,
    from: "whatsapp",
    type: "document",
    content,
    channel_uuid: creds.channelUuid ?? undefined,
    metadata: options?.metadata,
  });
}
