import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { describeStatusPayload } from "@/lib/callbell/sender";
import type { Json } from "@/lib/supabase/types";

/**
 * Desenlace REAL de un mensaje que ya salió — webhook `message_status_updated`.
 *
 * Por qué existe: el envío devuelve `enqueued`, que solo significa "Callbell lo
 * aceptó". Si WhatsApp lo rechaza después (plantilla mal armada, número inválido,
 * imagen que no se puede descargar), el mensaje muere y **no dejábamos rastro**:
 * el webhook descartaba el evento y el dashboard seguía diciendo "enviado". Así
 * estuvieron las reactivaciones de día 7: 339 "enviadas", 0 respuestas. Ver ADR-0081.
 *
 * Solo registramos los desenlaces MALOS (`failed`, `mismatch`). Los buenos
 * (`sent`, `delivered`, `read`) llegan por miles y no explican nada.
 */

const BAD_STATUSES = new Set(["failed", "mismatch"]);

export interface OutboundStatusEvent {
  uuid: string;
  status: string;
  /** Razón legible del fallo (o el payload crudo del proveedor). */
  detail: string | null;
}

/** ¿Es un evento de estado con un desenlace que hay que registrar? Lógica pura. */
export function parseOutboundStatus(body: unknown): OutboundStatusEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.event !== "message_status_updated") return null;
  const payload = (b.payload ?? {}) as Record<string, unknown>;
  const uuid = typeof payload.uuid === "string" ? payload.uuid : null;
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : null;
  if (!uuid || !status || !BAD_STATUSES.has(status)) return null;
  return { uuid, status, detail: describeStatusPayload(payload.messageStatusPayload) };
}

/** Etapa de reactivación a la que pertenece un mensaje, según sus tags. */
function reactivationStageFromTags(tags: unknown): number | null {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    const m = typeof t === "string" ? /^reactivacion-(\d+)$/.exec(t) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Registra el fallo: evento `outbound_failed` en el hilo de la conversación y, si
 * el mensaje era una reactivación, corrige su fila (`sent` → `failed` con la razón)
 * para que el dashboard y los costos digan la verdad.
 *
 * Best-effort: el webhook SIEMPRE debe responder 200, así que nada de acá se
 * propaga hacia arriba.
 */
export async function recordOutboundStatus(event: OutboundStatusEvent): Promise<void> {
  const supabase = createServiceClient();

  const { data: message } = await supabase
    .from("messages")
    .select("id, conversation_id, tags")
    .eq("callbell_message_uuid", event.uuid)
    .maybeSingle();

  await supabase.from("events_log").insert({
    conversation_id: message?.conversation_id ?? null,
    type: "outbound_failed",
    payload: {
      uuid: event.uuid,
      status: event.status,
      reason: event.detail,
    } as unknown as Json,
  });

  if (!message) return;

  const stage = reactivationStageFromTags(message.tags);
  if (stage == null) return;

  await supabase
    .from("reactivations")
    .update({
      status: "failed",
      error: `whatsapp-${event.status}: ${event.detail ?? "sin detalle"}`.slice(0, 300),
    })
    .eq("conversation_id", message.conversation_id)
    .eq("stage", stage)
    .eq("status", "sent");
}
