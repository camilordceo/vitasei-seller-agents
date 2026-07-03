import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase/server";
import { createOpenAIClient } from "@/lib/openai/client";
import { generateReply } from "@/lib/openai/responses";
import { parseReply } from "@/lib/agent/tags";
import { applyGate } from "@/lib/agent/gate";
import { sendText, sendImage, type CallbellCreds } from "@/lib/callbell/sender";
import {
  loadAgentForConversation,
  agentCallbellCreds,
  agentVectorStoreId,
  type Agent,
} from "@/lib/agent/agents";
import {
  buildRetargetInstruction,
  evaluateRetarget,
  planRetargets,
  type RetargetStage,
} from "@/lib/agent/retargetPlan";
import { env } from "@/lib/env";
import type { Database, Json } from "@/lib/supabase/types";

// Re-export de la lógica pura para no cambiar los imports desde `retarget.ts`.
export {
  buildRetargetInstruction,
  evaluateRetarget,
  planRetargets,
  type RetargetStage,
  type RetargetDecision,
  type StagePlan,
} from "@/lib/agent/retargetPlan";

/**
 * Retargeting — seguimientos automáticos (ver ADR-0017).
 *
 * Cuando el bot responde y el cliente deja de responder, agendamos dos
 * seguimientos (etapa 1 ≈ 1h, etapa 2 ≈ 8h). Un cron toma los vencidos y, si la
 * conversación sigue activa y el cliente no respondió, genera un mensaje de
 * seguimiento DINÁMICO con Responses encadenando `previous_response_id` (así el
 * modelo tiene todo el contexto) y lo envía. La instrucción le pide retomar la
 * conversación SIN revelar que es un seguimiento automático.
 *
 * Es una IA simple: una sola llamada a Responses por seguimiento (igual que el
 * flujo normal). El mismo gate anti-alucinación (`#ID` debe existir en
 * `products`) y la ventana de 24h aplican.
 */

type DB = SupabaseClient<Database>;

interface ProductLookup {
  sku: string;
  image_url: string | null;
  name: string | null;
}

// --- Agendar / cancelar (llamado desde el flujo de respuesta) ---------------

export interface ScheduleArgs {
  conversationId: string;
  contactId: string;
  phone: string;
  /** `last_inbound_at` de la conversación al agendar (ancla anti-obsolescencia). */
  anchorInboundAt: string | null;
  /** epoch ms desde el que se cuentan los delays (normalmente ahora). */
  fromMs: number;
}

/**
 * Cancela los seguimientos vivos previos y agenda los de esta respuesta.
 * Best-effort: el llamador debe envolverlo para que un fallo aquí NUNCA rompa
 * la respuesta al cliente.
 */
export async function scheduleRetargets(supabase: DB, args: ScheduleArgs): Promise<void> {
  if (!env.RETARGET_ENABLED) return;

  // Los previos (de una respuesta anterior a la misma ráfaga) quedan obsoletos.
  await cancelScheduledRetargets(supabase, args.conversationId, "rescheduled");

  const plan = planRetargets(args.fromMs, env.RETARGET_STAGE1_MS, env.RETARGET_STAGE2_MS);
  const rows = plan.map((p) => ({
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    phone: args.phone,
    stage: p.stage,
    status: "scheduled" as const,
    scheduled_at: p.scheduledAt,
    anchor_inbound_at: args.anchorInboundAt,
  }));

  const { error } = await supabase.from("retargets").insert(rows);
  if (error) throw new Error(`schedule-retargets: ${error.message}`);
}

/** Marca como `cancelled` los seguimientos aún agendados de una conversación. */
export async function cancelScheduledRetargets(
  supabase: DB,
  conversationId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("retargets")
    .update({ status: "cancelled", error: reason })
    .eq("conversation_id", conversationId)
    .eq("status", "scheduled");
  if (error) throw new Error(`cancel-retargets: ${error.message}`);
}

// --- Worker del cron --------------------------------------------------------

export interface RunStats {
  processed: number;
  sent: number;
  cancelled: number;
  skipped: number;
  failed: number;
}

/**
 * Procesa los seguimientos vencidos (`scheduled` y `scheduled_at <= now`).
 * Lo llama el endpoint del cron (`/api/cron/retargets`). Cada fila se toma con un
 * claim atómico (`scheduled` → `processing`) para no enviar dos veces si dos
 * ejecuciones del cron se solapan.
 */
