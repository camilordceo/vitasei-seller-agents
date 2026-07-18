import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { isAgentActiveNow } from "@/lib/agent/schedule";
import {
  getCall,
  placeCall,
  type SynthflowCreds,
} from "@/lib/synthflow/client";
import { callCostUsd } from "@/lib/synthflow/pricing";
import type { NormalizedCall } from "@/lib/synthflow/types";
import type { Json } from "@/lib/supabase/types";
import {
  buildCallNote,
  buildCallPrompt,
  evaluateVoiceCall,
  parseVoiceConfig,
  parseVoiceCountries,
  phoneAllowed,
  planVoiceCalls,
  toE164,
} from "@/lib/agent/voiceCallPlan";

/**
 * Motor de las llamadas con IA (Synthflow). Ver docs/25 y ADR-0060..0063.
 *
 * Clona la mecánica de `retarget.ts` —agendar N etapas, cron con claim atómico—
 * con las diferencias de ADR-0063: sin ventana de 24h, ancla en el primer
 * inbound, y fuera de horario se DIFIERE en vez de omitirse.
 */

type DB = ReturnType<typeof createServiceClient>;
type EventPayload = Record<string, unknown>;

/** Columnas de voz del agente. Se leen APARTE de `AGENT_COLS` (42703). */
const VOICE_COLS =
  "id, name, voice_enabled, synthflow_api_key, synthflow_model_id, synthflow_from_number, " +
  "voice_id, voice_prompt, voice_greeting, voice_config, voice_countries, " +
  "voice_stop_when_answered, schedule_enabled, schedule, schedule_timezone";

export interface AgentVoiceConfig {
  id: string;
  name: string;
  voiceEnabled: boolean;
  apiKey: string | null;
  modelId: string | null;
  fromNumber: string | null;
  voiceId: string | null;
  prompt: string | null;
  greeting: string | null;
  stages: ReturnType<typeof parseVoiceConfig>;
  countries: string[];
  stopWhenAnswered: boolean;
  scheduleEnabled: boolean;
  schedule: unknown;
  timezone: string;
}

/**
 * Lee la config de voz de un agente. Resiliente a 42703 (migración 0027 sin
 * aplicar): devuelve null y el llamador no agenda nada, en vez de romper la
 * ruta crítica de inbound.
 */
export async function loadAgentVoiceConfig(
  supabase: DB,
  agentId: string,
): Promise<AgentVoiceConfig | null> {
  const { data, error } = await supabase
    .from("agents")
    .select(VOICE_COLS)
    .eq("id", agentId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as Record<string, unknown>;
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    voiceEnabled: row.voice_enabled === true,
    apiKey: (row.synthflow_api_key as string | null) ?? null,
    modelId: (row.synthflow_model_id as string | null) ?? null,
    fromNumber: (row.synthflow_from_number as string | null) ?? null,
    voiceId: (row.voice_id as string | null) ?? null,
    prompt: (row.voice_prompt as string | null) ?? null,
    greeting: (row.voice_greeting as string | null) ?? null,
    stages: parseVoiceConfig(row.voice_config),
    countries: parseVoiceCountries(row.voice_countries),
    stopWhenAnswered: row.voice_stop_when_answered !== false,
    scheduleEnabled: row.schedule_enabled === true,
    schedule: row.schedule,
    timezone: (row.schedule_timezone as string | null) ?? "America/Bogota",
  };
}

/** Credenciales efectivas: las del agente tapan las del entorno. */
export function credsFor(agent: AgentVoiceConfig): SynthflowCreds {
  const apiKey = agent.apiKey ?? env.SYNTHFLOW_API_KEY;
  if (!apiKey) {
    throw new Error(
      `El agente "${agent.name}" no tiene API key de Synthflow (ni SYNTHFLOW_API_KEY en el entorno).`,
    );
  }
  return {
    apiKey,
    base: env.SYNTHFLOW_API_BASE,
    workspaceId: env.SYNTHFLOW_WORKSPACE_ID,
  };
}

// --- Agendamiento -----------------------------------------------------------

export interface ScheduleVoiceArgs {
  conversationId: string;
  contactId: string;
  phone: string;
  agentId: string;
  anchorInboundAt: string | null;
  /** epoch ms del que se cuentan los delays (normalmente el primer inbound). */
  fromMs: number;
}

