import "server-only";
import { env } from "@/lib/env";

/**
 * Sender de Callbell (Sprint 4) — `POST /v1/messages/send`.
 * Abstrae `sendText` y `sendImage`; cada envío devuelve el `uuid` para guardar
 * en `messages.callbell_message_uuid`. El handoff (`team_uuid` + `bot_status`)
 * es del Sprint 5.
 */

const BASE = "https://api.callbell.eu/v1";

export interface SentMessage {
  uuid: string | null;
  status: string | null;
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
}

async function send(body: SendBody): Promise<SentMessage> {
  const res = await fetch(`${BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CALLBELL_API_KEY}`,
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
 * Envía un mensaje de texto. Con `options.teamUuid` + `options.botStatus:"bot_end"`
 * hace el handoff (reasigna a un equipo y apaga el bot) en el mismo envío.
 */
export function sendText(
  to: string,
  text: string,
  options?: SendOptions,
): Promise<SentMessage> {
  return send({
    to,
    from: "whatsapp",
    type: "text",
    content: { text },
    channel_uuid: env.CALLBELL_WHATSAPP_CHANNEL_UUID,
    metadata: options?.metadata,
    team_uuid: options?.teamUuid ?? undefined,
    bot_status: options?.botStatus,
  });
}

/**
 * Envía una imagen por URL (la del `#ID` validado) con caption opcional. El
 * `caption` viaja en `content.text`, así la imagen y el texto van en el MISMO
 * mensaje (una sola llamada a Callbell). Límite de caption de WhatsApp ~1024.
 */
export function sendImage(
  to: string,
  url: string,
  caption?: string | null,
  options?: { metadata?: Record<string, unknown> },
): Promise<SentMessage> {
  const content: Record<string, unknown> = { url };
  if (caption) content.text = caption;
  return send({
    to,
    from: "whatsapp",
    type: "image",
    content,
    channel_uuid: env.CALLBELL_WHATSAPP_CHANNEL_UUID,
    metadata: options?.metadata,
  });
}
