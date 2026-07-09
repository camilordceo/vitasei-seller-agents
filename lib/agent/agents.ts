import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { matchAgent } from "@/lib/callbell/routing";
import {
  getChannelUuid,
  getDestinationNumber,
  type CallbellMessagePayload,
} from "@/lib/callbell/types";
import type { CallbellCreds } from "@/lib/callbell/sender";
import type { Database } from "@/lib/supabase/types";

/**
 * Agentes (multi-marca) — IO server-only. La lógica pura de matching está en
 * `lib/callbell/routing.ts`. Ver docs/16, ADR-0023.
 *
 * Cada agente trae su propia config de IA (prompt/modelo/vector store) y sus
 * credenciales de Callbell (API key + canal, en otra cuenta) + equipo de
 * logística. Los helpers `agent*` resuelven cada valor con fallback a env, para
 * que producción siga funcionando mientras se pegan los IDs en el dashboard.
 */

type DB = SupabaseClient<Database>;
export type Agent = Database["public"]["Tables"]["agents"]["Row"];

const AGENT_COLS =
  "id, name, brand, country, whatsapp_number, callbell_channel_uuid, callbell_api_key, logistics_team_uuid, vector_store_id, model, system_prompt, temperature, enabled, schedule_enabled, schedule_timezone, schedule, reactivation_enabled, reactivation_template_7d, reactivation_template_15d, created_at, updated_at";

/**
 * Resuelve a qué agente pertenece un inbound (por canal o número). Si ninguno
 * coincide pero el inbound cuadra con las env single-agent (transición), enruta
 * al agente seed (el que lleva el número de env). Devuelve null si no hay a quién.
 */
export async function resolveAgentForInbound(
  supabase: DB,
  payload: CallbellMessagePayload | undefined,
): Promise<Agent | null> {
  const { data, error } = await supabase.from("agents").select(AGENT_COLS).eq("enabled", true);
  if (error) throw new Error(`load-agents: ${error.message}`);
  const agents = (data ?? []) as Agent[];
  if (agents.length === 0) return null;

  const inbound = {
    channelUuid: getChannelUuid(payload),
    number: getDestinationNumber(payload),
  };

  const matched = matchAgent(agents, inbound);
  if (matched) return matched;

  // Fallback de transición: el agente seed aún no tiene canal en la DB; si el
  // inbound coincide con las env de Vercel, enruta al agente con el número de env.
  const envChannel = env.CALLBELL_WHATSAPP_CHANNEL_UUID ?? null;
  const envNumber = env.AGENT_WHATSAPP_NUMBER ?? null;
  const envConfigured = Boolean(envChannel || envNumber);
  const envMatches = envConfigured
    ? (envChannel !== null && inbound.channelUuid === envChannel) ||
      (envNumber !== null && inbound.number === envNumber)
    : true; // sin filtro configurado (dev): acepta

  if (envMatches) {
    return (
      (envNumber && agents.find((a) => a.whatsapp_number === envNumber)) ||
      agents[0] || // único agente seed
      null
    );
  }
  return null;
}

/** Carga un agente por id. */
export async function loadAgent(supabase: DB, id: string): Promise<Agent | null> {
  const { data, error } = await supabase.from("agents").select(AGENT_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`load-agent: ${error.message}`);
  return (data as Agent) ?? null;
}

/** El agente seed (el más antiguo habilitado) — fallback para datos legados sin agent_id. */
export async function loadSeedAgent(supabase: DB): Promise<Agent | null> {
  const { data, error } = await supabase
    .from("agents")
    .select(AGENT_COLS)
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`load-seed-agent: ${error.message}`);
  return (data as Agent) ?? null;
}

/**
 * Carga el agente de una conversación por su `agent_id`. Si es null (datos
 * legados) cae al agente seed. Devuelve null solo si no hay ningún agente.
 */
export async function loadAgentForConversation(
  supabase: DB,
  agentId: string | null,
): Promise<Agent | null> {
  if (agentId) {
    const agent = await loadAgent(supabase, agentId);
    if (agent) return agent;
  }
  return loadSeedAgent(supabase);
}

/** Credenciales de Callbell del agente (API key + canal) con fallback a env. */
export function agentCallbellCreds(agent: Agent): CallbellCreds {
  return {
    apiKey: agent.callbell_api_key ?? env.CALLBELL_API_KEY,
    channelUuid: agent.callbell_channel_uuid ?? env.CALLBELL_WHATSAPP_CHANNEL_UUID ?? null,
  };
}