/**
 * Agenda las llamadas de una conversación según la cadencia del agente.
 * Best-effort: el llamador debe envolverlo para que un fallo aquí NUNCA rompa
 * la respuesta al cliente.
 *
 * No re-agenda si ya hay filas vivas: el ancla es el PRIMER inbound, así que
 * los mensajes siguientes no deben mover la cadencia.
 */
export async function scheduleVoiceCalls(supabase: DB, args: ScheduleVoiceArgs): Promise<void> {
  if (!env.VOICE_CALLS_ENABLED) return;

  const agent = await loadAgentVoiceConfig(supabase, args.agentId);
  if (!agent || !agent.voiceEnabled || !agent.modelId) return;
  if (agent.stages.length === 0) return;
  if (!phoneAllowed(args.phone, agent.countries)) return;

  // ¿Ya se agendó para esta conversación? (cualquier fila, viva o consumida)
  const { data: existing } = await supabase
    .from("voice_calls")
    .select("id")
    .eq("conversation_id", args.conversationId)
    .eq("trigger", "auto")
    .limit(1);
  if (existing && existing.length > 0) return;

  const plan = planVoiceCalls(args.fromMs, agent.stages);
  const rows = plan.map((p) => ({
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    agent_id: args.agentId,
    phone: args.phone,
    stage: p.stage,
    delay_minutes: p.delayMinutes,
    trigger: "auto" as const,
    status: "scheduled" as const,
    scheduled_at: p.scheduledAt,
    anchor_inbound_at: args.anchorInboundAt,
  }));

  const { error } = await supabase.from("voice_calls").insert(rows);
  // 23505 = choque contra el índice parcial (otra ejecución agendó primero).
  if (error && error.code !== "23505") {
    throw new Error(`schedule-voice-calls: ${error.message}`);
  }
}

/** Cancela las llamadas aún programadas de una conversación. */
export async function cancelScheduledVoiceCalls(
  supabase: DB,
  conversationId: string,
  reason: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("voice_calls")
    .update({ status: "cancelled", error: reason })
    .eq("conversation_id", conversationId)
    .eq("status", "scheduled")
    .select("id");
  if (error) throw new Error(`cancel-voice-calls: ${error.message}`);
  return data?.length ?? 0;
}

// --- Worker del cron --------------------------------------------------------

export interface VoiceRunStats {
  processed: number;
  placed: number;
  cancelled: number;
  deferred: number;
  failed: number;
}

interface DueRow {
  id: string;
  conversation_id: string;
  contact_id: string;
  agent_id: string | null;
  phone: string;
  stage: number;
  delay_minutes: number | null;
}

/**
 * Procesa las llamadas vencidas. Cada fila se toma con un **claim atómico**
 * (`scheduled → processing`): si dos ejecuciones del cron se solapan, solo una
 * llama. En una feature que marca un teléfono real, esto no es opcional.
 */
export async function runDueVoiceCalls(opts?: {
  limit?: number;
  nowMs?: number;
}): Promise<VoiceRunStats> {
  const stats: VoiceRunStats = { processed: 0, placed: 0, cancelled: 0, deferred: 0, failed: 0 };
  if (!env.VOICE_CALLS_ENABLED) return stats;

  const supabase = createServiceClient();
  const now = opts?.nowMs ?? Date.now();
  const limit = opts?.limit ?? 25;

  const { data: due, error } = await supabase
    .from("voice_calls")
    .select("id, conversation_id, contact_id, agent_id, phone, stage, delay_minutes")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date(now).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`load-due-voice-calls: ${error.message}`);
  if (!due || due.length === 0) return stats;

  for (const row of due as unknown as DueRow[]) {
    const { data: claimed, error: claimErr } = await supabase
      .from("voice_calls")
      .update({ status: "processing" })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) continue; // otra ejecución la tomó

    stats.processed++;
    try {
      const outcome = await processVoiceCallRow(supabase, row, now);
      stats[outcome]++;
    } catch (e) {
      stats.failed++;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[runDueVoiceCalls] falló:", message);
      await supabase
        .from("voice_calls")
        .update({ status: "failed", error: message.slice(0, 300) })
        .eq("id", row.id);
      await logEvent(supabase, row.conversation_id, "voice_call_error", {
        voiceCallId: row.id,
        stage: row.stage,
        error: message,
      });
    }
  }

  return stats;
}

type RowOutcome = "placed" | "cancelled" | "deferred";

