import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { createOpenAIClient } from "@/lib/openai/client";
import { generateReply } from "@/lib/openai/responses";
import { parseReply } from "@/lib/agent/tags";
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
 * processMessage — flujo por mensaje (Sprints 1 y 3).
 *
 * Es una IA simple: por cada inbound se guarda el mensaje, se genera la
 * respuesta con UNA llamada a Responses (file_search hosted), se parsean los
 * tags y se guarda el outbound. El envío por Callbell + gate de `#ID` es el S4.
 *
 * Responsabilidades (S1):
 *  - Idempotencia por `callbell_message_uuid` (unique en `messages`).
 *  - Upsert de contact (get-or-create por phone).
 *  - Get-or-create de la conversación activa; actualizar `last_inbound_at`.
 *  - Guardar el mensaje inbound.
 *  - Loguear `webhook_received` en `events_log` (con el body crudo).
 *
 * Responsabilidades (S3):
 *  - Generar: 1× `responses.create` con `file_search` + `agent_config` activo.
 *  - Parsear tags (`#ID:`, `#addi`, ...) y `cleanText`; guardar el outbound y
 *    encadenar `openai_previous_response_id`. Sin enviar todavía.
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

    // --- S3: generación de la respuesta -------------------------------------

    // 6) Estado de la conversación + config activa. Si no está activa (handoff/
    //    cerrada) o no hay agent_config, no generamos (el bot calla).
    const convo = await step.run("load-conversation-state", async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("status, openai_previous_response_id")
        .eq("id", conversationId)
        .single();
      if (error) throw new Error(`load-conversation-state: ${error.message}`);
      return data;
    });

    if (convo.status !== "active") {
      return { ok: true, conversationId, generated: false, reason: `conversation ${convo.status}` };
    }

    const cfg = await step.run("load-agent-config", async () => {
      const { data, error } = await supabase
        .from("agent_config")
        .select("system_prompt, model, vector_store_id, temperature")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw new Error(`load-agent-config: ${error.message}`);
      return data;
    });

    if (!cfg) {
      await step.run("log-reply-skipped", async () => {
        await supabase.from("events_log").insert({
          conversation_id: conversationId,
          type: "reply_skipped",
          payload: { reason: "no-active-agent-config" } as unknown as Json,
        });
      });
      return { ok: true, conversationId, generated: false, reason: "no-active-agent-config" };
    }

    // 7) GENERAR: una sola llamada a Responses (file_search hosted).
    const gen = await step.run("generate-reply", async () => {
      const openai = createOpenAIClient();
      return generateReply(openai, {
        model: cfg.model,
        systemPrompt: cfg.system_prompt,
        input: text ?? "",
        vectorStoreId: cfg.vector_store_id,
        previousResponseId: convo.openai_previous_response_id,
        temperature: cfg.temperature,
      });
    });

    // 8) Parsear tags + cleanText (puro) y guardar el outbound + encadenar.
    const parsed = parseReply(gen.text);

    await step.run("save-outbound-message", async () => {
      const { error: msgErr } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        direction: "outbound",
        role: "assistant",
        type: "text",
        content: parsed.cleanText,
        tags: parsed.tags.raw as unknown as Json,
        openai_response_id: gen.responseId,
      });
      if (msgErr) throw new Error(`save-outbound-message: ${msgErr.message}`);

      const { error: updErr } = await supabase
        .from("conversations")
        .update({ openai_previous_response_id: gen.responseId })
        .eq("id", conversationId);
      if (updErr) throw new Error(`update previous_response_id: ${updErr.message}`);
    });

    // 9) LOG: respuesta generada (los #ID se validan/ envían en el S4).
    await step.run("log-reply-generated", async () => {
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "reply_generated",
        payload: {
          responseId: gen.responseId,
          skus: parsed.tags.skus,
          tags: parsed.tags.raw,
        } as unknown as Json,
      });
    });

    return {
      ok: true,
      conversationId,
      contactId,
      messageUuid,
      generated: true,
      responseId: gen.responseId,
      skus: parsed.tags.skus,
    };
  },
);