/** Equipo de logística del agente (handoff) con fallback a env. */
export function agentTeamUuid(agent: Agent): string | null {
  return agent.logistics_team_uuid ?? env.CALLBELL_LOGISTICS_TEAM_UUID ?? null;
}

/** Vector store del catálogo del agente con fallback a env. */
export function agentVectorStoreId(agent: Agent): string | null {
  return agent.vector_store_id ?? env.OPENAI_VECTOR_STORE_ID ?? null;
}

export interface AgentReactivationSettings {
  enabled: boolean;
  template7d: string | null;
  template15d: string | null;
}

/**
 * Config de reactivaciones del agente (ON/OFF + plantillas 7/15d). Es por agente
 * porque los UUID de plantilla son específicos de SU cuenta de Callbell. Ver ADR-0030.
 */
export function agentReactivationSettings(agent: Agent): AgentReactivationSettings {
  return {
    enabled: agent.reactivation_enabled,
    template7d: agent.reactivation_template_7d,
    template15d: agent.reactivation_template_15d,
  };
}

/** Carga la config de reactivación de un agente por id (para agendar en la ingesta). */
export async function loadAgentReactivationSettings(
  supabase: DB,
  agentId: string,
): Promise<AgentReactivationSettings | null> {
  const agent = await loadAgent(supabase, agentId);
  return agent ? agentReactivationSettings(agent) : null;
}

export interface AgentReactivationImages {
  /** URL del header de imagen de la plantilla día 7 (null = plantilla de solo texto). */
  image7d: string | null;
  /** URL del header de imagen de la plantilla día 15 (null = plantilla de solo texto). */
  image15d: string | null;
}

/**
 * URLs de imagen (header) de las plantillas de reactivación 7/15d de un agente.
 * Consulta APARTE y resiliente (NO está en `AGENT_COLS`) para no arriesgar la ruta
 * crítica de inbound: si faltan las columnas (42703, migración 0022 sin aplicar)
 * devuelve nulls → se envía como plantilla de solo texto (comportamiento actual).
 * Ver ADR-0044.
 */
export async function loadReactivationImages(
  supabase: DB,
  agentId: string,
): Promise<AgentReactivationImages> {
  const { data, error } = await supabase
    .from("agents")
    .select("reactivation_image_7d, reactivation_image_15d")
    .eq("id", agentId)
    .maybeSingle();
  if (error || !data) return { image7d: null, image15d: null };
  return {
    image7d: data.reactivation_image_7d ?? null,
    image15d: data.reactivation_image_15d ?? null,
  };
}

/**
 * id del agente marcado como "de Hotmart" (`hotmart_enabled`), habilitado y más
 * antiguo si hubiera más de uno. Consulta APARTE (no está en `AGENT_COLS`) para NO
 * arriesgar la ruta crítica de inbound: si falta la columna (42703, migración 0020
 * sin aplicar) o falla, devuelve null y el llamador usa el fallback. Ver ADR-0041.
 */
export async function findHotmartAgentId(supabase: DB): Promise<string | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("id")
    .eq("enabled", true)
    .eq("hotmart_enabled", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return null; // columna ausente o error → sin marca (usa fallback)
  return data?.id ?? null;
}

export interface AgentRetargetInstructions {
  /** Guía del seguimiento de ~1h (null = usar la guía por defecto). */
  stage1: string | null;
  /** Guía del seguimiento de ~8h (null = usar la guía por defecto). */
  stage2: string | null;
}

/**
 * Instrucciones de retarget POR AGENTE (turno-guía editable de 1h/8h). Consulta
 * APARTE (no está en `AGENT_COLS`) y resiliente a que falten las columnas (42703,
 * migración 0021 sin aplicar): devuelve nulls → el backend usa la guía por defecto.
 * Ver ADR-0043.
 */
export async function loadRetargetInstructions(
  supabase: DB,
  agentId: string,
): Promise<AgentRetargetInstructions> {
  const { data, error } = await supabase
    .from("agents")
    .select("retarget_instruction_1, retarget_instruction_2")
    .eq("id", agentId)
    .maybeSingle();
  if (error || !data) return { stage1: null, stage2: null };
  return {
    stage1: data.retarget_instruction_1 ?? null,
    stage2: data.retarget_instruction_2 ?? null,
  };
}
