import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { matchAgent } from "@/lib/callbell/routing";
import { matchKapsoAgent, type KapsoInboundRoute } from "@/lib/kapso/routing";
import {
  getChannelUuid,
  getDestinationNumber,
  type CallbellMessagePayload,
} from "@/lib/callbell/types";
import type { CallbellCreds } from "@/lib/callbell/sender";
import type { KapsoCreds } from "@/lib/kapso/sender";
import { kapsoMediaAuth } from "@/lib/kapso/mediaFetch";
import { callbellMediaAuth } from "@/lib/callbell/mediaFetch";
import { CallbellProvider } from "@/lib/messaging/callbell";
import { KapsoProvider } from "@/lib/messaging/kapso";
import { normalizeProviderId, type MessagingProvider, type MessagingProviderId } from "@/lib/messaging/types";
import { DEFAULT_TEMPLATE_LANGUAGE } from "@/lib/kapso/templates";
import type { MediaAuth } from "@/lib/messaging/mediaFetch";
import { parseRetargetConfig, type RetargetStageConfig } from "@/lib/agent/retargetPlan";
import { parsePaymentMethods, type PaymentMethodConfig } from "@/lib/agent/paymentMethods";
import type { Database } from "@/lib/supabase/types";

/**
 * Agentes (multi-marca) — IO server-only. La lógica pura de matching está en
 * `lib/callbell/routing.ts` (Callbell) y `lib/kapso/routing.ts` (Kapso).
 * Ver docs/16, ADR-0023; docs/24, ADR-0056.
 *
 * Cada agente trae su propia config de IA (prompt/modelo/vector store), su
 * **proveedor** de WhatsApp (`provider`) y las credenciales de ESE proveedor.
 * Los helpers `agent*` resuelven cada valor con fallback a env, para que
 * producción siga funcionando mientras se pegan los IDs en el dashboard.
 */

type DB = SupabaseClient<Database>;
export type Agent = Database["public"]["Tables"]["agents"]["Row"];

/** Columnas históricas — las que existen desde antes de la migración 0026. */
const AGENT_COLS_LEGACY =
  "id, name, brand, country, whatsapp_number, callbell_channel_uuid, callbell_api_key, logistics_team_uuid, vector_store_id, model, system_prompt, temperature, enabled, schedule_enabled, schedule_timezone, schedule, reactivation_enabled, reactivation_template_7d, reactivation_template_15d, created_at, updated_at";

/** Columnas del multi-proveedor (migración 0026). */
const AGENT_COLS = `${AGENT_COLS_LEGACY}, provider, kapso_api_key, kapso_phone_number_id, kapso_webhook_secret, kapso_template_language`;

/**
 * Corre un select de agentes con las columnas del multi-proveedor y, si la
 * migración 0026 todavía no está aplicada (42703 = columna inexistente),
 * **reintenta con las históricas**.
 *
 * A diferencia de `payment_methods`/`retarget_config` (ADR-0052/0055), estas
 * columnas NO pueden ir en una consulta aparte: `provider` decide por dónde se
 * responde, así que se necesita en la MISMA lectura del agente y en la ruta crítica
 * de inbound. El reintento da lo mejor de los dos mundos: una sola consulta en el
 * caso normal y cero riesgo en la ventana entre el deploy y la migración (sin las
 * columnas, `provider` llega `undefined` → `normalizeProviderId` → `callbell`, que
 * es exactamente el comportamiento de hoy).
 */
