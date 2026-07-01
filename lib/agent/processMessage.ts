import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase/server";
import { createOpenAIClient } from "@/lib/openai/client";
import { generateReply } from "@/lib/openai/responses";
import { parseReply } from "@/lib/agent/tags";
import { applyGate } from "@/lib/agent/gate";
import { sendText, sendImage } from "@/lib/callbell/sender";
import { extractOrder } from "@/lib/openai/extractOrder";
import {
  buildTranscript,
  computeOrderTotal,
  normalizeOrderItem,
  resolveFulfillmentMethod,
  type TranscriptMessage,
} from "@/lib/agent/order";
import { env } from "@/lib/env";
import type { Database, Json, MessageType } from "@/lib/supabase/types";

type DB = SupabaseClient<Database>;
type ContactUpdate = Database["public"]["Tables"]["contacts"]["Update"];
type ConversationUpdate = Database["public"]["Tables"]["conversations"]["Update"];

interface ProductLookup {
  sku: string;
  image_url: string | null;
  name: string | null;
}

/** Payload normalizado que el webhook extrae del body de Callbell. */
export interface InboundMessage {
  /** Teléfono normalizado E.164 sin '+' (ej: 573001234567). */
  phone: string;
  /** UUID del mensaje en Callbell — clave de idempotencia y del debounce. */
  messageUuid: string;
  text: string | null;
  messageType: string | null;
  contactName: string | null;
  callbellContactUuid: string | null;
  conversationHref: string | null;
  /** Body crudo del webhook (trazabilidad / refinar el parser). */
  raw: unknown;
  /** epoch ms del inbound (para la ventana de 24h). */
  receivedAt: number;
}

export interface IngestResult {
  conversationId: string;
  contactId: string;
  duplicate: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mapea el `type` de Callbell a nuestro enum `message_type` de Supabase. */
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
 * FASE 1 — ingesta (síncrona, dentro del request del webhook).
 *
 * Idempotencia por `callbell_message_uuid`, get-or-create de contacto y
 * conversación, guarda el inbound y marca la conversación con el uuid del
 * mensaje MÁS reciente (`last_inbound_message_uuid`) — el "quién gana" del
 * debounce. No genera respuesta: eso es la fase 2 (`runDebouncedReply`).
 */
export async function ingestInboundMessage(msg: InboundMessage): Promise<IngestResult> {
  const {
    phone,
    messageUuid,
    text,
    messageType,
    contactName,
    callbellContactUuid,
    conversationHref,
    raw,
    receivedAt,
  } = msg;

  const supabase = createServiceClient();

  // 1) Idempotencia: si ya existe un mensaje con este uuid, no reprocesar.
  const { data: dup, error: dupErr } = await supabase
    .from("messages")
    .select("id, conversation_id")
    .eq("callbell_message_uuid", messageUuid)
    .maybeSingle();
  if (dupErr) throw new Error(`idempotency-check: ${dupErr.message}`);

  // 2) Contact: get-or-create por phone.
  let contactId: string;
  {
    const { data: existing, error: selErr } = await supabase
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (selErr) throw new Error(`upsert-contact select: ${selErr.message}`);

    if (existing) {
      const patch: ContactUpdate = {};
      if (contactName) patch.name = contactName;
      if (callbellContactUuid) patch.callbell_contact_uuid = callbellContactUuid;
      if (Object.keys(patch).length > 0) {
        const { error: updErr } = await supabase
          .from("contacts")
          .update(patch)
          .eq("id", existing.id);
        if (updErr) throw new Error(`upsert-contact update: ${updErr.message}`);
      }
      contactId = existing.id;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("contacts")
        .insert({ phone, name: contactName, callbell_contact_uuid: callbellContactUuid })
        .select("id")
        .single();
      if (insErr) throw new Error(`upsert-contact insert: ${insErr.message}`);
      contactId = inserted.id;
    }
  }

  // 3) Conversación: get-or-create la activa; actualizar last_inbound_at y el
  //    marcador del debounce (último mensaje).
  const nowIso = new Date(receivedAt).toISOString();
  let conversationId: string;
  {
    const { data: existing, error: selErr } = await supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selErr) throw new Error(`upsert-conversation select: ${selErr.message}`);

    if (existing) {
      const patch: ConversationUpdate = {
        last_inbound_at: nowIso,
        last_inbound_message_uuid: messageUuid,
      };
      if (conversationHref) patch.callbell_conversation_href = conversationHref;
      const { error: updErr } = await supabase
        .from("conversations")
        .update(patch)
        .eq("id", existing.id);
      if (updErr) throw new Error(`upsert-conversation update: ${updErr.message}`);
      conversationId = existing.id;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("conversations")
        .insert({
          contact_id: contactId,
          status: "active",
          last_inbound_at: nowIso,
          last_inbound_message_uuid: messageUuid,
          callbell_conversation_href: conversationHref,
        })
        .select("id")
        .single();
      if (insErr) throw new Error(`upsert-conversation insert: ${insErr.message}`);
      conversationId = inserted.id;
    }
  }

