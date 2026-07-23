import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json, VoiceCampaignStatus } from "@/lib/supabase/types";
import type { CampaignFileRow } from "@/lib/agent/voiceCampaignFile";
import { normalizeInterval, planCampaignSchedule } from "@/lib/agent/voiceCampaignPlan";

/**
 * Campañas de llamadas masivas: crear, pausar, reanudar, cancelar y saber cómo
 * van. Ver docs/29 y ADR-0084.
 *
 * Una campaña **no inventa un motor nuevo**: escribe filas en `voice_calls` con
 * su `campaign_id` y su hora, y de ahí en adelante las coloca el mismo cron que
 * ya llamaba desde las conversaciones — con las mismas guardas de país y horario,
 * la misma reconciliación y el mismo cierre. Lo único propio de la campaña es el
 * ritmo (una cada N minutos) y el poder de pausarla.
 */

type DB = ReturnType<typeof createServiceClient>;

export interface CreateCampaignInput {
  agentId: string;
  name: string;
  intervalMinutes: number;
  guidance?: string | null;
  /** ISO. Vacío = arranca ya. */
  startAt?: string | null;
  filename?: string | null;
  rows: CampaignFileRow[];
}

export interface CreateCampaignResult {
  campaignId: string;
  inserted: number;
  /** Números que ya estaban agendados en otra campaña viva y se omitieron. */
  skipped: number;
}

/**
 * Crea la campaña y agenda sus llamadas. Las filas se insertan por lotes: 5.000
 * números en un solo `insert` es un payload que Supabase rechaza por tamaño.
 */
export async function createVoiceCampaign(
  supabase: DB,
  input: CreateCampaignInput,
): Promise<CreateCampaignResult> {
  const interval = normalizeInterval(input.intervalMinutes);
  const startMs = input.startAt ? new Date(input.startAt).getTime() : Date.now();
  const startsAt = new Date(Number.isFinite(startMs) ? startMs : Date.now()).toISOString();

  // Un número que ya tiene una llamada viva (de otra campaña o de su propia
  // conversación) no se vuelve a agendar: dos llamadas seguidas del mismo
  // negocio son la forma más rápida de que bloqueen el número.
  const phones = input.rows.map((r) => r.phone);
  const live = await liveCallPhones(supabase, phones);
  const rows = input.rows.filter((r) => !live.has(r.phone));

  const { data: campaign, error: campErr } = await supabase
    .from("voice_campaigns")
    .insert({
      agent_id: input.agentId,
      name: input.name.trim() || "Campaña de llamadas",
      status: "running",
      interval_minutes: interval,
      guidance: input.guidance?.trim() || null,
      source_filename: input.filename ?? null,
      total: rows.length,
      starts_at: startsAt,
    })
    .select("id")
    .single();
  if (campErr) {
    if (campErr.code === "42P01") {
      throw new Error("Falta aplicar la migración 0032 (campañas de llamadas) en Supabase.");
    }
    throw new Error(`createVoiceCampaign: ${campErr.message}`);
  }
  const campaignId = (campaign as { id: string }).id;

  const schedule = planCampaignSchedule(new Date(startsAt).getTime(), rows.length, interval);
  const payload = rows.map((row, i) => ({
    campaign_id: campaignId,
    agent_id: input.agentId,
    phone: row.phone,
    contact_name: row.name,
    variables: (Object.keys(row.variables).length > 0 ? row.variables : null) as unknown as Json,
    stage: 1,
    delay_minutes: i * interval,
    trigger: "campaign" as const,
    status: "scheduled" as const,
    scheduled_at: schedule[i],
  }));

  let inserted = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await supabase.from("voice_calls").insert(chunk);
    if (error) throw new Error(`createVoiceCampaign filas: ${error.message}`);
    inserted += chunk.length;
  }

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "voice_campaign_created",
    payload: {
      campaignId,
      agentId: input.agentId,
      total: inserted,
      skipped: input.rows.length - rows.length,
      intervalMinutes: interval,
      startsAt,
    } as unknown as Json,
  });

  return { campaignId, inserted, skipped: input.rows.length - rows.length };
}

/** Teléfonos que ya tienen una llamada programada o en curso. */
async function liveCallPhones(supabase: DB, phones: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < phones.length; i += 300) {
    const chunk = phones.slice(i, i + 300);
    const { data } = await supabase
      .from("voice_calls")
      .select("phone")
      .in("phone", chunk)
      .in("status", ["scheduled", "processing", "placed"]);
    for (const row of data ?? []) out.add((row as { phone: string }).phone);
  }
  return out;
}

