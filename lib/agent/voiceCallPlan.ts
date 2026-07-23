import {
  EXTRACTOR_TYPES,
  ORDER_FIELDS,
  type ExtractorType,
  type OrderField,
  type VoiceExtractor,
} from "@/lib/synthflow/types";
import { defaultOutcomeExtractor } from "@/lib/agent/voiceOutcome";
import { formatExtractedValue, humanizeIdentifier } from "@/lib/synthflow/extractors";
import type { ExtractedData } from "@/lib/synthflow/extractors";

/**
 * Lógica PURA de las llamadas con IA: cadencia, guardas y textos.
 * Sin I/O — se testea entera. Espejo de `retargetPlan.ts` (ADR-0063), con las
 * diferencias que justifican una feature aparte:
 *   · NO hay ventana de 24h (una llamada a 72h es válida).
 *   · Fuera de horario se DIFIERE, no se omite.
 */

/** Tope de etapas por agente. Más que esto es acoso, no seguimiento. */
export const MAX_VOICE_STAGES = 5;
/** Tope de espera: 30 días. */
export const MAX_DELAY_MINUTES = 30 * 24 * 60;

export interface VoiceStage {
  delayMinutes: number;
  guidance: string | null;
}

export interface PlannedCall {
  stage: number;
  delayMinutes: number;
  scheduledAt: string;
}

// --- Config de etapas -------------------------------------------------------

/**
 * Lee `agents.voice_config`. NUNCA lanza: descarta lo inválido, redondea,
 * deduplica por delay, ordena y corta al máximo. Misma disciplina que
 * `parseRetargetConfig`: esta función corre en la ruta de inbound.
 */
export function parseVoiceConfig(raw: unknown): VoiceStage[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const stages: VoiceStage[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const rawDelay = record.delayMinutes;
    const delay =
      typeof rawDelay === "number"
        ? rawDelay
        : typeof rawDelay === "string"
          ? Number(rawDelay)
          : NaN;
    if (!Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_MINUTES) continue;

    const delayMinutes = Math.round(delay);
    if (seen.has(delayMinutes)) continue;
    seen.add(delayMinutes);

    const guidance = typeof record.guidance === "string" && record.guidance.trim() !== ""
      ? record.guidance.trim()
      : null;
    stages.push({ delayMinutes, guidance });
  }

  stages.sort((a, b) => a.delayMinutes - b.delayMinutes);
  return stages.slice(0, MAX_VOICE_STAGES);
}

/**
 * Convierte las etapas en filas agendables. Los delays se cuentan desde
 * `fromMs` (el primer inbound), NO son acumulativos: "a las 24h" es 24h después
 * del mensaje, no 24h después de la llamada anterior.
 */
export function planVoiceCalls(fromMs: number, stages: VoiceStage[]): PlannedCall[] {
  return stages.map((stage, index) => ({
    stage: index + 1,
    delayMinutes: stage.delayMinutes,
    scheduledAt: new Date(fromMs + stage.delayMinutes * 60_000).toISOString(),
  }));
}

// --- Filtro por país --------------------------------------------------------

/** Lee `agents.voice_countries`: prefijos E.164 (`["57"]`). Vacío = todos. */
export function parseVoiceCountries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const digits = String(item ?? "").replace(/\D/g, "");
    if (digits.length >= 1 && digits.length <= 4 && !out.includes(digits)) out.push(digits);
  }
  return out;
}

/**
 * ¿Se puede llamar a este número? Sin prefijos configurados, sí (todos).
 * El teléfono interno va sin `+` (`573001112233`).
 */
export function phoneAllowed(phone: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return true;
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return false;
  return prefixes.some((prefix) => digits.startsWith(prefix));
}