async function selectAgents<T>(
  runner: (cols: string) => PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<{ data: T | null; error: PostgrestError | null }> {
  const first = await runner(AGENT_COLS);
  if (!first.error || first.error.code !== "42703") {
    return { data: (first.data as T) ?? null, error: first.error };
  }
  const legacy = await runner(AGENT_COLS_LEGACY);
  return { data: (legacy.data as T) ?? null, error: legacy.error };
}

/**
 * Resuelve a qué agente pertenece un inbound (por canal o número). Si ninguno
 * coincide pero el inbound cuadra con las env single-agent (transición), enruta
 * al agente seed (el que lleva el número de env). Devuelve null si no hay a quién.
 */
export async function resolveAgentForInbound(
  supabase: DB,
  payload: CallbellMessagePayload | undefined,
): Promise<Agent | null> {
  const { data, error } = await selectAgents<Agent[]>((cols) =>
    supabase.from("agents").select(cols).eq("enabled", true),
  );
  if (error) throw new Error(`load-agents: ${error.message}`);
  const agents = data ?? [];
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
    // Solo agentes de Callbell: este es el webhook de Callbell y las env de
    // transición son sus credenciales. Sin este filtro, un agente de Kapso creado
    // antes que el seed podría quedar de `agents[0]` y contestaríamos un inbound de
    // Callbell con las credenciales del otro proveedor. Ver ADR-0056.
    const callbellAgents = agents.filter((a) => agentProvider(a) === "callbell");
    return (
      (envNumber && callbellAgents.find((a) => a.whatsapp_number === envNumber)) ||
      callbellAgents[0] || // único agente seed
      null
    );
  }
  return null;
}

/**
 * Resuelve a qué agente de KAPSO pertenece un inbound, por su `phone_number_id`.
 * Sin fallback por env: Kapso se configura siempre desde el dashboard, así que un
 * inbound sin agente es un número que no es nuestro (o al que le falta pegar el
 * Phone Number ID) y el webhook lo registra como `inbox_rejected`.
 */
export async function resolveKapsoAgentForInbound(
  supabase: DB,
  inbound: KapsoInboundRoute,
): Promise<Agent | null> {
  const { data, error } = await selectAgents<Agent[]>((cols) =>
    supabase.from("agents").select(cols).eq("enabled", true),
  );
  if (error) throw new Error(`load-agents: ${error.message}`);
  return matchKapsoAgent(data ?? [], inbound);
}

/** Carga un agente por id. */
export async function loadAgent(supabase: DB, id: string): Promise<Agent | null> {
  const { data, error } = await selectAgents<Agent>((cols) =>
    supabase.from("agents").select(cols).eq("id", id).maybeSingle(),
  );
  if (error) throw new Error(`load-agent: ${error.message}`);
  return data ?? null;
}