export async function runDueRetargets(opts?: {
  limit?: number;
  nowMs?: number;
}): Promise<RunStats> {
  const stats: RunStats = { processed: 0, sent: 0, cancelled: 0, skipped: 0, failed: 0 };
  if (!env.RETARGET_ENABLED) return stats;

  const supabase = createServiceClient();
  const now = opts?.nowMs ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const limit = opts?.limit ?? 50;

  const { data: due, error } = await supabase
    .from("retargets")
    .select("id, conversation_id, contact_id, phone, stage, anchor_inbound_at")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`load-due-retargets: ${error.message}`);
  if (!due || due.length === 0) return stats;

  const openai = createOpenAIClient();

  for (const row of due) {
    // Claim atómico: solo lo toma quien logra pasarlo de scheduled → processing.
    const { data: claimed, error: claimErr } = await supabase
      .from("retargets")
      .update({ status: "processing" })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) continue; // otra ejecución lo tomó

    stats.processed++;
    try {
      const outcome = await processRetargetRow(supabase, openai, row, now);
      stats[outcome]++;
    } catch (e) {
      stats.failed++;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[runDueRetargets] retarget failed:", message);
      await supabase
        .from("retargets")
        .update({ status: "failed", error: message.slice(0, 300) })
        .eq("id", row.id);
      await supabase
        .from("events_log")
        .insert({
          conversation_id: row.conversation_id,
          type: "retarget_error",
          payload: { retargetId: row.id, stage: row.stage, error: message } as unknown as Json,
        })
        .then(() => undefined, () => undefined);
    }
  }

  return stats;
}

interface DueRow {
  id: string;
  conversation_id: string;
  contact_id: string;
  phone: string;
  stage: number;
  anchor_inbound_at: string | null;
}

/** Evalúa las guardas y, si procede, genera+envía. Devuelve el desenlace. */
async function processRetargetRow(
  supabase: DB,
  openai: OpenAI,
  row: DueRow,
  now: number,
): Promise<"sent" | "cancelled" | "skipped"> {
  const { data: convo, error } = await supabase
    .from("conversations")
    .select("status, ai_paused, agent_id, last_inbound_at, openai_previous_response_id")
    .eq("id", row.conversation_id)
    .single();
  if (error) throw new Error(`load-conversation: ${error.message}`);

  const decision = evaluateRetarget({
    status: convo.status,
    aiPaused: convo.ai_paused,
    lastInboundAt: convo.last_inbound_at,
    anchorInboundAt: row.anchor_inbound_at,
    previousResponseId: convo.openai_previous_response_id,
    now,
  });

  if (decision.action !== "send") {
    const status = decision.action === "cancel" ? "cancelled" : "skipped";
    await supabase.from("retargets").update({ status, error: decision.reason }).eq("id", row.id);
    await supabase.from("events_log").insert({
      conversation_id: row.conversation_id,
      type: status === "cancelled" ? "retarget_cancelled" : "retarget_skipped",
      payload: { retargetId: row.id, stage: row.stage, reason: decision.reason } as unknown as Json,
    });
    return status;
  }

  const agent = await loadAgentForConversation(supabase, convo.agent_id);
  if (!agent) {
    await supabase
      .from("retargets")
      .update({ status: "skipped", error: "no-agent" })
      .eq("id", row.id);
    await supabase.from("events_log").insert({
      conversation_id: row.conversation_id,
      type: "retarget_skipped",
      payload: { retargetId: row.id, stage: row.stage, reason: "no-agent" } as unknown as Json,
    });
    return "skipped";
  }

  return sendRetargetMessage(supabase, openai, {
    row,
    agent,
    previousResponseId: convo.openai_previous_response_id as string,
    lastInboundAt: convo.last_inbound_at,
    now,
  });
}

interface SendCtx {
  row: DueRow;
  agent: Agent;
  previousResponseId: string;
  lastInboundAt: string | null;
  now: number;
}

/**
 * Genera el seguimiento dinámico (1× Responses, encadenado) → parsea tags →
 * gate de `#ID` → envía texto + imágenes de producto por Callbell → guarda el
 * outbound, encadena `previous_response_id` y marca el seguimiento como `sent`.
 * Los tags de flujo (#orden-lista/#humano/#addi/#cod) se quitan del texto y NO
 * se accionan: un seguimiento solo retoma la charla (ver ADR-0017).
 */