async function processVoiceCallRow(supabase: DB, row: DueRow, nowMs: number): Promise<RowOutcome> {
  const { data: convo } = await supabase
    .from("conversations")
    .select("id, status, ai_paused, agent_id, product_category")
    .eq("id", row.conversation_id)
    .maybeSingle();

  const agentId = row.agent_id ?? (convo as { agent_id?: string } | null)?.agent_id ?? null;
  const agent = agentId ? await loadAgentVoiceConfig(supabase, agentId) : null;

  // ¿Ya compró?
  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("conversation_id", row.conversation_id)
    .neq("status", "cancelled")
    .limit(1);

  // ¿Alguna etapa previa ya fue contestada?
  const { data: answered } = await supabase
    .from("voice_calls")
    .select("id")
    .eq("conversation_id", row.conversation_id)
    .eq("status", "completed")
    .limit(1);

  const convoRow = convo as { status?: string; ai_paused?: boolean; product_category?: string } | null;

  const decision = evaluateVoiceCall({
    conversationStatus: convoRow?.status ?? "active",
    aiPaused: convoRow?.ai_paused === true,
    hasOrder: (orders?.length ?? 0) > 0,
    agentVoiceEnabled: agent?.voiceEnabled === true,
    alreadyAnswered: (answered?.length ?? 0) > 0,
    stopWhenAnswered: agent?.stopWhenAnswered !== false,
    phoneAllowed: agent ? phoneAllowed(row.phone, agent.countries) : false,
    withinSchedule: agent ? withinSchedule(agent, new Date(nowMs)) : false,
    hasModelId: Boolean(agent?.modelId),
  });

  if (decision.action === "cancel") {
    await supabase
      .from("voice_calls")
      .update({ status: "cancelled", error: decision.reason })
      .eq("id", row.id);
    await logEvent(supabase, row.conversation_id, "voice_call_cancelled", {
      voiceCallId: row.id,
      stage: row.stage,
      reason: decision.reason,
    });
    return "cancelled";
  }

  if (decision.action === "defer") {
    // Vuelve a la cola: se reintenta cuando el agente abra.
    await supabase.from("voice_calls").update({ status: "scheduled" }).eq("id", row.id);
    await logEvent(supabase, row.conversation_id, "voice_call_deferred", {
      voiceCallId: row.id,
      stage: row.stage,
      reason: decision.reason,
    });
    return "deferred";
  }

  await dialAndSave(supabase, agent!, row, convoRow?.product_category ?? null);
  return "placed";
}

/** ¿El agente está operando ahora? Sin horario configurado, siempre. */
function withinSchedule(agent: AgentVoiceConfig, now: Date): boolean {
  if (!agent.scheduleEnabled) return true;
  try {
    return isAgentActiveNow(
      {
        schedule_enabled: agent.scheduleEnabled,
        schedule: agent.schedule,
        schedule_timezone: agent.timezone,
      } as Parameters<typeof isAgentActiveNow>[0],
      now,
    );
  } catch {
    return true; // ante duda, no bloqueamos la operación
  }
}

