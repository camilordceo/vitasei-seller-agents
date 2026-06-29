import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database, Json, MessageType } from "@/lib/supabase/types";

type ContactUpdate = Database["public"]["Tables"]["contacts"]["Update"];
type ConversationUpdate =
  Database["public"]["Tables"]["conversations"]["Update"];

/**
 * Mapea el `type` de Callbell a nuestro enum `message_type` de Supabase.
 */
function toMessageType(type: string | null): MessageType {
  switch (type) {
    case "text":
    case "image":
    case "audio":
    case "video":
    case "document":
      return type;
    default:
      return "other";
  }
}

/**
 * processMessage — Sprint 1.
 *
 * Patrón del loop (Inngest): por ahora cubre el inicio del SENSE + LOG.
 * REASON/PROPOSE/GATE/ACT llegan en sprints posteriores (S3+).
 *
 * Responsabilidades en S1:
 *  - Idempotencia por `callbell_message_uuid` (unique en `messages`).
 *  - Upsert de contact (get-or-create por phone).
 *  - Get-or-create de la conversación activa; actualizar `last_inbound_at`.
 *  - Guardar el mensaje inbound.
 *  - Loguear `webhook_received` en `events_log` (con el body crudo).
 *
 * Concurrencia: limitada a 1 por `phone` para no pisar respuestas si el cliente
 * manda varios mensajes seguidos (equivale a "por conversación" en v1, donde un
 * contacto tiene una sola conversación activa).
 */
export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    name: "Process WhatsApp message",
    concurrency: { key: "event.data.phone", limit: 1 },
  },
  { event: "whatsapp/message.received" },
  async ({ event, step }) => {
    const {
      phone,
      messageUuid,
      text,
      messageType,
      contactName,
      callbellContactUuid,
      conversationHref,
      raw,
    } = event.data;

    const supabase = createServiceClient();

    // 1) Idempotencia: si ya existe un mensaje con este uuid, no reprocesar.
    const isDuplicate = await step.run("idempotency-check", async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id")
        .eq("callbell_message_uuid", messageUuid)
        .maybeSingle();
      if (error) throw new Error(`idempotency-check: ${error.message}`);
      return Boolean(data);
    });

    if (isDuplicate) {
      return { skipped: true, reason: "duplicate", messageUuid };
    }

    // 2) Contact: get-or-create por phone (seguro con concurrency=1 por phone).
    const contactId = await step.run("upsert-contact", async () => {
      const { data: existing, error: selErr } = await supabase
        .from("contacts")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();
      if (selErr) throw new Error(`upsert-contact select: ${selErr.message}`);

      if (existing) {
        // Completar datos que pudieran faltar, sin sobreescribir con null.
        const patch: ContactUpdate = {};
        if (contactName) patch.name = contactName;
        if (callbellContactUuid)
          patch.callbell_contact_uuid = callbellContactUuid;
        if (Object.keys(patch).length > 0) {
          const { error: updErr } = await supabase
            .from("contacts")
            .update(patch)
            .eq("id", existing.id);
          if (updErr) throw new Error(`upsert-contact update: ${updErr.message}`);
        }
        return existing.id;
      }

      const { data: inserted, error: insErr } = await supabase
        .from("contacts")
        .insert({
          phone,
          name: contactName,
          callbell_contact_uuid: callbellContactUuid,
        })
        .select("id")
        .single();
      if (insErr) throw new Error(`upsert-contact insert: ${insErr.message}`);
      return inserted.id;
    });

    // 3) Conversación: get-or-create la activa; actualizar last_inbound_at.
    const conversationId = await step.run("upsert-conversation", async () => {
      const nowIso = new Date(event.ts ?? Date.now()).toISOString();

      const { data: existing, error: selErr } = await supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", contactId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (selErr)
        throw new Error(`upsert-conversation select: ${selErr.message}`);

      if (existing) {
        const patch: ConversationUpdate = { last_inbound_at: nowIso };
        if (conversationHref) patch.callbell_conversation_href = conversationHref;
        const { error: updErr } = await supabase
          .from("conversations")
          .update(patch)
          .eq("id", existing.id);
        if (updErr)
          throw new Error(`upsert-conversation update: ${updErr.message}`);
        return existing.id;
      }

      const { data: inserted, error: insErr } = await supabase
        .from("conversations")
        .insert({
          contact_id: contactId,
          status: "active",
          last_inbound_at: nowIso,
          callbell_conversation_href: conversationHref,
        })
        .select("id")
        .single();
      if (insErr)
        throw new Error(`upsert-conversation insert: ${insErr.message}`);
      return inserted.id;
    });

    // 4) Guardar el mensaje inbound (también respalda la idempotencia vía unique).
    await step.run("save-inbound-message", async () => {
      const { error } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        direction: "inbound",
        role: "user",
        type: toMessageType(messageType),
        content: text,
        callbell_message_uuid: messageUuid,
      });
      if (error) throw new Error(`save-inbound-message: ${error.message}`);
    });

    // 5) LOG: webhook_received con el body crudo (para refinar el parser).
    await step.run("log-webhook-received", async () => {
      const { error } = await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "webhook_received",
        payload: { phone, messageUuid, raw } as unknown as Json,
      });
      if (error) throw new Error(`log-webhook-received: ${error.message}`);
    });

    return { ok: true, conversationId, contactId, messageUuid };
  },
);
