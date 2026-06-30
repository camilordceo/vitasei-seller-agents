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

interface SendBody {
  to: string;
  from: "whatsapp";
  type: "text" | "image";
  content: Record<string, unknown>;
  channel_uuid?: string;
  metadata?: Record<string, unknown>;
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

/** Envía un mensaje de texto. `metadata` opcional (ej. `{ conversation_id }`). */
export function sendText(
  to: string,
  text: string,
  metadata?: Record<string, unknown>,
): Promise<SentMessage> {
  return send({
    to,
    from: "whatsapp",
    type: "text",
    content: { text },
    channel_uuid: env.CALLBELL_WHATSAPP_CHANNEL_UUID,
    metadata,
  });
}

/** Envía una imagen por URL (la del `#ID` validado), con caption opcional. */
export function sendImage(
  to: string,
  url: string,
  caption?: string | null,
): Promise<SentMessage> {
  const content: Record<string, unknown> = { url };
  if (caption) content.text = caption;
  return send({
    to,
    from: "whatsapp",
    type: "image",
    content,
    channel_uuid: env.CALLBELL_WHATSAPP_CHANNEL_UUID,
  });
}