async function sendRetargetMessage(
  supabase: DB,
  openai: OpenAI,
  ctx: SendCtx,
): Promise<"sent" | "skipped"> {
  const { row, agent, previousResponseId, lastInboundAt, now } = ctx;
  const creds = agentCallbellCreds(agent);

  const gen = await generateReply(openai, {
    model: agent.model,
    systemPrompt: agent.system_prompt,
    input: buildRetargetInstruction(row.stage as RetargetStage),
    vectorStoreId: agentVectorStoreId(agent),
    previousResponseId,
    temperature: agent.temperature,
    maxNumResults: env.FILE_SEARCH_MAX_RESULTS,
  });

  const parsed = parseReply(gen.text);
  const textToSend = parsed.cleanText;

  // Gate anti-alucinación de `#ID` (mismo criterio que el flujo normal).
  let found: ProductLookup[] = [];
  if (parsed.tags.skus.length > 0) {
    const { data, error } = await supabase
      .from("products")
      .select("sku, image_url, name")
      .eq("agent_id", agent.id) // catálogo por marca
      .in("sku", parsed.tags.skus);
    if (error) throw new Error(`load-products-for-skus: ${error.message}`);
    found = data as ProductLookup[];
  }
  const productBySku = new Map(found.map((p) => [p.sku, p]));
  const gate = applyGate(parsed.tags.skus, productBySku.keys(), lastInboundAt, now);

  const validImages: Array<{ sku: string; imageUrl: string; name: string | null }> = [];
  for (const sku of gate.validSkus) {
    const product = productBySku.get(sku);
    if (product?.image_url) {
      validImages.push({ sku, imageUrl: product.image_url, name: product.name ?? null });
    }
  }

  // El modelo no produjo nada enviable: no mandamos un mensaje vacío.
  if (textToSend.length === 0 && validImages.length === 0) {
    await supabase
      .from("retargets")
      .update({ status: "skipped", error: "empty-generation" })
      .eq("id", row.id);
    await supabase.from("events_log").insert({
      conversation_id: row.conversation_id,
      type: "retarget_skipped",
      payload: { retargetId: row.id, stage: row.stage, reason: "empty-generation" } as unknown as Json,
    });
    return "skipped";
  }

  // Guardar el outbound (encadena el hilo) marcándolo como seguimiento.
  const { data: outbound, error: outErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: row.conversation_id,
      direction: "outbound",
      role: "assistant",
      type: "text",
      content: textToSend,
      tags: [...parsed.tags.raw, `#retarget-${row.stage}`] as unknown as Json,
      openai_response_id: gen.responseId,
    })
    .select("id")
    .single();
  if (outErr) throw new Error(`save-outbound-message: ${outErr.message}`);
  const outboundMessageId = outbound.id;

  await supabase
    .from("conversations")
    .update({ openai_previous_response_id: gen.responseId })
    .eq("id", row.conversation_id);

  const meta = { metadata: { conversation_id: row.conversation_id } };
  const CAPTION_MAX = 1024;
  const combine =
    validImages.length > 0 && textToSend.length > 0 && textToSend.length <= CAPTION_MAX;

  if (combine) {
    const [first, ...rest] = validImages;
    const sent = await sendImage(creds, row.phone, first.imageUrl, textToSend, meta);
    await supabase
      .from("messages")
      .update({ type: "image", media_url: first.imageUrl, callbell_message_uuid: sent.uuid })
      .eq("id", outboundMessageId);
    for (const img of rest) {
      await sendRetargetImage(supabase, creds, row.conversation_id, row.phone, img, meta);
    }
  } else {
    if (textToSend.length > 0) {
      const sent = await sendText(creds, row.phone, textToSend, meta);
      await supabase
        .from("messages")
        .update({ callbell_message_uuid: sent.uuid })
        .eq("id", outboundMessageId);
    }
    for (const img of validImages) {
      await sendRetargetImage(supabase, creds, row.conversation_id, row.phone, img, meta);
    }
  }

  await supabase
    .from("retargets")
    .update({ status: "sent", sent_at: new Date(now).toISOString() })
    .eq("id", row.id);

  await supabase.from("events_log").insert({
    conversation_id: row.conversation_id,
    type: "retarget_sent",
    payload: {
      retargetId: row.id,
      stage: row.stage,
      responseId: gen.responseId,
      skus: parsed.tags.skus,
      blockedSkus: gate.blockedSkus,
      usage: gen.usage,
    } as unknown as Json,
  });

  return "sent";
}

/** Envía UNA imagen de producto en su propio mensaje (nombre como caption). */
async function sendRetargetImage(
  supabase: DB,
  creds: CallbellCreds,
  conversationId: string,
  phone: string,
  img: { sku: string; imageUrl: string; name: string | null },
  opts: { metadata?: Record<string, unknown> },
): Promise<void> {
  const sent = await sendImage(creds, phone, img.imageUrl, img.name, opts);
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
    payload: { sku: img.sku, uuid: sent.uuid, status: sent.status, retarget: true } as unknown as Json,
  });
}