/** Interno (sin `+`) → E.164 con `+`, que es lo que exige Synthflow. */
export function toE164(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

// --- Extractores ------------------------------------------------------------

/**
 * Normaliza un identifier a snake_case. Synthflow pide snake_case y **la clave
 * del resultado es este identifier**, así que si se ensucia, el dato no se
 * encuentra después.
 */
export function normalizeIdentifier(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Lee `agents.voice_extractors`. Nunca lanza; descarta lo inválido. */
export function parseVoiceExtractors(raw: unknown): VoiceExtractor[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: VoiceExtractor[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;

    const identifier = normalizeIdentifier(String(record.identifier ?? ""));
    if (!identifier || seen.has(identifier)) continue;

    const rawType = String(record.type ?? "OPEN_QUESTION").toUpperCase();
    const type = (EXTRACTOR_TYPES as readonly string[]).includes(rawType)
      ? (rawType as ExtractorType)
      : "OPEN_QUESTION";

    const condition = typeof record.condition === "string" ? record.condition.trim() : "";
    if (!condition) continue; // sin instrucción no hay nada que extraer

    const toList = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.map((x) => String(x ?? "").trim()).filter((x) => x.length > 0).slice(0, 40)
        : [];

    const choices = toList(record.choices);
    // Marca de "este extractor dice en qué terminó la llamada" (ADR-0083). Solo
    // el PRIMERO marcado manda: dos resultados serían dos verdades.
    const outcome = record.outcome === true && !out.some((e) => e.outcome);
    const orderField =
      typeof record.orderField === "string" &&
      (ORDER_FIELDS as readonly string[]).includes(record.orderField)
        ? (record.orderField as OrderField)
        : null;

    seen.add(identifier);
    out.push({
      identifier,
      type,
      condition,
      choices,
      examples: toList(record.examples),
      actionId: typeof record.actionId === "string" && record.actionId ? record.actionId : null,
      outcome,
      // Los valores de venta solo tienen sentido en el extractor de resultado.
      saleValues: outcome ? toList(record.saleValues) : [],
      orderField,
    });
  }
  return out.slice(0, 20);
}

/**
 * Extractores por defecto para una tienda: lo que pidió el negocio. El primero
 * es el **resultado de la llamada**, que es el que dispara la orden (ADR-0083).
 */
export function defaultExtractors(): VoiceExtractor[] {
  return [
    defaultOutcomeExtractor(),
    {
      identifier: "nombre",
      type: "OPEN_QUESTION",
      condition: "Nombre completo del cliente tal como lo dijo en la llamada.",
      choices: [],
      examples: ["Camilo Ordoñez", "Laura Caicedo"],
      actionId: null,
      outcome: false,
      saleValues: [],
      orderField: "name",
    },
    {
      identifier: "producto",
      type: "OPEN_QUESTION",
      condition: "Producto que el cliente quiere comprar.",
      choices: [],
      examples: ["Colageno hidrolizado", "Magnesio"],
      actionId: null,
      outcome: false,
      saleValues: [],
      orderField: "product",
    },
    {
      identifier: "direccion",
      type: "OPEN_QUESTION",
      condition:
        "Direccion completa de entrega que dio el cliente, incluyendo ciudad y barrio si los menciono.",
      choices: [],
      examples: ["Calle 145 #20-30 apto 501, Bogota", "Carrera 7 #80-15, Medellin"],
      actionId: null,
      outcome: false,
      saleValues: [],
      orderField: "address",
    },
    {
      identifier: "metodo_pago",
      type: "OPEN_QUESTION",
      condition: "Metodo de pago que prefiere el cliente para su pedido.",
      choices: [],
      examples: ["contra entrega", "transferencia", "Addi"],
      actionId: null,
      outcome: false,
      saleValues: [],
      orderField: "payment",
    },
  ];
}

// --- Guardas antes de llamar ------------------------------------------------

export interface VoiceCallContext {
  conversationStatus: string;
  aiPaused: boolean;
  hasOrder: boolean;
  agentVoiceEnabled: boolean;
  /** Alguna etapa previa de esta conversación ya fue contestada. */
  alreadyAnswered: boolean;
  stopWhenAnswered: boolean;
  phoneAllowed: boolean;
  /** ¿El agente está dentro de su horario de atención ahora? */
  withinSchedule: boolean;
  hasModelId: boolean;
}

export type VoiceCallAction = "place" | "cancel" | "skip" | "defer";

export interface VoiceCallDecision {
  action: VoiceCallAction;
  reason: string;
}

/**
 * ¿Se hace la llamada? El orden importa: primero lo que la invalida para
 * siempre (cancel), después lo temporal (defer).
 *
 * `defer` devuelve la fila a `scheduled` para reintentar en el siguiente ciclo;
 * es lo que impide llamar a un cliente a las 3 de la mañana.
 */
export function evaluateVoiceCall(ctx: VoiceCallContext): VoiceCallDecision {
  if (!ctx.agentVoiceEnabled) return { action: "cancel", reason: "voice_disabled" };
  if (!ctx.hasModelId) return { action: "cancel", reason: "no_synthflow_assistant" };
  if (ctx.hasOrder) return { action: "cancel", reason: "already_converted" };
  if (ctx.conversationStatus !== "active") {
    return { action: "cancel", reason: `conversation_${ctx.conversationStatus}` };
  }
  if (ctx.aiPaused) return { action: "cancel", reason: "ai_paused" };
  if (!ctx.phoneAllowed) return { action: "cancel", reason: "country_not_allowed" };
  if (ctx.alreadyAnswered && ctx.stopWhenAnswered) {
    return { action: "cancel", reason: "already_answered" };
  }
  // Temporal: vuelve a intentarse en el próximo ciclo del cron.
  if (!ctx.withinSchedule) return { action: "defer", reason: "outside_schedule" };
  return { action: "place", reason: "ok" };
}

// --- Textos -----------------------------------------------------------------

/**
 * Arma el prompt efectivo de la llamada: el prompt de voz del agente + la guía
 * de la etapa + el contexto de la conversación. Va en `POST /v2/calls`, así no
 * hay que mutar el assistant compartido (ADR-0060).
 */
export function buildCallPrompt(args: {
  basePrompt: string;
  guidance?: string | null;
  contactName?: string | null;
  productCategory?: string | null;
  lastMessages?: string[];
}): string {
  const parts: string[] = [args.basePrompt.trim()];

  if (args.guidance) {
    parts.push(`\n## Objetivo de esta llamada\n${args.guidance.trim()}`);
  }

  const context: string[] = [];
  if (args.contactName) context.push(`- Nombre del cliente: ${args.contactName}`);
  if (args.productCategory) context.push(`- Producto por el que escribió: ${args.productCategory}`);
  if (args.lastMessages?.length) {
    context.push(`- Últimos mensajes por WhatsApp:`);
    for (const m of args.lastMessages.slice(-6)) context.push(`  · ${m}`);
  }
  if (context.length > 0) {
    parts.push(`\n## Contexto de la conversación por WhatsApp\n${context.join("\n")}`);
  }

  return parts.join("\n");
}

/**
 * Nota que queda en la conversación cuando termina la llamada. Es lo que el
 * equipo lee en el hilo, así que va en texto plano y al grano.
 */
export function buildCallNote(args: {
  status: string;
  durationSec: number | null;
  endCallReason: string | null;
  extracted: ExtractedData;
  transcript: string | null;
  recordingUrl: string | null;
  /** Resultado del extractor marcado como tal (`compra`…). Ver ADR-0083. */
  outcome?: string | null;
  /** La llamada generó orden: es lo primero que el equipo necesita ver. */
  orderCreated?: boolean;
}): string {
  const lines: string[] = [];
  const label = describeCallStatus(args.status);
  const mins = args.durationSec != null && args.durationSec > 0
    ? ` · ${Math.floor(args.durationSec / 60)}m ${args.durationSec % 60}s`
    : "";
  lines.push(`Llamada con IA — ${label}${mins}`);

  if (args.outcome) lines.push(`Resultado: ${args.outcome}`);
  if (args.orderCreated) lines.push("Se generó la orden con los datos de la llamada.");
  if (args.endCallReason) lines.push(`Cierre: ${describeEndReason(args.endCallReason)}`);

  const entries = Object.entries(args.extracted);
  if (entries.length > 0) {
    lines.push("");
    lines.push("Datos capturados:");
    for (const [key, value] of entries) {
      lines.push(`• ${humanizeIdentifier(key)}: ${formatExtractedValue(value)}`);
    }
  }

  if (args.recordingUrl) {
    lines.push("");
    lines.push(`Grabación: ${args.recordingUrl}`);
  }

  return lines.join("\n");
}

/** Etiqueta en español de nuestro `status`. */
export function describeCallStatus(status: string): string {
  switch (status) {
    case "scheduled":
      return "Programada";
    case "processing":
      return "Procesando";
    case "placed":
      return "En curso";
    case "completed":
      return "Contestada";
    case "no_answer":
      return "Sin respuesta";
    case "failed":
      return "Fallida";
    case "cancelled":
      return "Cancelada";
    case "skipped":
      return "Omitida";
    default:
      return status;
  }
}

/** Etiqueta en español del `end_call_reason` de Synthflow. */
export function describeEndReason(reason: string): string {
  switch (reason) {
    case "agent_goodbye":
      return "la IA se despidió";
    case "human_goodbye":
      return "el cliente se despidió";
    case "human_pick_up_cut_off":
      return "el cliente colgó";
    case "voicemail":
    case "voicemail_message_left":
      return "buzón de voz";
    case "max_duration":
      return "se alcanzó la duración máxima";
    case "custom_end_call":
      return "cierre configurado";
    case "user_canceled":
      return "cancelada por el usuario";
    default:
      return reason;
  }
}

/** Texto de "hace cuánto" para la UI: `10 min`, `24 h`, `3 d`. */
export function describeDelay(delayMinutes: number | null | undefined): string {
  if (delayMinutes == null || !Number.isFinite(delayMinutes)) return "—";
  if (delayMinutes <= 0) return "inmediata";
  if (delayMinutes < 60) return `${delayMinutes} min`;
  // Hasta 3 días se muestra en horas porque así se habla la cadencia en el
  // negocio ("una a las 24 horas"); de ahí en adelante, días.
  if (delayMinutes < 3 * 24 * 60) {
    const hours = Math.round(delayMinutes / 60);
    return `${hours} h`;
  }
  const days = Math.round(delayMinutes / (24 * 60));
  return `${days} d`;
}