// --- Control ----------------------------------------------------------------

/** Cambia el estado de una campaña. `cancelled` además tumba sus pendientes. */
export async function setCampaignStatus(
  supabase: DB,
  campaignId: string,
  status: VoiceCampaignStatus,
): Promise<number> {
  const finishedAt =
    status === "completed" || status === "cancelled" ? new Date().toISOString() : null;

  const { error } = await supabase
    .from("voice_campaigns")
    .update({ status, finished_at: finishedAt })
    .eq("id", campaignId);
  if (error) throw new Error(`setCampaignStatus: ${error.message}`);

  let affected = 0;
  if (status === "cancelled") {
    const { data } = await supabase
      .from("voice_calls")
      .update({ status: "cancelled", error: "campaign_cancelled" })
      .eq("campaign_id", campaignId)
      .eq("status", "scheduled")
      .select("id");
    affected = data?.length ?? 0;
  }

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "voice_campaign_status",
    payload: { campaignId, status, cancelledCalls: affected } as unknown as Json,
  });
  return affected;
}

export interface CampaignPace {
  id: string;
  status: VoiceCampaignStatus;
  intervalMinutes: number;
  startsAtMs: number;
  agentId: string;
  guidance: string | null;
  /** Epoch ms de la última llamada realmente colocada. */
  lastPlacedMs: number | null;
}

/**
 * Datos de ritmo de varias campañas, en dos consultas. El worker los necesita
 * antes de tocar ninguna fila: sin `lastPlacedMs` no hay forma de respetar el
 * intervalo cuando la cola viene atrasada.
 */
export async function loadCampaignPace(
  supabase: DB,
  campaignIds: string[],
): Promise<Map<string, CampaignPace>> {
  const out = new Map<string, CampaignPace>();
  if (campaignIds.length === 0) return out;

  const { data: campaigns, error } = await supabase
    .from("voice_campaigns")
    .select("id, agent_id, status, interval_minutes, starts_at, guidance")
    .in("id", campaignIds);
  if (error) return out;

  for (const raw of campaigns ?? []) {
    const c = raw as unknown as {
      id: string;
      agent_id: string;
      status: VoiceCampaignStatus;
      interval_minutes: number;
      starts_at: string;
      guidance: string | null;
    };
    out.set(c.id, {
      id: c.id,
      agentId: c.agent_id,
      status: c.status,
      intervalMinutes: c.interval_minutes,
      startsAtMs: new Date(c.starts_at).getTime(),
      guidance: c.guidance,
      lastPlacedMs: null,
    });
  }

  const { data: placed } = await supabase
    .from("voice_calls")
    .select("campaign_id, placed_at")
    .in("campaign_id", campaignIds)
    .not("placed_at", "is", null)
    .order("placed_at", { ascending: false })
    .limit(500);
  for (const raw of placed ?? []) {
    const row = raw as { campaign_id: string | null; placed_at: string | null };
    if (!row.campaign_id || !row.placed_at) continue;
    const entry = out.get(row.campaign_id);
    if (!entry) continue;
    const ms = new Date(row.placed_at).getTime();
    if (entry.lastPlacedMs == null || ms > entry.lastPlacedMs) entry.lastPlacedMs = ms;
  }

  return out;
}

/**
 * Cierra las campañas en curso que ya no tienen nada pendiente. La llama el cron
 * después de colocar y reconciliar: la última llamada de una campaña se cierra
 * por reconciliación, cuando ya no queda ninguna fila vencida que mirar.
 */
export async function refreshRunningCampaigns(): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("voice_campaigns")
    .select("id")
    .eq("status", "running")
    .limit(50);
  if (error) return 0; // tabla ausente (migración 0032 sin aplicar): nada que hacer
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  await closeFinishedCampaigns(supabase, ids);
  return ids.length;
}

/**
 * Marca como terminada la campaña que ya no tiene pendientes. Es cosmético pero
 * importa: una campaña "en curso" para siempre esconde las que sí lo están.
 */
export async function closeFinishedCampaigns(supabase: DB, campaignIds: string[]): Promise<void> {
  for (const id of [...new Set(campaignIds)]) {
    const { count } = await supabase
      .from("voice_calls")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .in("status", ["scheduled", "processing", "placed"]);
    if ((count ?? 0) > 0) continue;
    await supabase
      .from("voice_campaigns")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "running");
  }
}