/** Marca el número y guarda el `call_id`. */
async function dialAndSave(
  supabase: DB,
  agent: AgentVoiceConfig,
  row: DueRow,
  productCategory: string | null,
): Promise<void> {
  const { data: contact } = await supabase
    .from("contacts")
    .select("name")
    .eq("id", row.contact_id)
    .maybeSingle();
  const contactName = (contact as { name?: string } | null)?.name ?? null;

  const { data: recent } = await supabase
    .from("messages")
    .select("direction, content")
    .eq("conversation_id", row.conversation_id)
    .order("created_at", { ascending: false })
    .limit(6);

  const lastMessages = (recent ?? [])
    .slice()
    .reverse()
    .map((m) => {
      const msg = m as { direction?: string; content?: string };
      const who = msg.direction === "inbound" ? "Cliente" : "Bot";
      return `${who}: ${(msg.content ?? "").slice(0, 200)}`;
    })
    .filter((s) => s.length > 8);

  const stageIndex = Math.max(0, row.stage - 1);
  const guidance = agent.stages[stageIndex]?.guidance ?? null;

  const prompt = agent.prompt
    ? buildCallPrompt({
        basePrompt: agent.prompt,
        guidance,
        contactName,
        productCategory,
        lastMessages,
      })
    : null;

  const callId = await placeCall(credsFor(agent), {
    modelId: agent.modelId!,
    phone: toE164(row.phone),
    name: contactName || "Cliente",
    fromNumber: agent.fromNumber,
    prompt,
    greeting: agent.greeting,
    variables: {
      nombre: contactName ?? "",
      producto: productCategory ?? "",
    },
  });

  await supabase
    .from("voice_calls")
    .update({
      status: "placed",
      synthflow_call_id: callId,
      synthflow_model_id: agent.modelId,
      placed_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", row.id);

  await logEvent(supabase, row.conversation_id, "voice_call_placed", {
    voiceCallId: row.id,
    stage: row.stage,
    callId,
    trigger: "auto",
  });
}

// --- Cierre de la llamada ---------------------------------------------------

/**
 * Cierra una llamada con los datos de Synthflow. **Único camino de cierre**:
 * entran por aquí tanto el webhook como la reconciliación del cron, y es
 * idempotente (si ya está cerrada, no hace nada). Ver ADR-0061.
 */
export async function finalizeVoiceCall(
  supabase: DB,
  voiceCallId: string,
  call: NormalizedCall,
): Promise<void> {
  const { data: row } = await supabase
    .from("voice_calls")
    .select("id, conversation_id, contact_id, agent_id, stage, status")
    .eq("id", voiceCallId)
    .maybeSingle();
  if (!row) return;

  const current = row as unknown as {
    id: string;
    conversation_id: string;
    agent_id: string | null;
    stage: number;
    status: string;
  };
  // Ya cerrada: el webhook llegó después de la reconciliación (o al revés).
  if (["completed", "no_answer", "failed", "cancelled"].includes(current.status)) return;
  // Sigue viva en Synthflow: no cerramos todavía.
  if (call.status === "placed") return;

  const costUsd = callCostUsd(call.durationSec, env.SYNTHFLOW_USD_PER_MINUTE);

  await supabase
    .from("voice_calls")
    .update({
      status: call.status,
      call_status: call.rawStatus,
      end_call_reason: call.endCallReason,
      duration_sec: call.durationSec,
      cost_usd: costUsd,
      transcript: call.transcript,
      recording_url: call.recordingUrl,
      extracted: call.extracted as unknown as Json,
      started_at: call.startedAt,
      ended_at: new Date().toISOString(),
    })
    .eq("id", voiceCallId);

  // La nota en el hilo de la conversación.
  const note = buildCallNote({
    status: call.status,
    durationSec: call.durationSec,
    endCallReason: call.endCallReason,
    extracted: call.extracted,
    transcript: call.transcript,
    recordingUrl: call.recordingUrl,
  });

  await supabase.from("messages").insert({
    conversation_id: current.conversation_id,
    direction: "outbound",
    role: "system",
    type: "other",
    content: note,
    tags: ["#llamada-ia"] as unknown as Json,
  });

  await logEvent(supabase, current.conversation_id, "voice_call_completed", {
    voiceCallId,
    stage: current.stage,
    callId: call.callId,
    status: call.status,
    durationSec: call.durationSec,
    costUsd,
    answered: call.answered,
    extractedKeys: Object.keys(call.extracted),
  });

  // Si contestó, las etapas siguientes sobran (salvo que el agente diga lo contrario).
  if (call.answered && current.agent_id) {
    const agent = await loadAgentVoiceConfig(supabase, current.agent_id);
    if (agent?.stopWhenAnswered !== false) {
      await cancelScheduledVoiceCalls(supabase, current.conversation_id, "already_answered");
    }
  }
}

/**
 * Cierra las llamadas `placed` consultando la API. Es lo que hace que la feature
 * funcione **aunque el webhook nunca se configure** — que es el caso realista
 * cuando los assistants son compartidos y ya apuntan a otro sistema (ADR-0061).
 */
export async function reconcileVoiceCalls(opts?: {
  limit?: number;
  minAgeMs?: number;
  nowMs?: number;
}): Promise<{ checked: number; closed: number; failed: number }> {
  const stats = { checked: 0, closed: 0, failed: 0 };
  if (!env.VOICE_CALLS_ENABLED) return stats;

  const supabase = createServiceClient();
  const now = opts?.nowMs ?? Date.now();
  // Damos margen: una llamada recién colocada todavía está sonando.
  const cutoff = new Date(now - (opts?.minAgeMs ?? 90_000)).toISOString();

  const { data: open, error } = await supabase
    .from("voice_calls")
    .select("id, agent_id, synthflow_call_id, placed_at")
    .eq("status", "placed")
    .not("synthflow_call_id", "is", null)
    .lte("placed_at", cutoff)
    .order("placed_at", { ascending: true })
    .limit(opts?.limit ?? 25);
  if (error) throw new Error(`load-open-voice-calls: ${error.message}`);
  if (!open || open.length === 0) return stats;

  for (const item of open as unknown as {
    id: string;
    agent_id: string | null;
    synthflow_call_id: string;
  }[]) {
    stats.checked++;
    try {
      const agent = item.agent_id ? await loadAgentVoiceConfig(supabase, item.agent_id) : null;
      if (!agent) continue;
      const call = await getCall(credsFor(agent), item.synthflow_call_id);
      if (!call || call.status === "placed") continue; // sigue en curso
      await finalizeVoiceCall(supabase, item.id, call);
      stats.closed++;
    } catch (e) {
      stats.failed++;
      console.error("[reconcileVoiceCalls] falló:", e instanceof Error ? e.message : String(e));
    }
  }

  return stats;
}

// --- Disparo manual ---------------------------------------------------------

/**
 * Dispara una llamada YA, desde el dashboard de conversaciones. Se salta la
 * cadencia pero NO las guardas de seguridad (país, horario, agente prendido):
 * un clic no debería poder llamar a alguien a las 3am.
 */
export async function triggerVoiceCallNow(
  conversationId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!env.VOICE_CALLS_ENABLED) {
    return { ok: false, error: "Las llamadas con IA están apagadas (VOICE_CALLS_ENABLED)." };
  }
  const supabase = createServiceClient();

  const { data: convo } = await supabase
    .from("conversations")
    .select("id, contact_id, agent_id, status, ai_paused, product_category")
    .eq("id", conversationId)
    .maybeSingle();
  if (!convo) return { ok: false, error: "Conversación no encontrada." };

  const c = convo as unknown as {
    contact_id: string;
    agent_id: string | null;
    status: string;
    ai_paused: boolean;
    product_category: string | null;
  };
  if (!c.agent_id) return { ok: false, error: "La conversación no tiene agente asignado." };

  const agent = await loadAgentVoiceConfig(supabase, c.agent_id);
  if (!agent) return { ok: false, error: "Falta aplicar la migración 0027 (llamadas con IA)." };
  if (!agent.voiceEnabled) return { ok: false, error: "El agente tiene las llamadas apagadas." };
  if (!agent.modelId) return { ok: false, error: "El agente no tiene assistant de Synthflow." };

  const { data: contact } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", c.contact_id)
    .maybeSingle();
  const phone = (contact as { phone?: string } | null)?.phone;
  if (!phone) return { ok: false, error: "El contacto no tiene teléfono." };

  if (!phoneAllowed(phone, agent.countries)) {
    return { ok: false, error: "El país de este número no está habilitado para llamadas." };
  }
  if (!withinSchedule(agent, new Date())) {
    return { ok: false, error: "El agente está fuera de su horario de atención." };
  }

  // La siguiente etapa libre, para no chocar con el índice parcial.
  const { data: used } = await supabase
    .from("voice_calls")
    .select("stage")
    .eq("conversation_id", conversationId)
    .order("stage", { ascending: false })
    .limit(1);
  const nextStage = ((used?.[0] as { stage?: number } | undefined)?.stage ?? 0) + 1;

  const { data: inserted, error: insErr } = await supabase
    .from("voice_calls")
    .insert({
      conversation_id: conversationId,
      contact_id: c.contact_id,
      agent_id: c.agent_id,
      phone,
      stage: nextStage,
      delay_minutes: 0,
      trigger: "manual",
      status: "processing",
      scheduled_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (insErr || !inserted) {
    return { ok: false, error: insErr?.message ?? "No se pudo crear la llamada." };
  }

  const rowId = (inserted as { id: string }).id;
  try {
    await dialAndSave(
      supabase,
      agent,
      {
        id: rowId,
        conversation_id: conversationId,
        contact_id: c.contact_id,
        agent_id: c.agent_id,
        phone,
        stage: nextStage,
        delay_minutes: 0,
      },
      c.product_category,
    );
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("voice_calls")
      .update({ status: "failed", error: message.slice(0, 300) })
      .eq("id", rowId);
    return { ok: false, error: message };
  }
}

// --- Utilidades -------------------------------------------------------------

async function logEvent(
  supabase: DB,
  conversationId: string | null,
  type: string,
  payload: EventPayload,
): Promise<void> {
  await supabase
    .from("events_log")
    .insert({ conversation_id: conversationId, type, payload: payload as unknown as Json })
    .then(
      () => undefined,
      () => undefined,
    );
}