  // Duplicado: ya estaba guardado. Devolvemos la conversación pero sin re-guardar
  // ni re-programar respuesta.
  if (dup) {
    return { conversationId: dup.conversation_id ?? conversationId, contactId, duplicate: true };
  }

  // 4) Guardar el inbound (el unique en callbell_message_uuid respalda idempotencia).
  {
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      direction: "inbound",
      role: "user",
      type: toMessageType(messageType),
      content: text,
      callbell_message_uuid: messageUuid,
    });
    if (error) throw new Error(`save-inbound-message: ${error.message}`);
  }

  // 5) LOG: webhook_received con el body crudo.
  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "webhook_received",
    payload: { phone, messageUuid, raw } as unknown as Json,
  });

  return { conversationId, contactId, duplicate: false };
}

export interface DebounceArgs {
  conversationId: string;
  contactId: string;
  phone: string;
  /** uuid de ESTE inbound: solo respondemos si sigue siendo el último. */
  messageUuid: string;
  receivedAt: number;
}

/**
 * FASE 2 — respuesta con debounce (en background, vía `waitUntil`).
 *
 * Espera `REPLY_DEBOUNCE_MS` y luego pregunta si este mensaje sigue siendo el
 * último de la conversación. Si llegó otro después, se apaga (esa tarea
 * responderá por todos). Si sigue siendo el último, junta todos los mensajes
 * pendientes y responde en UNA sola llamada a Responses.
 */
export async function runDebouncedReply(args: DebounceArgs): Promise<void> {
  const { conversationId, contactId, phone, messageUuid, receivedAt } = args;

  await sleep(env.REPLY_DEBOUNCE_MS);

  const supabase = createServiceClient();
  try {
    // Estado + "quién gana": ¿sigo siendo el último inbound?
    const { data: convo, error: convoErr } = await supabase
      .from("conversations")
      .select("status, last_inbound_message_uuid, openai_previous_response_id, last_inbound_at")
      .eq("id", conversationId)
      .single();
    if (convoErr) throw new Error(`load-conversation-state: ${convoErr.message}`);

    // Llegó otro mensaje después → esa tarea responderá por el lote. Me apago.
    if (convo.last_inbound_message_uuid !== messageUuid) return;

    // Conversación cerrada / handoff → el bot no responde.
    if (convo.status !== "active") return;

    const { data: cfg, error: cfgErr } = await supabase
      .from("agent_config")
      .select("system_prompt, model, vector_store_id, temperature")
      .eq("is_active", true)
      .maybeSingle();
    if (cfgErr) throw new Error(`load-agent-config: ${cfgErr.message}`);

    if (!cfg) {
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "reply_skipped",
        payload: { reason: "no-active-agent-config" } as unknown as Json,
      });
      return;
    }

    // Juntar los mensajes pendientes (inbound desde la última respuesta) en un
    // solo turno. `previous_response_id` aporta el contexto previo.
    const input = await gatherPendingInput(supabase, conversationId);
    if (input.length === 0) return; // nada de texto que responder (p.ej. solo media)

    const openai = createOpenAIClient();
    await generateAndSend({
      supabase,
      openai,
      conversationId,
      contactId,
      phone,
      receivedAt,
      previousResponseId: convo.openai_previous_response_id,
      lastInboundAt: convo.last_inbound_at,
      cfg,
      input,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[runDebouncedReply] failed:", message);
    await supabase
      .from("events_log")
      .insert({
        conversation_id: conversationId,
        type: "process_error",
        payload: { phase: "reply", messageUuid, error: message } as unknown as Json,
      })
      .then(() => undefined, () => undefined);
  }
}

