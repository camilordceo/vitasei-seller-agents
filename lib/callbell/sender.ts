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
  type: "text" | "image";
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

async function send(creds: CallbellCreds, body: SendBody): Promise<SentMessage> {
  const res = await fetch(`${BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
 * de la ventana de 24h. `content.text` lleva el texto de respaldo/variable (como
 * en el ejemplo de Callbell); `templateValues` es para plantillas con varias
 * variables. `optin_contact: true` porque el cliente nos escribió primero. Ver
 * docs/14 y ADR-0021.
 */
export function sendTemplate(
  creds: CallbellCreds,
  to: string,
  templateUuid: string,
  options?: {
    text?: string;
    templateValues?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<SentMessage> {
  return send(creds, {
    to,
    from: "whatsapp",
    type: "text",
    content: { text: options?.text ?? "" },
    channel_uuid: creds.channelUuid ?? undefined,
    template_uuid: templateUuid,
    template_values:
      options?.templateValues && options.templateValues.length > 0
        ? options.templateValues
        : undefined,
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
