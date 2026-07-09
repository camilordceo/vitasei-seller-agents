import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { sendTemplate, credsFromEnv } from "@/lib/callbell/sender";
import {
  loadAgentForConversation,
  agentCallbellCreds,
  agentReactivationSettings,
  loadAgentReactivationSettings,
  loadReactivationImages,
} from "@/lib/agent/agents";
import { isAgentActiveNow } from "@/lib/agent/schedule";
import { evaluateReactivation, planReactivations } from "@/lib/agent/reactivationPlan";
import { env } from "@/lib/env";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Reactivaciones por plantilla (ver ADR-0021, docs/14). El ON/OFF y los UUID de
 * plantilla son POR AGENTE (columnas en `agents`): la plantilla solo existe en la
 * cuenta de Callbell de ese agente. Ver ADR-0030.
 *
 * Cuando llega un cliente por primera vez (nueva conversación) y el agente tiene
 * las reactivaciones ENCENDIDAS, se agendan dos envíos: a 7 y 15 días. El cron
 * toma los vencidos y, si la persona no compró, sigue inactiva y el agente está
 * DENTRO de su horario, envía la plantilla aprobada por Callbell (único envío
 * permitido fuera de la ventana de 24h). Se cancelan si crea una orden (compra) y
 * se APLAZAN si el agente está fuera de horario (ADR-0029).
 */

type DB = SupabaseClient<Database>;

/** Costo estimado de cada plantilla enviada (control de costos del dashboard). */
export const REACTIVATION_COST_USD = 0.015;

// --- Agendar / cancelar -----------------------------------------------------

export interface ScheduleReactivationArgs {
  conversationId: string;
  contactId: string;
  phone: string;
  /** Agente dueño de la conversación (define si las reactivaciones están ON). */
  agentId: string;
  /** epoch ms desde el que se cuentan los delays (creación de la conversación). */
  fromMs: number;
}

/**
 * Agenda las reactivaciones (7 y 15 días) de una conversación nueva. Solo si el
 * AGENTE tiene el feature encendido. Best-effort: el llamador debe envolverlo para
 * que un fallo aquí NUNCA rompa la ingesta.
 */
export async function scheduleReactivations(
  supabase: DB,
  args: ScheduleReactivationArgs,
): Promise<void> {
  const settings = await loadAgentReactivationSettings(supabase, args.agentId);
  if (!settings?.enabled) return;

  const plan = planReactivations(
    args.fromMs,
    env.REACTIVATION_STAGE1_MS,
    env.REACTIVATION_STAGE2_MS,
  );
  const rows = plan.map((p) => ({
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    phone: args.phone,
    stage: p.stage,
    status: "scheduled" as const,
    scheduled_at: p.scheduledAt,
  }));

  const { error } = await supabase.from("reactivations").insert(rows);
  if (error) throw new Error(`schedule-reactivations: ${error.message}`);
}

/** Marca como `cancelled` las reactivaciones aún agendadas de una conversación. */
export async function cancelScheduledReactivations(
  supabase: DB,
  conversationId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("reactivations")
    .update({ status: "cancelled", error: reason })
    .eq("conversation_id", conversationId)
    .eq("status", "scheduled");
  if (error) throw new Error(`cancel-reactivations: ${error.message}`);
}

// --- Worker del cron --------------------------------------------------------

export interface ReactivationRunStats {
  processed: number;
  sent: number;
  cancelled: number;
  skipped: number;
  deferred: number;
  failed: number;
}

/**
 * Procesa las reactivaciones vencidas (`scheduled` y `scheduled_at <= now`). El
 * ON/OFF es por agente y se evalúa por fila (vía el agente de la conversación). Si
 * el agente está fuera de horario, la fila se APLAZA (vuelve a `scheduled`). Claim
 * atómico (`scheduled` → `processing`) contra doble envío por cron solapado.
 */
export async function runDueReactivations(opts?: {
  limit?: number;
  nowMs?: number;
}): Promise<ReactivationRunStats> {
  const stats: ReactivationRunStats = {
    processed: 0,
    sent: 0,
    cancelled: 0,
    skipped: 0,
    deferred: 0,
    failed: 0,
  };

  const supabase = createServiceClient();

  const now = opts?.nowMs ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const limit = opts?.limit ?? 50;

  const { data: due, error } = await supabase
    .from("reactivations")
    .select("id, conversation_id, contact_id, phone, stage, scheduled_at")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`load-due-reactivations: ${error.message}`);
  if (!due || due.length === 0) return stats;

  for (const row of due) {
    const { data: claimed, error: claimErr } = await supabase
      .from("reactivations")
      .update({ status: "processing" })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) continue; // otra ejecución lo tomó

    stats.processed++;
    try {
      const outcome = await processReactivationRow(supabase, row, now);
      stats[outcome]++;
    } catch (e) {
      stats.failed++;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[runDueReactivations] failed:", message);
      await supabase
        .from("reactivations")
        .update({ status: "failed", error: message.slice(0, 300) })
        .eq("id", row.id);
      await supabase
        .from("events_log")
        .insert({
          conversation_id: row.conversation_id,
          type: "reactivation_error",
          payload: { reactivationId: row.id, stage: row.stage, error: message } as unknown as Json,
        })
        .then(() => undefined, () => undefined);
    }
  }

  return stats;
}

