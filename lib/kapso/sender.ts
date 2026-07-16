import "server-only";
import { buildTemplateComponents, parseTemplateRef } from "@/lib/kapso/templates";
import type { SentMessage } from "@/lib/messaging/types";

/**
 * Sender de Kapso — `POST /meta/whatsapp/v24.0/{phone_number_id}/messages`.
 *
 * Kapso es un **proxy Meta-compatible**: el body es exactamente el de la Cloud API
 * de WhatsApp (`messaging_product`/`type`/`text.body`/`template.components`) y lo
 * único propio es la auth (`X-API-Key`). Por eso este módulo se parece más a la doc
 * de Meta que al sender de Callbell.
 *
 * Diferencias con Callbell que condicionan el diseño (ver docs/24, ADR-0056):
 *  - **HTTP 409 "in-flight":** Kapso rechaza un envío si el anterior a ESE mismo
 *    destinatario sigue en vuelo. Callbell no hace esto. Como el flujo manda texto
 *    + N imágenes seguidas, se reintenta con backoff (`send409Retry`).
 *  - **Sin `metadata`:** no se manda nada equivalente. La trazabilidad
 *    (`conversation_id`) ya queda en `events_log`; inventar un campo no documentado
 *    arriesga un 400 en la ruta crítica.
 *  - **Sin handoff nativo:** no hay `team_uuid` ni `bot_status`; lo que calla a
 *    nuestra IA es `conversations.status`, no el proveedor.
 */

const BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

/** Credenciales de Kapso de un agente: qué proyecto (API key) y qué número. */
export interface KapsoCreds {
  apiKey: string;
  /** Meta Phone Number ID: va en el path del envío y enruta el inbound. */
  phoneNumberId: string;
  /** Idioma por defecto de las plantillas (ej. `es`, `es_CO`). */
  templateLanguage: string;
}

/** Reintentos ante 409 (mensaje anterior aún en vuelo) y sus esperas en ms. */
const RETRY_DELAYS_MS = [400, 1200, 2500];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type MessageBody = Record<string, unknown>;

/**
 * Mensaje de error de Kapso. Convive con DOS formas: la de Meta
 * (`{error:{message,code,…}}`, en el proxy) y la plana de la Platform API
 * (`{error:"texto"}`). Se prueban ambas antes de caer al cuerpo crudo.
 */
function errorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    const err = parsed?.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const e = err as { message?: unknown; code?: unknown; error_subcode?: unknown };
      const parts = [
        typeof e.message === "string" ? e.message : null,
        e.code != null ? `code ${String(e.code)}` : null,
      ].filter(Boolean);
      if (parts.length > 0) return parts.join(" · ");
    }
  } catch {
    // Cuerpo no-JSON → se devuelve recortado abajo.
  }
  return raw.slice(0, 200);
}

/**
 * Hace el POST y devuelve el `wamid`. Reintenta ante **409** (in-flight) con
 * backoff; cualquier otro error HTTP lanza de una (el llamador ya sabe qué hacer:
 * el flujo normal lo registra en `events_log`, los workers marcan `failed`).
 */
async function send(creds: KapsoCreds, body: MessageBody): Promise<SentMessage> {
  const url = `${BASE}/${encodeURIComponent(creds.phoneNumberId)}/messages`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string; message_status?: string }>;
      };
      const first = data.messages?.[0];
      return { uuid: first?.id ?? null, status: first?.message_status ?? null };
    }

    const detail = await res.text().catch(() => "");

    // 409: el mensaje anterior a este destinatario sigue en vuelo → esperar y repetir.
    if (res.status === 409 && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    throw new Error(`Kapso send HTTP ${res.status}: ${errorMessage(detail)}`);
  }
}

/** Envía texto plano. `options` se acepta por simetría con el puerto; Kapso no usa metadata. */
export function sendText(creds: KapsoCreds, to: string, text: string): Promise<SentMessage> {
  return send(creds, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

/**
 * Envía una imagen por URL con caption opcional. `image.link` es una URL pública:
 * no se re-hospeda nada (mismo criterio que ADR-0049).
 */
export function sendImage(
  creds: KapsoCreds,
  to: string,
  url: string,
  caption?: string | null,
): Promise<SentMessage> {
  const image: Record<string, unknown> = { link: url };
  if (caption) image.caption = caption;
  return send(creds, { messaging_product: "whatsapp", to, type: "image", image });
}

/**
 * Envía un video por URL con caption opcional. A diferencia de Callbell —que manda
 * todo como `document` y deja que WhatsApp infiera el tipo— acá el tipo es explícito.
 */
export function sendVideo(
  creds: KapsoCreds,
  to: string,
  url: string,
  caption?: string | null,
): Promise<SentMessage> {
  const video: Record<string, unknown> = { link: url };
  if (caption) video.caption = caption;
  return send(creds, { messaging_product: "whatsapp", to, type: "video", video });
}

/**
 * Envía una plantilla aprobada (lo único permitido fuera de la ventana de 24h).
 *
 * La referencia guardada en la base es el **nombre** de la plantilla, con idioma
 * opcional (`nombre:es_CO`); si no lo trae, se usa el del agente. Las variables van
 * **posicionales** ({{1}}, {{2}}…), igual que los `template_values` de Callbell.
 */
export function sendTemplate(
  creds: KapsoCreds,
  to: string,
  templateRef: string,
  options?: { templateValues?: string[]; imageUrl?: string | null },
): Promise<SentMessage> {
  const { name, language } = parseTemplateRef(templateRef, creds.templateLanguage);
  const components = buildTemplateComponents({
    values: options?.templateValues ?? [],
    imageUrl: options?.imageUrl ?? null,
  });

  const template: Record<string, unknown> = { name, language: { code: language } };
  if (components.length > 0) template.components = components;

  return send(creds, { messaging_product: "whatsapp", to, type: "template", template });
}