/** Junta los inbound sin responder (posteriores a la última respuesta) en un turno. */
async function gatherPendingInput(supabase: DB, conversationId: string): Promise<string> {
  const { data: lastOut } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let q = supabase
    .from("messages")
    .select("content, created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: true });
  if (lastOut?.created_at) q = q.gt("created_at", lastOut.created_at);

  const { data, error } = await q;
  if (error) throw new Error(`gather-pending-input: ${error.message}`);
  return (data ?? [])
    .map((m) => (m.content ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n");
}

interface GenerateContext {
  supabase: DB;
  openai: OpenAI;
  conversationId: string;
  contactId: string;
  phone: string;
  receivedAt: number;
  previousResponseId: string | null;
  lastInboundAt: string | null;
  cfg: {
    system_prompt: string;
    model: string;
    vector_store_id: string | null;
    temperature: number;
  };
  input: string;
}

/**
 * Generar (1× Responses) → parsear tags → gate → enviar por Callbell → S5
 * (método/orden/handoff). El envío de imágenes de los `#ID` válidos depende de
 * que el SKU exista en `products`.
 */
async function generateAndSend(ctx: GenerateContext): Promise<void> {
  const {
    supabase,
    openai,
    conversationId,
    contactId,
    phone,
    receivedAt,
    previousResponseId,
    lastInboundAt,
    cfg,
    input,
  } = ctx;

  // GENERAR: una sola llamada a Responses (file_search hosted). El vector store
  // sale de agent_config o, si no, de OPENAI_VECTOR_STORE_ID.
  const gen = await generateReply(openai, {
    model: cfg.model,
    systemPrompt: cfg.system_prompt,
    input,
    vectorStoreId: cfg.vector_store_id ?? env.OPENAI_VECTOR_STORE_ID ?? null,
    previousResponseId,
    temperature: cfg.temperature,
  });

  // Parsear tags + cleanText (puro) y guardar el outbound + encadenar.
  const parsed = parseReply(gen.text);

  const { data: outbound, error: outErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      role: "assistant",
      type: "text",
      content: parsed.cleanText,
      tags: parsed.tags.raw as unknown as Json,
      openai_response_id: gen.responseId,
    })
    .select("id")
    .single();
  if (outErr) throw new Error(`save-outbound-message: ${outErr.message}`);
  const outboundMessageId = outbound.id;

  {
    const { error: updErr } = await supabase
      .from("conversations")
      .update({ openai_previous_response_id: gen.responseId })
      .eq("id", conversationId);
    if (updErr) throw new Error(`update previous_response_id: ${updErr.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "reply_generated",
    payload: {
      responseId: gen.responseId,
      skus: parsed.tags.skus,
      tags: parsed.tags.raw,
      usage: gen.usage, // tokens para el KPI de costo del dashboard
    } as unknown as Json,
  });

  // --- S4: gate + envío por Callbell --------------------------------------
  let found: ProductLookup[] = [];
  if (parsed.tags.skus.length > 0) {
    const { data, error } = await supabase
      .from("products")
      .select("sku, image_url, name")
      .in("sku", parsed.tags.skus);
    if (error) throw new Error(`load-products-for-skus: ${error.message}`);
    found = data as ProductLookup[];
  }

  const productBySku = new Map(found.map((p) => [p.sku, p]));
  const gate = applyGate(parsed.tags.skus, productBySku.keys(), lastInboundAt, receivedAt);

  if (gate.blockedSkus.length > 0) {
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "gate_blocked",
      payload: { blockedSkus: gate.blockedSkus } as unknown as Json,
    });
  }

  // Fuera de ventana de 24h: no se envía (requeriría template). Se registra.
  if (!gate.withinWindow) {
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "out_of_window",
      payload: { lastInboundAt } as unknown as Json,
    });
    return;
  }

  // --- S5: flujos de compra + handoff -------------------------------------
  const isHandoff = parsed.tags.ordenLista || parsed.tags.humano;

  // #addi / #compra-contra-entrega → fijar el método en la conversación.
  if (parsed.tags.addi || parsed.tags.cod) {
    await supabase
      .from("conversations")
      .update({ fulfillment_method: parsed.tags.addi ? "addi" : "cod" })
      .eq("id", conversationId);
  }

  // #orden-lista → extraer la orden (completion aparte) y crearla antes del handoff.
  let orderId: string | null = null;
  if (parsed.tags.ordenLista) {
    const { data: msgs, error: msgsErr } = await supabase
      .from("messages")
      .select("direction, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(40);
    if (msgsErr) throw new Error(`create-order load messages: ${msgsErr.message}`);

    const transcript = buildTranscript((msgs ?? []) as TranscriptMessage[]);
    const draft = await extractOrder(openai, transcript, cfg.model);

    const { data: convRow } = await supabase
      .from("conversations")
      .select("fulfillment_method")
      .eq("id", conversationId)
      .single();
    const method = resolveFulfillmentMethod(
      convRow?.fulfillment_method ?? "undecided",
      draft.fulfillment_method,
    );
    const total = draft.total ?? computeOrderTotal(draft.items);

    const { data: order, error: ordErr } = await supabase
      .from("orders")
      .insert({
        conversation_id: conversationId,
        contact_id: contactId,
        status: "pending_handoff",
        fulfillment_method: method,
        shipping_name: draft.shipping.name,
        shipping_address: draft.shipping.address,
        shipping_city: draft.shipping.city,
        shipping_phone: draft.shipping.phone,
        notes: draft.notes,
        total,
      })
      .select("id")
      .single();
    if (ordErr) throw new Error(`create-order insert: ${ordErr.message}`);
    orderId = order.id;

    if (draft.items.length > 0) {
      const rows = draft.items.map((it) => {
        const n = normalizeOrderItem(it);
        return {
          order_id: order.id,
          sku: n.sku,
          name: n.name,
          qty: n.qty,
          unit_price: n.unit_price,
        };
      });
      const { error: itErr } = await supabase.from("order_items").insert(rows);
      if (itErr) throw new Error(`create-order items: ${itErr.message}`);
    }

    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "order_created",
      payload: { orderId: order.id, method, items: draft.items.length, total } as unknown as Json,
    });
  }

  // Texto del agente. En handoff va con team_uuid + bot_end (reasigna + apaga bot).
  const textToSend =
    parsed.cleanText.length > 0
      ? parsed.cleanText
      : isHandoff
        ? "¡Listo! Te paso con el equipo que confirma tu pedido y la entrega."
        : "";

  const meta = { metadata: { conversation_id: conversationId } };

  if (isHandoff) {
    // Handoff: solo texto (reasigna + apaga el bot). Sin imágenes: se cierra.
    if (textToSend.length > 0) {
      const sent = await sendText(phone, textToSend, {
        ...meta,
        teamUuid: env.CALLBELL_LOGISTICS_TEAM_UUID,
        botStatus: "bot_end",
      });
      await supabase
        .from("messages")
        .update({ callbell_message_uuid: sent.uuid })
        .eq("id", outboundMessageId);
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "text_sent",
        payload: { uuid: sent.uuid, status: sent.status } as unknown as Json,
      });
    }
  } else {
    // Imágenes válidas (SKU existe en `products` y tiene image_url).
    const validImages: Array<{ sku: string; imageUrl: string; name: string | null }> = [];
    for (const sku of gate.validSkus) {
      const product = productBySku.get(sku);
      if (!product?.image_url) {
        await supabase.from("events_log").insert({
          conversation_id: conversationId,
          type: "image_missing",
          payload: { sku } as unknown as Json,
        });
        continue;
      }
      validImages.push({ sku, imageUrl: product.image_url, name: product.name ?? null });
    }

    // Caption de WhatsApp: límite ~1024 chars. Si el texto cabe, va JUNTO con la
    // primera imagen (una sola llamada a Callbell = un mensaje con foto + texto).
    // Si el texto es muy largo o no hay imagen, van por separado.
    const CAPTION_MAX = 1024;
    const combine =
      validImages.length > 0 && textToSend.length > 0 && textToSend.length <= CAPTION_MAX;

    if (combine) {
      const [first, ...rest] = validImages;
      // La primera imagen lleva el texto como caption → reutilizamos el mensaje
      // outbound (que ya guardaba el texto) marcándolo como imagen.
      const sent = await sendImage(phone, first.imageUrl, textToSend, meta);
      await supabase
        .from("messages")
        .update({ type: "image", media_url: first.imageUrl, callbell_message_uuid: sent.uuid })
        .eq("id", outboundMessageId);
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "image_sent",
        payload: {
          sku: first.sku,
          uuid: sent.uuid,
          status: sent.status,
          withCaption: true,
        } as unknown as Json,
      });
      // Imágenes adicionales: mensajes aparte con el nombre del producto.
      for (const img of rest) {
        await sendProductImage(supabase, conversationId, phone, img, meta);
      }
    } else {
      // Texto (si hay) como su propio mensaje.
      if (textToSend.length > 0) {
        const sent = await sendText(phone, textToSend, meta);
        await supabase
          .from("messages")
          .update({ callbell_message_uuid: sent.uuid })
          .eq("id", outboundMessageId);
        await supabase.from("events_log").insert({
          conversation_id: conversationId,
          type: "text_sent",
          payload: { uuid: sent.uuid, status: sent.status } as unknown as Json,
        });
      }
      // Imágenes por separado (con el nombre del producto como caption).
      for (const img of validImages) {
        await sendProductImage(supabase, conversationId, phone, img, meta);
      }
    }

    // #addi → enviar el link/instrucciones si está configurado (v1 sin API Addi).
    if (parsed.tags.addi && env.ADDI_LINK) {
      const addiLink = env.ADDI_LINK;
      const sent = await sendText(
        phone,
        `Puedes financiar tu compra con Addi aquí: ${addiLink}`,
        meta,
      );
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "addi_info_sent",
        payload: { uuid: sent.uuid } as unknown as Json,
      });
    }
  }

  // Handoff: apagar el bot en nuestra DB y cerrar la orden.
  if (isHandoff) {
    await supabase
      .from("conversations")
      .update({
        status: "handed_off",
        assigned_team_uuid: env.CALLBELL_LOGISTICS_TEAM_UUID ?? null,
      })
      .eq("id", conversationId);
    if (orderId) {
      await supabase.from("orders").update({ status: "handed_off" }).eq("id", orderId);
    }
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "handoff",
      payload: {
        reason: parsed.tags.ordenLista ? "orden-lista" : "humano",
        orderId,
      } as unknown as Json,
    });
  }
}

/**
 * Envía UNA imagen de producto en su propio mensaje (con el nombre como caption),
 * guarda la fila `messages` (type image) y loguea `image_sent`. Se usa para las
 * imágenes adicionales cuando hay varios `#ID` (la primera va junto al texto).
 */
async function sendProductImage(
  supabase: DB,
  conversationId: string,
  phone: string,
  img: { sku: string; imageUrl: string; name: string | null },
  opts: { metadata?: Record<string, unknown> },
): Promise<void> {
  const sent = await sendImage(phone, img.imageUrl, img.name, opts);
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    role: "assistant",
    type: "image",
    content: img.name,
    media_url: img.imageUrl,
    tags: [img.sku] as unknown as Json,
    callbell_message_uuid: sent.uuid,
  });
  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "image_sent",
    payload: { sku: img.sku, uuid: sent.uuid, status: sent.status } as unknown as Json,
  });
}