interface DueReactivation {
  id: string;
  conversation_id: string;
  contact_id: string;
  phone: string;
  stage: number;
  scheduled_at: string;
}

/** Evalúa las guardas y, si procede, envía la plantilla. Devuelve el desenlace. */
async function processReactivationRow(
  supabase: DB,
  row: DueReactivation,
  now: number,
): Promise<"sent" | "cancelled" | "skipped" | "deferred"> {
  // ¿Compró? (orden no cancelada en la conversación)
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id")
    .eq("conversation_id", row.conversation_id)
    .neq("status", "cancelled")
    .limit(1)
    .maybeSingle();
  if (orderErr) throw new Error(`load-order: ${orderErr.message}`);
  const converted = !!order;

  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("last_inbound_at, agent_id")
    .eq("id", row.conversation_id)
    .single();
  if (convoErr) throw new Error(`load-conversation: ${convoErr.message}`);

  // Agente de la conversación: define ON/OFF, plantillas, credenciales y horario.
  const agent = await loadAgentForConversation(supabase, convo.agent_id);

  // Fuera de horario y sin compra → APLAZAR (revertir a `scheduled`) para reintentar
  // cuando el agente vuelva a estar activo (acotado por STALE_MS). Ver ADR-0029.
  if (!converted && agent && !isAgentActiveNow(agent)) {
    await supabase.from("reactivations").update({ status: "scheduled" }).eq("id", row.id);
    await supabase.from("events_log").insert({
      conversation_id: row.conversation_id,
      type: "reactivation_deferred",
      payload: { reactivationId: row.id, stage: row.stage, reason: "agent-inactive" } as unknown as Json,
    });
    return "deferred";
  }

  const settings = agent
    ? agentReactivationSettings(agent)
    : { enabled: false, template7d: null, template15d: null };
  const templateUuid = row.stage === 1 ? settings.template7d : settings.template15d;

  const decision = evaluateReactivation({
    converted,
    // Requiere que el agente tenga reactivaciones ON y la plantilla de la etapa.
    templateConfigured: settings.enabled && !!templateUuid,
    lastInboundAt: convo.last_inbound_at,
    scheduledAt: row.scheduled_at,
    now,
  });

  if (decision.action !== "send") {
    const status = decision.action === "cancel" ? "cancelled" : "skipped";
    await supabase
      .from("reactivations")
      .update({ status, error: decision.reason })
      .eq("id", row.id);
    await supabase.from("events_log").insert({
      conversation_id: row.conversation_id,
      type: status === "cancelled" ? "reactivation_cancelled" : "reactivation_skipped",
      payload: {
        reactivationId: row.id,
        stage: row.stage,
        reason: decision.reason,
      } as unknown as Json,
    });
    return status;
  }

  // Nombre del contacto por si la plantilla usa una variable de nombre.
  const { data: contact } = await supabase
    .from("contacts")
    .select("name")
    .eq("id", row.contact_id)
    .maybeSingle();
  const firstName = (contact?.name ?? "").trim().split(/\s+/)[0] ?? "";

  // Credenciales de Callbell del agente (cuenta/canal). La plantilla debe existir
  // en esa cuenta. Fallback a env si no hay agente (datos legados).
  const creds = agent ? agentCallbellCreds(agent) : credsFromEnv();

  // Header de imagen de la plantilla de esta etapa (si el agente configuró una).
  // Consulta aparte y resiliente (no en AGENT_COLS): sin imagen → plantilla de solo
  // texto (comportamiento actual). El payload a Callbell cambia según esto. Ver ADR-0044.
  const images = agent
    ? await loadReactivationImages(supabase, agent.id)
    : { image7d: null, image15d: null };
  const imageUrl = row.stage === 1 ? images.image7d : images.image15d;

  const sent = await sendTemplate(creds, row.phone, templateUuid as string, {
    text: firstName,
    imageUrl,
    metadata: { conversation_id: row.conversation_id, reactivation_stage: row.stage },
  });

  // Registrar el outbound para que se vea en el hilo. Si la plantilla lleva imagen,
  // se guarda como `image` con su URL para que el hilo la muestre.
  await supabase.from("messages").insert({
    conversation_id: row.conversation_id,
    direction: "outbound",
    role: "assistant",
    type: imageUrl ? "image" : "text",
    content: `Plantilla de reactivación (día ${row.stage === 1 ? 7 : 15})${imageUrl ? " · con imagen" : ""}`,
    media_url: imageUrl,
    tags: [`reactivacion-${row.stage}`] as unknown as Json,
    callbell_message_uuid: sent.uuid,
  });

  await supabase
    .from("reactivations")
    .update({
      status: "sent",
      sent_at: new Date(now).toISOString(),
      template_uuid: templateUuid,
      cost_usd: REACTIVATION_COST_USD,
    })
    .eq("id", row.id);

  await supabase.from("events_log").insert({
    conversation_id: row.conversation_id,
    type: "reactivation_sent",
    payload: {
      reactivationId: row.id,
      stage: row.stage,
      uuid: sent.uuid,
      status: sent.status,
      costUsd: REACTIVATION_COST_USD,
      hasImage: !!imageUrl,
    } as unknown as Json,
  });

  return "sent";
}