/** El agente seed (el más antiguo habilitado) — fallback para datos legados sin agent_id. */
export async function loadSeedAgent(supabase: DB): Promise<Agent | null> {
  const { data, error } = await selectAgents<Agent>((cols) =>
    supabase
      .from("agents")
      .select(cols)
      .eq("enabled", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  );
  if (error) throw new Error(`load-seed-agent: ${error.message}`);
  return data ?? null;
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

/**
 * Proveedor de WhatsApp del agente. Todo lo desconocido —incluida la columna
 * ausente antes de la migración 0026— cae a `callbell`, que es el comportamiento
 * histórico. Ver ADR-0056.
 */
export function agentProvider(agent: Agent): MessagingProviderId {
  return normalizeProviderId(agent.provider);
}

/** Credenciales de Kapso del agente (API key + Meta Phone Number ID) con fallback a env. */
export function agentKapsoCreds(agent: Agent): KapsoCreds {
  const apiKey = agent.kapso_api_key ?? env.KAPSO_API_KEY ?? "";
  const phoneNumberId = agent.kapso_phone_number_id ?? env.KAPSO_PHONE_NUMBER_ID ?? "";
  if (!apiKey || !phoneNumberId) {
    throw new Error(
      `El agente "${agent.name}" usa Kapso pero le falta ${!apiKey ? "la API key" : "el Phone Number ID"}. Complétalo en el dashboard (Agentes → Proveedor).`,
    );
  }
  return {
    apiKey,
    phoneNumberId,
    templateLanguage:
      agent.kapso_template_language ?? env.KAPSO_TEMPLATE_LANGUAGE ?? DEFAULT_TEMPLATE_LANGUAGE,
  };
}

/** Secreto con el que Kapso firma los webhooks de este agente (fallback a env). */
export function agentKapsoWebhookSecret(agent: Agent): string | null {
  return agent.kapso_webhook_secret ?? env.KAPSO_WEBHOOK_SECRET ?? null;
}

/**
 * **El adaptador por el que este agente le habla al cliente.** Es el único punto
 * donde se decide Callbell vs Kapso: de acá para abajo el cerebro
 * (`processMessage`, retargets, reactivaciones, videos, Hotmart, envío manual)
 * solo ve la interfaz `MessagingProvider` y no sabe por dónde sale. Ver ADR-0056.
 */
export function providerForAgent(agent: Agent): MessagingProvider {
  if (agentProvider(agent) === "kapso") {
    return new KapsoProvider(agentKapsoCreds(agent));
  }
  return new CallbellProvider(agentCallbellCreds(agent));
}

/** Credencial para descargar los adjuntos que manda el cliente a ESTE agente. */
export function agentMediaAuth(agent: Agent): MediaAuth {
  return agentProvider(agent) === "kapso"
    ? kapsoMediaAuth(agentKapsoCreds(agent).apiKey)
    : callbellMediaAuth();
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
 *
 * `setHotmartAgent` (dashboard) garantiza exclusividad —apaga la marca en todos y la
 * prende en uno—, así que "más de uno" solo puede venir de una edición manual en la
 * base. Antes ese empate se resolvía en SILENCIO por antigüedad, lo cual es peligroso
 * al mover la línea de un proveedor a otro: los carritos se seguirían yendo por el
 * agente viejo sin ninguna señal. Ahora se detecta y se avisa. Ver ADR-0056.
 */
export async function findHotmartAgentId(supabase: DB): Promise<string | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("id, name")
    .eq("enabled", true)
    .eq("hotmart_enabled", true)
    .order("created_at", { ascending: true })
    .limit(2);
  if (error) return null; // columna ausente o error → sin marca (usa fallback)
  const rows = data ?? [];
  if (rows.length > 1) {
    console.warn(
      `[findHotmartAgentId] Hay ${rows.length} agentes marcados para Hotmart (${rows
        .map((r) => r.name)
        .join(", ")}). Gana el más antiguo: "${rows[0].name}". Deja solo uno en /dashboard/hotmart.`,
    );
  }
  return rows[0]?.id ?? null;
}

/**
 * Config de retargets POR AGENTE (cuántas etapas y a qué hora + guía de cada una).
 * Consulta APARTE (no está en `AGENT_COLS`) y resiliente a que falte la columna
 * (42703, migración 0024 sin aplicar): devuelve `[]` → el llamador usa el backstop
 * genérico por env. Ver ADR-0052.
 */
export async function loadRetargetConfig(
  supabase: DB,
  agentId: string,
): Promise<RetargetStageConfig[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("retarget_config")
    .eq("id", agentId)
    .maybeSingle();
  if (error || !data) return [];
  return parseRetargetConfig((data as { retarget_config: unknown }).retarget_config);
}

/**
 * Métodos de pago POR AGENTE (tags de compra: contra-entrega/addi en CO, Zelle en
 * EE.UU., etc.). Consulta APARTE (no está en `AGENT_COLS`) y resiliente a que falte
 * la columna (42703, migración 0025 sin aplicar): devuelve `[]` → el agente queda
 * sin métodos (no se detecta ningún tag de pago). Ver ADR-0055.
 */
export async function loadPaymentMethods(
  supabase: DB,
  agentId: string,
): Promise<PaymentMethodConfig[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("payment_methods")
    .eq("id", agentId)
    .maybeSingle();
  if (error || !data) return [];
  return parsePaymentMethods((data as { payment_methods: unknown }).payment_methods);
}
