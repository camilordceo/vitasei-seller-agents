import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import {
  EST_IMAGE_INPUT_TOKENS,
  GPT5_MINI_INPUT_PER_1M,
  tokenCostUsd,
} from "@/lib/openai/pricing";
import {
  bogotaDayEndIso,
  bogotaDayKey,
  bogotaDayStartIso,
  summarizeConversationActivity,
  summarizeCloseSpeed,
  summarizeOrders,
  summarizeProductConversion,
  summarizeRoas,
  summarizeWeekly,
  summarizeScaling,
  summarizeTopProducts,
  matchesSearch,
  searchKey,
  type AdSpendFact,
  type AgentCostConfig,
  type ChatFact,
  type CloseSpeedFact,
  type CloseSpeedReport,
  type RoasOrderFact,
  type RoasReport,
  type ConversationActivityFact,
  type ConversionReport,
  type OrderFact,
  type ProductConversionFact,
  type ProductConversionRow,
  type ProductSalesFact,
  type SalesReport,
  type ScalingReport,
  type TopProductRow,
  type TransactionFact,
  type WeeklyReport,
} from "@/lib/dashboard/report";
import type {
  CallRequestStatus,
  ConversationStatus,
  FulfillmentMethod,
  MessageDirection,
  MessageType,
  OrderStatus,
  RetargetStatus,
  VoiceCallStatus,
} from "@/lib/supabase/types";
import { parseAgentSchedule, type AgentSchedule } from "@/lib/agent/schedule";
import {
  parseVoiceConfig,
  parseVoiceCountries,
  parseVoiceExtractors,
} from "@/lib/agent/voiceCallPlan";
import { normalizeProviderId, type MessagingProviderId } from "@/lib/messaging/types";
import { findHotmartAgentId } from "@/lib/agent/agents";
import { parseRetargetConfig } from "@/lib/agent/retargetPlan";
import { parsePaymentMethods, type PaymentMethodConfig } from "@/lib/agent/paymentMethods";
import { buildMethodLabels } from "@/lib/dashboard/methodLabels";
import {
  convertMoney,
  DEFAULT_CURRENCY,
  normalizeCurrency,
  roundForCurrency,
  sumConverted,
  type CurrencyCode,
} from "@/lib/dashboard/currency";

/**
 * Consultas de solo lectura del dashboard (Sprint 6).
 *
 * Corren en server components con el cliente service-role (bypassa RLS). El
 * service role NUNCA llega al browser. Volumen v1 bajo → sumas en JS; si crece,
 * mover a vistas/RPC en Postgres.
 */

// Precios en `lib/openai/pricing.ts` (punto único). Costo real de gpt-5-mini.

const DAY_MS = 24 * 60 * 60 * 1000;
/** PostgREST devuelve como máximo 1000 filas por request → paginamos por páginas de 1000. */
const PAGE_SIZE = 1000;

/**
 * Trae TODAS las filas de un select paginando en bloques de 1000, superando el
 * tope por defecto de PostgREST. Sube el `.range(from, to)` a la query cruda para
 * poder aplicar filtros/orden en el callback. Volumen v1 bajo → aceptable; si
 * crece mucho, mover la agregación a una vista/RPC en Postgres.
 */
async function fetchAllRows<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: PostgrestError | null }>,
  label: string,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export interface Kpis {
  totalSales: number;
  txCount: number;
  inputTokens: number;
  outputTokens: number;
  /** Costo IA total (tokens del modelo + transcripción de audio). */
  estCostUsd: number;
}

function readUsage(payload: unknown): { inputTokens: number; outputTokens: number } {
  if (payload && typeof payload === "object" && "usage" in payload) {
    const u = (payload as { usage?: unknown }).usage;
    if (u && typeof u === "object") {
      const uu = u as { inputTokens?: unknown; outputTokens?: unknown };
      return {
        inputTokens: typeof uu.inputTokens === "number" ? uu.inputTokens : 0,
        outputTokens: typeof uu.outputTokens === "number" ? uu.outputTokens : 0,
      };
    }
  }
  return { inputTokens: 0, outputTokens: 0 };
}

/** # de imágenes (visión) que registró el evento (`payload.images`). */
function readImages(payload: unknown): number {
  if (payload && typeof payload === "object" && "images" in payload) {
    const n = (payload as { images?: unknown }).images;
    return typeof n === "number" ? n : 0;
  }
  return 0;
}

/** Costo/duración que registró un evento de audio (`payload.costUsd/durationSec`). */
function readAudio(payload: unknown): { costUsd: number; durationSec: number } {
  if (payload && typeof payload === "object") {
    const p = payload as { costUsd?: unknown; durationSec?: unknown };
    return {
      costUsd: typeof p.costUsd === "number" ? p.costUsd : 0,
      durationSec: typeof p.durationSec === "number" ? p.durationSec : 0,
    };
  }
  return { costUsd: 0, durationSec: 0 };
}

// Eventos que registran `usage` (tokens gpt-5-mini): respuesta normal, seguimiento
// dinámico (retarget con IA) y extracción de la orden. TODOS suman al costo real.
const TOKEN_EVENT_TYPES = ["reply_generated", "retarget_sent", "order_created"] as const;

/**
 * Set de `conversation_id` que pertenecen a un agente. Es la clave para acotar los
 * reportes POR AGENTE: `orders`, `messages` y `events_log` cuelgan de una
 * conversación, y la conversación es la que lleva `agent_id` (migración 0010).
 * Paginado (supera el tope de 1000 de PostgREST). Volumen v1 bajo → set en memoria;
 * si crece mucho, mover el join a la BD (vista/RPC). Ver ADR-0053.
 */
async function getAgentConversationIds(agentId: string): Promise<Set<string>> {
  const supabase = createServiceClient();
  const rows = await fetchAllRows(
    (from, to) =>
      supabase.from("conversations").select("id").eq("agent_id", agentId).range(from, to),
    "getAgentConversationIds",
  );
  return new Set(rows.map((r) => r.id));
}

export async function getKpis(): Promise<Kpis> {
  const supabase = createServiceClient();
  const [ordersRes, cost] = await Promise.all([
    supabase.from("orders").select("total, status"),
    getAiCostReport(),
  ]);
  if (ordersRes.error) throw new Error(`getKpis orders: ${ordersRes.error.message}`);

  // "Ventas generadas" = órdenes NO canceladas (una cancelada no es venta).
  const orders = (ordersRes.data ?? []).filter((o) => o.status !== "cancelled");
  const totalSales = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

  return {
    totalSales,
    txCount: orders.length,
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens,
    estCostUsd: cost.totalCostUsd, // tokens + audio
  };
}

export interface AiCostReport {
  inputTokens: number;
  outputTokens: number;
  /** # de imágenes (visión) procesadas por el bot. */
  imageCount: number;
  /** # de audios transcritos. */
  audioCount: number;
  /** Segundos de audio transcritos. */
  audioSeconds: number;
  /** Costo de tokens de solo texto (tokens del modelo − estimado de imágenes). */
  textCostUsd: number;
  /** Costo estimado de la visión (imágenes) — repartición del costo de tokens. */
  imageCostUsd: number;
  /** Costo real de la transcripción de audio (whisper por minuto). */
  audioCostUsd: number;
  /** Costo IA total = texto + imágenes + audio (exacto: repartición no lo altera). */
  totalCostUsd: number;
}

/**
 * Costo IA desglosado en las TRES fuentes que consume el agente:
 *  - **Texto**: tokens del modelo (respuesta normal + retarget dinámico + extracción de orden).
 *  - **Imágenes (visión)**: sus tokens ya vienen dentro de los del modelo; se ESTIMAN
 *    (`EST_IMAGE_INPUT_TOKENS`/imagen) para separarlos del texto. La repartición es
 *    aproximada, pero el TOTAL sigue exacto (imágenes se resta del texto, no se suma aparte).
 *  - **Audio**: transcripción (whisper) con costo real por minuto (`audio_transcribed.costUsd`).
 * Las reactivaciones no entran acá: son plantilla de WhatsApp, costo fijo aparte.
 *
 * Con `agentId` acota a los eventos de las conversaciones de ese agente (por
 * `conversation_id`); los eventos sin conversación no se atribuyen a un agente y
 * quedan fuera del corte por agente. Las lecturas van paginadas: `events_log` es
 * la tabla que más crece (un evento por respuesta) y sin esto PostgREST cortaba en
 * 1000, subcontando el costo real. Ver ADR-0053.
 */
export async function getAiCostReport(agentId?: string): Promise<AiCostReport> {
  const supabase = createServiceClient();
  const convoIds = agentId ? await getAgentConversationIds(agentId) : null;
  const [tokenRows, audioRows] = await Promise.all([
    fetchAllRows(
      (from, to) =>
        supabase
          .from("events_log")
          .select("payload, conversation_id")
          .in("type", TOKEN_EVENT_TYPES as unknown as string[])
          .range(from, to),
      "getAiCostReport tokens",
    ),
    fetchAllRows(
      (from, to) =>
        supabase
          .from("events_log")
          .select("payload, conversation_id")
          .eq("type", "audio_transcribed")
          .range(from, to),
      "getAiCostReport audio",
    ),
  ]);

  // Sin agente: cuenta todo. Con agente: solo los eventos de SUS conversaciones.
  const belongs = (cid: string | null) => !convoIds || (cid != null && convoIds.has(cid));

  let inputTokens = 0;
  let outputTokens = 0;
  let imageCount = 0;
  for (const row of tokenRows) {
    if (!belongs(row.conversation_id)) continue;
    const u = readUsage(row.payload);
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    imageCount += readImages(row.payload);
  }

  let audioCostUsd = 0;
  let audioSeconds = 0;
  let audioCount = 0;
  for (const row of audioRows) {
    if (!belongs(row.conversation_id)) continue;
    const a = readAudio(row.payload);
    audioCostUsd += a.costUsd;
    audioSeconds += a.durationSec;
    audioCount += 1;
  }

  const tokenCost = tokenCostUsd(inputTokens, outputTokens);
  // Imágenes: estimado en tokens de entrada → costo, acotado a que no exceda el
  // costo de tokens (así el texto nunca queda negativo y el total no se infla).
  const imageInputTokensEst = imageCount * EST_IMAGE_INPUT_TOKENS;
  const imageCostUsd = Math.min(
    tokenCost,
    (imageInputTokensEst / 1e6) * GPT5_MINI_INPUT_PER_1M,
  );
  const textCostUsd = tokenCost - imageCostUsd;

  return {
    inputTokens,
    outputTokens,
    imageCount,
    audioCount,
    audioSeconds,
    textCostUsd,
    imageCostUsd,
    audioCostUsd,
    totalCostUsd: tokenCost + audioCostUsd,
  };
}

/** Etiqueta liviana para los chips de la lista (id + nombre + color). */
export interface ConversationLabelLite {
  id: string;
  name: string;
  color: string;
}

export interface ConversationRow {
  id: string;
  contactName: string | null;
  phone: string;
  status: ConversationStatus;
  method: FulfillmentMethod;
  aiPaused: boolean;
  lastActivity: string | null;
  lastMessage: string | null;
  /** ¿La conversación tiene al menos un pedido (`orders`)? */
  hasOrder: boolean;
  /** Estado del pedido más reciente (para el badge de la lista). null si no tiene. */
  orderStatus: OrderStatus | null;
  /** Etiquetas de la conversación (para identificarla de un vistazo). */
  labels: ConversationLabelLite[];
  /** Agente dueño de la conversación (para el chip de marca/país en la lista). */
  agentId: string | null;
  agentName: string | null;
  agentBrand: string | null;
}

/**
 * Clave de orden/actividad de la lista:
 *  - "inbound"  → por el ÚLTIMO mensaje del cliente (`last_inbound_at`).
 *  - "outbound" → por la ÚLTIMA respuesta del bot/agente (`last_outbound_at`).
 * Según el caso conviene ver una u otra (p. ej. "quién escribió hace poco" vs
 * "a quién le respondimos de últimas"). Ver ADR-0045.
 */
export type ConversationOrderBy = "inbound" | "outbound";

export interface ConversationFilters {
  limit?: number;
  /** Desplazamiento para paginar (0-based, default 0). Con `hasOrder` se corta tras filtrar en JS. */
  offset?: number;
  /** Filtra por estado de la conversación. */
  status?: ConversationStatus;
  /** true = solo con pedido · false = solo sin pedido · undefined = todas. */
  hasOrder?: boolean;
  /** Ventana de actividad reciente en días (por la clave de orden). undefined = sin límite. */
  sinceDays?: number;
  /** Clave de orden: "inbound" (último del cliente, default) | "outbound" (última respuesta). */
  orderBy?: ConversationOrderBy;
  /** Filtra por agente (marca/número). undefined = todos los agentes (migración 0010). */
  agentId?: string;
  /** true = solo conversaciones que tuvieron llamada con IA. undefined = todas. Ver docs/25. */
  hasVoiceCall?: boolean;
  /** Filtra por etiqueta (id de `labels`): solo conversaciones con esa etiqueta. undefined = todas. */
  labelId?: string;
  /** true = solo conversaciones SIN ninguna etiqueta (la cola por clasificar). Ignora `labelId`. */
  withoutLabel?: boolean;
  /** Día calendario (YYYY-MM-DD, hora Colombia) desde el que se incluyen. Inclusivo. */
  fromDate?: string;
  /** Día calendario (YYYY-MM-DD, hora Colombia) hasta el que se incluyen. Inclusivo. */
  toDate?: string;
  /** Filtra por producto/fuente (`product_category` exacto). undefined = todos. */
  productCategory?: string;
  /** Búsqueda por contacto: nombre o teléfono, coincidencia parcial sin mayúsculas. */
  contactSearch?: string;
  /** Palabra clave: solo conversaciones con algún mensaje cuyo texto la contenga. */
  keyword?: string;
}

/** Fila cruda de `conversations` para la lista (last_outbound_at opcional: migración 0023). */
type ConvoListRow = {
  id: string;
  contact_id: string;
  agent_id: string | null;
  status: ConversationStatus;
  fulfillment_method: FulfillmentMethod;
  ai_paused: boolean;
  last_inbound_at: string | null;
  last_outbound_at?: string | null;
  updated_at: string;
};

/** Etiqueta en español para el último mensaje cuando no hay texto que mostrar. */
const LAST_MESSAGE_TYPE_LABEL: Record<string, string> = {
  image: "[imagen]",
  audio: "[audio]",
  video: "[video]",
  document: "[documento]",
  other: "[mensaje]",
};

/**
 * Vista de UNA línea del último mensaje para la lista de Conversaciones. Los
 * no-texto CON contenido muestran su primera línea — la nota de llamada IA se
 * guarda como `type:"other"` pero su contenido empieza con "Llamada con IA — …",
 * que es exactamente lo que hay que leer (antes salía un "[other]" críptico que
 * se confundía con un mensaje del cliente). Lo mismo aplica al caption de una
 * imagen. Sin contenido, cae a una etiqueta en español por tipo.
 */
function lastMessagePreview(lm: { content: string | null; type: MessageType }): string | null {
  if (lm.type === "text") return lm.content;
  const firstLine = (lm.content ?? "").trim().split(/\r?\n/)[0];
  if (firstLine) return firstLine;
  return LAST_MESSAGE_TYPE_LABEL[lm.type] ?? `[${lm.type}]`;
}

export async function getRecentConversations(
  opts: ConversationFilters = {},
): Promise<ConversationRow[]> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const orderBy: ConversationOrderBy = opts.orderBy === "outbound" ? "outbound" : "inbound";
  const supabase = createServiceClient();

  /**
   * Filtro por etiqueta: PostgREST no filtra cómodamente por el embed de `labels`,
   * así que primero resolvemos las conversaciones que TIENEN esa etiqueta y luego
   * acotamos la lista con `.in("id", ...)`. Paginado por si una etiqueta cubre >1000
   * conversaciones. Volumen v1 bajo → el `.in` con esos ids es aceptable; si crece
   * mucho, mover el join a la BD (vista/RPC). Sin coincidencias → lista vacía.
   */
  let labelConvoIds: string[] | null = null;
  if (opts.labelId) {
    const rows = await fetchAllRows(
      (from, to) =>
        supabase
          .from("conversation_labels")
          .select("conversation_id")
          .eq("label_id", opts.labelId as string)
          .range(from, to),
      "getRecentConversations label ids",
    );
    labelConvoIds = [...new Set(rows.map((r) => r.conversation_id))];
    if (labelConvoIds.length === 0) return [];
  }

  /**
   * Filtro "sin etiqueta" (la cola por clasificar). NO se resuelve en la consulta:
   * en la práctica casi ninguna conversación está etiquetada, así que el conjunto
   * "sin etiqueta" es casi toda la tabla y tanto un `.in(...)` con el complemento
   * como un `not.in(...)` pasan de miles de UUIDs → PostgREST devuelve 400 por
   * URL demasiado larga (comprobado contra la base real).
   *
   * Se filtra en JS con las etiquetas que la lista YA trae para pintar los chips
   * (cero consultas extra), igual que "con/sin pedido": se pide una ventana más
   * ancha y se recorta [offset, offset+limit) abajo. Ver `jsFiltered`.
   */
  const unlabeledOnly = Boolean(opts.withoutLabel && !opts.labelId);
  // Filtros que se resuelven DESPUÉS de la consulta → la paginación se recorta en JS.
  const jsFiltered = opts.hasOrder != null || unlabeledOnly;

  /**
   * Filtro "tuvo llamada con IA": se resuelven los `conversation_id` de
   * `voice_calls` y se acotan con `.in("id", ...)`, igual que el de etiqueta. Si
   * además hay etiqueta, se INTERSECTAN los dos conjuntos. Resiliente a que falte
   * la tabla (migración 0027): sin ids → lista vacía, no excepción. Ver docs/25.
   */
  if (opts.hasVoiceCall) {
    const callIds = await getConversationIdsWithVoiceCall();
    if (callIds.length === 0) return [];
    const callIdSet = new Set(callIds);
    labelConvoIds = labelConvoIds ? labelConvoIds.filter((id) => callIdSet.has(id)) : callIds;
    if (labelConvoIds.length === 0) return [];
  }

  /**
   * Búsqueda por contacto (nombre o teléfono): se resuelven los `contacts.id` que
   * coinciden y se acota con `.in("contact_id", ...)`. El término se limpia de los
   * caracteres reservados del `or()` de PostgREST y se cita, y si trae dígitos se
   * busca ADEMÁS por esos dígitos en el teléfono — que se guarda E.164 sin `+`,
   * así "+57 300 123" encuentra "57300123…". Tope 200 contactos para que la URL
   * del `.in` no explote (miles de UUIDs → 400); una búsqueda razonable no lo
   * alcanza. Sin coincidencias → lista vacía, no error. Ver ADR-0071.
   */
  let searchContactIds: string[] | null = null;
  if (opts.contactSearch) {
    const term = opts.contactSearch.replace(/[,()"\\]/g, " ").trim();
    const digits = term.replace(/\D/g, "");
    const ors: string[] = [];
    if (term) ors.push(`name.ilike."*${term}*"`);
    if (digits.length >= 3) ors.push(`phone.ilike."*${digits}*"`);
    if (ors.length > 0) {
      const { data, error: searchErr } = await supabase
        .from("contacts")
        .select("id")
        .or(ors.join(","))
        .limit(200);
      if (searchErr) {
        throw new Error(`getRecentConversations contact search: ${searchErr.message}`);
      }
      searchContactIds = (data ?? []).map((r) => r.id);
      if (searchContactIds.length === 0) return [];
    }
  }

  /**
   * Filtro por palabra clave: conversaciones con ALGÚN mensaje cuyo texto contenga
   * el término (`messages.content ilike`, sin mayúsculas; `%`/`_` del usuario se
   * escapan para que sean literales). Se leen los mensajes coincidentes MÁS
   * RECIENTES (tope 1000, el máximo de PostgREST), se dedupe a máximo 200
   * conversaciones y se intersecta con los conjuntos de etiqueta/llamada, igual
   * que arriba. Con un término genérico ("hola") se ven las ~200 conversaciones
   * con coincidencia más reciente — volumen v1 bajo → aceptable; si crece, mover
   * a una RPC con full-text. Ver ADR-0071.
   */
  if (opts.keyword) {
    const pattern = `%${opts.keyword.replace(/([%_\\])/g, "\\$1")}%`;
    const { data, error: kwErr } = await supabase
      .from("messages")
      .select("conversation_id")
      .ilike("content", pattern)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (kwErr) throw new Error(`getRecentConversations keyword: ${kwErr.message}`);
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const r of data ?? []) {
      if (seen.has(r.conversation_id)) continue;
      seen.add(r.conversation_id);
      ids.push(r.conversation_id);
      if (ids.length >= 200) break;
    }
    if (ids.length === 0) return [];
    const kwIdSet = new Set(ids);
    labelConvoIds = labelConvoIds ? labelConvoIds.filter((id) => kwIdSet.has(id)) : ids;
    if (labelConvoIds.length === 0) return [];
  }

  /**
   * Corre la consulta de conversaciones. `hasOutboundCol` = false reintenta sin
   * `last_outbound_at` (resiliencia a que falte la migración 0023): en ese caso
   * SIEMPRE se ordena por `last_inbound_at`, así la página no se cae entre el
   * deploy y la migración.
   *
   * Se ordena por la ACTIVIDAD REAL (last_inbound_at / last_outbound_at), que la
   * app/trigger fijan explícitamente, y NO por `updated_at` (depende del trigger
   * `set_updated_at` y puede quedar "pegado" al recrear el esquema, hundiendo
   * conversaciones recién activas). `updated_at` e `id` quedan solo como desempate.
   */
  async function runConvoQuery(hasOutboundCol: boolean) {
    const useOutbound = hasOutboundCol && orderBy === "outbound";
    const sortCol = useOutbound ? "last_outbound_at" : "last_inbound_at";
    const cols = hasOutboundCol
      ? "id, contact_id, agent_id, status, fulfillment_method, ai_paused, last_inbound_at, last_outbound_at, updated_at"
      : "id, contact_id, agent_id, status, fulfillment_method, ai_paused, last_inbound_at, updated_at";

    let q = supabase
      .from("conversations")
      .select(cols)
      // NULLS LAST: conversaciones sin actividad en esa dirección quedan al final.
      .order(sortCol, { ascending: false, nullsFirst: false })
      // Desempates estables (sin esto, dos con el mismo timestamp podrían
      // reordenarse entre páginas → saltos/duplicados al paginar).
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false });
    if (opts.status) q = q.eq("status", opts.status);
    // `agent_id` vive en `conversations` desde la migración 0010 (columna base).
    if (opts.agentId) q = q.eq("agent_id", opts.agentId);
    // Búsqueda por contacto: ids ya resueltos arriba (nombre o teléfono).
    if (searchContactIds) q = q.in("contact_id", searchContactIds);
    // Etiqueta: conversaciones ya resueltas arriba (ids con ese `label_id`).
    if (labelConvoIds) q = q.in("id", labelConvoIds);
    // Producto/fuente (`product_category`, migración 0018). La página solo lo aplica
    // tras validarlo contra las opciones reales, así que la columna siempre existe.
    if (opts.productCategory) q = q.eq("product_category", opts.productCategory);
    if (opts.sinceDays != null) {
      const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString();
      // Ventana por la MISMA clave de orden (coherente con la lista).
      q = q.gte(sortCol, since);
    }
    // Rango exacto desde/hasta (días calendario de Bogota), también sobre la clave
    // de orden. La página nunca manda rango y `sinceDays` a la vez: elegir uno
    // limpia el otro, para que la ventana no sea ambigua.
    if (opts.fromDate) q = q.gte(sortCol, bogotaDayStartIso(opts.fromDate));
    if (opts.toDate) q = q.lt(sortCol, bogotaDayEndIso(opts.toDate));
    if (!jsFiltered) {
      // Fecha/estado son filtros de BD → paginación EXACTA con range(offset..offset+limit-1).
      q = q.range(offset, offset + limit - 1);
    } else {
      // "con/sin pedido" (cruza con `orders`) y "sin etiqueta" (cruza con
      // `conversation_labels`) se resuelven en JS: traemos desde el inicio lo
      // suficiente para cubrir la página pedida (con margen) y cortamos
      // [offset, offset+limit) abajo. Volumen v1 bajo → aceptable; si crece, mover a
      // una vista/RPC. Tope 1000 (límite de PostgREST); no se alcanza con volumen v1.
      q = q.limit(Math.min(Math.max((offset + limit) * 5, 200), 1000));
    }

    const res = await q;
    return { data: res.data as unknown as ConvoListRow[] | null, error: res.error };
  }

  let { data: convos, error } = await runConvoQuery(true);
  // 42703 = columna inexistente (migración 0023 sin aplicar) → reintenta sin ella.
  if (error && error.code === "42703") ({ data: convos, error } = await runConvoQuery(false));
  if (error) throw new Error(`getRecentConversations: ${error.message}`);

  const rows = convos ?? [];
  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const convoIds = rows.map((r) => r.id);
  const agentIds = [...new Set(rows.map((r) => r.agent_id).filter((id): id is string => !!id))];

  const [contactsRes, msgsRes, ordersRes, labelsRes, agentsRes] = await Promise.all([
    supabase.from("contacts").select("id, name, phone").in("id", contactIds),
    supabase
      .from("messages")
      .select("conversation_id, content, type, created_at")
      .in("conversation_id", convoIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("conversation_id, status, created_at")
      .in("conversation_id", convoIds)
      .order("created_at", { ascending: false }),
    // Etiquetas por conversación (embed de `labels`). Resiliente: si aún no se
    // aplicó la migración 0014, esta consulta falla y se ignora (sin chips).
    supabase
      .from("conversation_labels")
      .select("conversation_id, labels(id, name, color)")
      .in("conversation_id", convoIds),
    // Agente de cada conversación (marca/país) para el chip de la lista. Solo los
    // agentes de la página (pocos). Resiliente: si falla, la lista sale sin chip.
    agentIds.length > 0
      ? supabase.from("agents").select("id, name, brand").in("id", agentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (contactsRes.error) throw new Error(`getRecentConversations contacts: ${contactsRes.error.message}`);
  if (msgsRes.error) throw new Error(`getRecentConversations messages: ${msgsRes.error.message}`);
  if (ordersRes.error) throw new Error(`getRecentConversations orders: ${ordersRes.error.message}`);

  const contactById = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));
  const agentById = new Map(
    ((agentsRes.error ? [] : agentsRes.data) ?? []).map(
      (a: { id: string; name: string; brand: string | null }) => [a.id, a] as const,
    ),
  );
  const lastMsgByConvo = new Map<string, { content: string | null; type: MessageType }>();
  for (const m of msgsRes.data ?? []) {
    if (!lastMsgByConvo.has(m.conversation_id)) {
      lastMsgByConvo.set(m.conversation_id, { content: m.content, type: m.type as MessageType });
    }
  }
  // Estado del pedido más reciente por conversación (orders ya viene desc).
  const orderByConvo = new Map<string, OrderStatus>();
  for (const o of ordersRes.data ?? []) {
    if (!orderByConvo.has(o.conversation_id)) {
      orderByConvo.set(o.conversation_id, o.status as OrderStatus);
    }
  }

  // Etiquetas por conversación. El embed `labels(...)` puede venir como objeto o
  // arreglo según PostgREST; se normaliza. Si la consulta falló (tabla ausente),
  // el mapa queda vacío y la lista no muestra chips (resiliencia).
  const labelsByConvo = new Map<string, ConversationLabelLite[]>();
  if (!labelsRes.error) {
    type EmbedRow = {
      conversation_id: string;
      labels: ConversationLabelLite | ConversationLabelLite[] | null;
    };
    for (const row of (labelsRes.data ?? []) as EmbedRow[]) {
      const label = Array.isArray(row.labels) ? row.labels[0] : row.labels;
      if (!label) continue;
      const arr = labelsByConvo.get(row.conversation_id) ?? [];
      arr.push({ id: label.id, name: label.name, color: label.color });
      labelsByConvo.set(row.conversation_id, arr);
    }
  }

  let mapped: ConversationRow[] = rows.map((r) => {
    const c = contactById.get(r.contact_id);
    const lm = lastMsgByConvo.get(r.id);
    const orderStatus = orderByConvo.get(r.id) ?? null;
    // La hora mostrada sigue la clave de orden: por "outbound" muestra la última
    // respuesta; por "inbound", el último mensaje del cliente (con fallbacks).
    const lastActivity =
      orderBy === "outbound"
        ? r.last_outbound_at ?? r.last_inbound_at ?? r.updated_at
        : r.last_inbound_at ?? r.updated_at;
    return {
      id: r.id,
      contactName: c?.name ?? null,
      phone: c?.phone ?? "",
      status: r.status,
      method: r.fulfillment_method,
      aiPaused: r.ai_paused,
      lastActivity,
      lastMessage: lm ? lastMessagePreview(lm) : null,
      hasOrder: orderStatus != null,
      orderStatus,
      labels: labelsByConvo.get(r.id) ?? [],
      agentId: r.agent_id ?? null,
      agentName: (r.agent_id && agentById.get(r.agent_id)?.name) || null,
      agentBrand: (r.agent_id && agentById.get(r.agent_id)?.brand) || null,
    };
  });

  if (opts.hasOrder === true) mapped = mapped.filter((r) => r.hasOrder);
  else if (opts.hasOrder === false) mapped = mapped.filter((r) => !r.hasOrder);

  // "Sin etiqueta" se lee de los chips que ya se armaron arriba. Si la tabla de
  // etiquetas no existe (migración 0014), TODAS quedan sin etiqueta — que es la
  // lectura correcta, no un error.
  if (unlabeledOnly) mapped = mapped.filter((r) => r.labels.length === 0);

  // Sin filtros de JS ya vino paginado por range(); con ellos recortamos la
  // ventana [offset, offset+limit) después de filtrar.
  return jsFiltered ? mapped.slice(offset, offset + limit) : mapped;
}

export interface ConversationFilterOptions {
  /** Etiquetas EN USO (asignadas a alguna conversación del alcance), ordenadas por nombre. */
  labels: ConversationLabelLite[];
  /** Productos/fuentes distintos (`product_category`) del alcance, ordenados alfabéticamente. */
  products: string[];
}

/**
 * Opciones para los filtros de la lista de Conversaciones: etiquetas en uso y
 * productos (fuentes) distintos, opcionalmente acotados a un agente. Solo incluye
 * valores que REALMENTE existen en los datos, así ninguna opción del dropdown da una
 * lista vacía y la validación en la página descarta parámetros inventados.
 *
 * Resiliente a la ventana de migración: si falta `product_category` (0018) no hay
 * productos; si falta la tabla de etiquetas (0014) no hay etiquetas — el resto sigue
 * funcionando. Volumen v1 bajo → lee y dedupe en JS (mismo criterio que
 * `getProductConversion`); si crece mucho, mover a una vista/RPC.
 */
export async function getConversationFilterOptions(
  agentId?: string,
): Promise<ConversationFilterOptions> {
  const supabase = createServiceClient();

  // Conversaciones (id + categoría) del alcance. Si falta la columna de categoría
  // (0018), se cae a solo ids (sin productos) en vez de romper.
  let convos: Array<{ id: string; product_category: string | null }>;
  try {
    convos = await fetchAllRows(
      (from, to) => {
        let q = supabase.from("conversations").select("id, product_category");
        if (agentId) q = q.eq("agent_id", agentId);
        return q.range(from, to);
      },
      "getConversationFilterOptions conversations",
    );
  } catch {
    const ids = await fetchAllRows(
      (from, to) => {
        let q = supabase.from("conversations").select("id");
        if (agentId) q = q.eq("agent_id", agentId);
        return q.range(from, to);
      },
      "getConversationFilterOptions conv ids",
    );
    convos = ids.map((c) => ({ id: c.id, product_category: null }));
  }

  const products = [
    ...new Set(convos.map((c) => (c.product_category ?? "").trim()).filter((p) => p.length > 0)),
  ].sort((a, b) => a.localeCompare(b, "es"));

  // Con agente: solo etiquetas de SUS conversaciones. Sin agente: todas las usadas.
  const convoIdSet = agentId ? new Set(convos.map((c) => c.id)) : null;

  const labelsById = new Map<string, ConversationLabelLite>();
  try {
    const rows = await fetchAllRows(
      (from, to) =>
        supabase
          .from("conversation_labels")
          .select("conversation_id, labels(id, name, color)")
          .range(from, to),
      "getConversationFilterOptions labels",
    );
    type EmbedRow = {
      conversation_id: string;
      labels: ConversationLabelLite | ConversationLabelLite[] | null;
    };
    for (const row of rows as EmbedRow[]) {
      if (convoIdSet && !convoIdSet.has(row.conversation_id)) continue;
      const label = Array.isArray(row.labels) ? row.labels[0] : row.labels;
      if (!label) continue;
      if (!labelsById.has(label.id)) {
        labelsById.set(label.id, { id: label.id, name: label.name, color: label.color });
      }
    }
  } catch {
    // Tabla de etiquetas ausente (migración 0014 sin aplicar) → sin filtro de etiquetas.
  }

  const labels = [...labelsById.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));

  return { labels, products };
}

// --- Retargets (seguimientos automáticos, ver docs/10) ---------------------

export interface RetargetStats {
  scheduled: number;
  processing: number;
  sent: number;
  skipped: number;
  cancelled: number;
  failed: number;
}

/** Conteo por estado sobre TODOS los seguimientos (volumen v1 bajo → tally en JS). */
export async function getRetargetStats(): Promise<RetargetStats> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("retargets").select("status");
  if (error) throw new Error(`getRetargetStats: ${error.message}`);

  const stats: RetargetStats = {
    scheduled: 0,
    processing: 0,
    sent: 0,
    skipped: 0,
    cancelled: 0,
    failed: 0,
  };
  for (const row of data ?? []) {
    const s = row.status as RetargetStatus;
    if (s in stats) stats[s] += 1;
  }
  return stats;
}

export interface RetargetRow {
  id: string;
  conversationId: string;
  contactName: string | null;
  phone: string;
  stage: number;
  /** Delay real de esta etapa en minutos (null en filas legadas). */
  delayMinutes: number | null;
  status: RetargetStatus;
  scheduledAt: string;
  sentAt: string | null;
  error: string | null;
}

/** Seguimientos recientes (los más próximos a dispararse / recién movidos). */
export async function getRecentRetargets(limit = 50): Promise<RetargetRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("retargets")
    .select(
      "id, conversation_id, contact_id, phone, stage, delay_minutes, status, scheduled_at, sent_at, error",
    )
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentRetargets: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const contactsRes = await supabase
    .from("contacts")
    .select("id, name, phone")
    .in("id", contactIds);
  if (contactsRes.error) throw new Error(`getRecentRetargets contacts: ${contactsRes.error.message}`);
  const contactById = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));

  return rows.map((r) => {
    const c = contactById.get(r.contact_id);
    return {
      id: r.id,
      conversationId: r.conversation_id,
      contactName: c?.name ?? null,
      phone: c?.phone ?? r.phone ?? "",
      stage: r.stage,
      delayMinutes: r.delay_minutes ?? null,
      status: r.status as RetargetStatus,
      scheduledAt: r.scheduled_at,
      sentAt: r.sent_at,
      error: r.error,
    };
  });
}

export interface ConversationMessage {
  id: string;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  mediaUrl: string | null;
  /** Tags crudos que emitió la IA (#ID..., #compra-contra-entrega, etc.). */
  tags: string[];
  createdAt: string;
}

export interface ConversationOrder {
  id: string;
  status: OrderStatus;
  total: number | null;
  itemsCount: number;
  /** Nombres de los productos pedidos (sin repetir), para saber QUÉ se compró. */
  productNames: string[];
  shippingName: string | null;
  shippingCity: string | null;
  method: FulfillmentMethod;
  /** Fecha de creación (para ordenar las órdenes de la conversación, más nueva primero). */
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  agentId: string | null;
  status: ConversationStatus;
  method: FulfillmentMethod;
  aiPaused: boolean;
  createdAt: string;
  /** Producto/fuente de la conversación (null = sin categorizar). */
  productCategory: string | null;
  /** ¿La conversación entró por el flujo de Hotmart (carrito de cursos)? */
  hotmartFlow: boolean;
  contact: { name: string | null; phone: string } | null;
  messages: ConversationMessage[];
  /** Todas las órdenes de la conversación, de la más nueva a la más vieja (puede haber
   *  varias: canceladas + activa). El panel las lista y permite crear otra. Ver ADR-0059. */
  orders: ConversationOrder[];
}

export async function getConversation(id: string): Promise<ConversationDetail | null> {
  const supabase = createServiceClient();
  const { data: convo, error } = await supabase
    .from("conversations")
    .select("id, contact_id, agent_id, status, fulfillment_method, ai_paused, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getConversation: ${error.message}`);
  if (!convo) return null;

  const [contactRes, msgsRes, orderRes, pcRes, hfRes] = await Promise.all([
    supabase.from("contacts").select("name, phone").eq("id", convo.contact_id).maybeSingle(),
    supabase
      .from("messages")
      .select("id, direction, type, content, media_url, tags, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("orders")
      .select("id, status, total, fulfillment_method, shipping_name, shipping_city, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false }),
    // Fuente de producto en consulta aparte: si falta la migración 0018 (columna),
    // esta falla y se ignora sin romper el detalle. Ver docs/21.
    supabase.from("conversations").select("product_category").eq("id", id).maybeSingle(),
    // Marca de flujo Hotmart en consulta aparte (mismo motivo: resiliente a que
    // falte la migración 0019). Ver ADR-0040.
    supabase.from("conversations").select("hotmart_flow").eq("id", id).maybeSingle(),
  ]);
  if (msgsRes.error) throw new Error(`getConversation messages: ${msgsRes.error.message}`);
  const productCategory = pcRes.error ? null : pcRes.data?.product_category ?? null;
  const hotmartFlow = hfRes.error ? false : hfRes.data?.hotmart_flow === true;

  // Todas las órdenes de la conversación (más nueva primero), con su conteo de ítems.
  // Puede haber varias (p. ej. una cancelada + una nueva); el panel las lista todas.
  const orderRows = orderRes.error ? [] : orderRes.data ?? [];
  const itemsByOrder = new Map<string, number>();
  const namesByOrder = new Map<string, Set<string>>();
  if (orderRows.length > 0) {
    const orderIds = orderRows.map((o) => o.id);
    const { data: itemRows } = await supabase
      .from("order_items")
      .select("order_id, sku, name")
      .in("order_id", orderIds);
    for (const it of itemRows ?? []) {
      itemsByOrder.set(it.order_id, (itemsByOrder.get(it.order_id) ?? 0) + 1);
      // Sin nombre guardado el SKU es lo único que identifica al producto.
      const label = it.name?.trim() || it.sku;
      if (label) {
        const set = namesByOrder.get(it.order_id) ?? new Set<string>();
        set.add(label);
        namesByOrder.set(it.order_id, set);
      }
    }
  }
  const orders: ConversationOrder[] = orderRows.map((o) => ({
    id: o.id,
    status: o.status,
    total: o.total,
    itemsCount: itemsByOrder.get(o.id) ?? 0,
    productNames: [...(namesByOrder.get(o.id) ?? [])],
    shippingName: o.shipping_name,
    shippingCity: o.shipping_city,
    method: o.fulfillment_method,
    createdAt: o.created_at,
  }));

  return {
    id: convo.id,
    agentId: convo.agent_id,
    status: convo.status,
    method: convo.fulfillment_method,
    aiPaused: convo.ai_paused,
    createdAt: convo.created_at,
    productCategory,
    hotmartFlow,
    contact: contactRes.data
      ? { name: contactRes.data.name, phone: contactRes.data.phone }
      : null,
    messages: (msgsRes.data ?? []).map((m) => ({
      id: m.id,
      direction: m.direction as MessageDirection,
      type: m.type as MessageType,
      content: m.content,
      mediaUrl: m.media_url,
      tags: Array.isArray(m.tags) ? (m.tags as string[]) : [],
      createdAt: m.created_at,
    })),
    orders,
  };
}

export interface ConversationEvent {
  id: string;
  type: string;
  payload: unknown;
  createdAt: string;
}

/**
 * Eventos recientes de una conversación (`events_log`) para el panel de diagnóstico
 * "¿por qué no respondió?" del detalle (lo más reciente primero). El humanizado vive
 * en `lib/dashboard/events.ts` (puro). Resiliente: ante error devuelve [] — el
 * diagnóstico es un plus y no debe romper el detalle de la conversación.
 */
export async function getConversationEvents(
  conversationId: string,
  limit = 25,
): Promise<ConversationEvent[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("events_log")
    .select("id, type, payload, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((e) => ({
    id: e.id,
    type: e.type,
    payload: e.payload,
    createdAt: e.created_at,
  }));
}

// --- Órdenes (sección dedicada, ver docs/12) --------------------------------

export interface OrderRow {
  id: string;
  conversationId: string;
  contactName: string | null;
  phone: string;
  status: OrderStatus;
  method: FulfillmentMethod;
  total: number | null;
  /** Moneda NATIVA de la orden (la del agente que la generó). Ver ADR-0068. */
  currency: string;
  itemsCount: number;
  /** Nombres de los productos de la orden (sin repetir), para verla sin abrirla. */
  productNames: string[];
  /**
   * Producto/fuente de la conversación que originó la orden (`conversations.product_category`):
   * de qué pauta o palabra clave llegó el cliente. `null` si no se categorizó o si falta
   * la migración 0018. Ver ADR-0076.
   */
  productCategory: string | null;
  shippingCity: string | null;
  createdAt: string;
  /** Agente dueño (vía la conversación). null en órdenes manuales sueltas. */
  agentId?: string | null;
  agentName?: string | null;
  /**
   * Total ya expresado en la moneda de lectura. Igual a `total` cuando no hubo
   * conversión; `null` si la orden no tiene monto o no se pudo convertir.
   */
  displayTotal?: number | null;
  displayCurrency?: CurrencyCode;
}

/** Lista de órdenes (opcionalmente filtrada por estado), más recientes primero. */
export async function getOrders(opts?: {
  status?: OrderStatus;
  limit?: number;
}): Promise<OrderRow[]> {
  const supabase = createServiceClient();
  let q = supabase
    .from("orders")
    .select(
      "id, conversation_id, contact_id, status, fulfillment_method, total, currency, shipping_city, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.status) q = q.eq("status", opts.status);

  const { data, error } = await q;
  if (error) throw new Error(`getOrders: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const orderIds = rows.map((r) => r.id);
  const convoIds = [...new Set(rows.map((r) => r.conversation_id))];

  const [contactsRes, itemsRes, categoryByConvo] = await Promise.all([
    supabase.from("contacts").select("id, name, phone").in("id", contactIds),
    supabase.from("order_items").select("order_id, sku, name").in("order_id", orderIds),
    categoriesByConversation(supabase, convoIds),
  ]);
  if (contactsRes.error) throw new Error(`getOrders contacts: ${contactsRes.error.message}`);
  if (itemsRes.error) throw new Error(`getOrders items: ${itemsRes.error.message}`);

  const contactById = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));
  const itemsByOrder = new Map<string, number>();
  const namesByOrder = new Map<string, Set<string>>();
  for (const it of itemsRes.data ?? []) {
    itemsByOrder.set(it.order_id, (itemsByOrder.get(it.order_id) ?? 0) + 1);
    const label = it.name?.trim() || it.sku;
    if (label) {
      const set = namesByOrder.get(it.order_id) ?? new Set<string>();
      set.add(label);
      namesByOrder.set(it.order_id, set);
    }
  }

  return rows.map((r) => {
    const c = contactById.get(r.contact_id);
    return {
      id: r.id,
      conversationId: r.conversation_id,
      contactName: c?.name ?? null,
      phone: c?.phone ?? "",
      status: r.status,
      method: r.fulfillment_method,
      total: r.total,
      currency: r.currency,
      itemsCount: itemsByOrder.get(r.id) ?? 0,
      productNames: [...(namesByOrder.get(r.id) ?? [])],
      productCategory: categoryByConvo.get(r.conversation_id) ?? null,
      shippingCity: r.shipping_city,
      createdAt: r.created_at,
    };
  });
}

export interface OrderListFilters {
  status?: OrderStatus;
  /** Texto libre: teléfono, nombre del contacto o ciudad. Sin acentos y sin mayúsculas. */
  q?: string;
  /** SKU exacto de un ítem de la orden. */
  sku?: string;
  /** Agente dueño de la conversación que originó la orden. Ver ADR-0068. */
  agentId?: string;
  /**
   * Moneda en la que se quiere LEER el resultado. Al filtrar por un agente manda
   * la suya (se ignora esto); viendo todos, homologa la mezcla a esta. Ver ADR-0068.
   */
  display?: CurrencyCode;
  /** Página 1-based. */
  page?: number;
  pageSize?: number;
}

export interface OrdersSummary {
  /** Órdenes que cumplen el filtro (todas, no solo la página). */
  count: number;
  /** Monto de las órdenes NO canceladas, YA en `currency`. */
  revenue: number;
  /** Monto de las confirmadas, ya en `currency`. */
  confirmedRevenue: number;
  /** Ticket promedio de las no canceladas que tienen total, ya en `currency`. */
  avgTicket: number;
  /** Moneda en la que están expresados los montos de arriba. */
  currency: CurrencyCode;
  /** true si hubo que convertir al menos una orden (los totales son equivalencias). */
  converted: boolean;
  /**
   * Órdenes que quedaron FUERA de las sumas por no tener tasa. Se expone para
   * decirlo en pantalla: un total que esconde filas descartadas miente.
   */
  excluded: number;
}

/**
 * Producto/fuente por conversación (`conversations.product_category`) — de qué pauta o
 * palabra clave llegó el cliente. Es lo que conecta una orden con la campaña que la trajo.
 *
 * Best-effort a propósito: si falta la migración 0018 la columna no existe y la consulta
 * falla; ahí devuelve un mapa vacío y las órdenes se listan sin fuente, en vez de dejar la
 * página en error. Mismo criterio que en `getConversation`. Ver ADR-0076.
 *
 * `ids` acota la consulta cuando ya se sabe qué conversaciones interesan; sin él, barre todas.
 */
async function categoriesByConversation(
  supabase: ReturnType<typeof createServiceClient>,
  ids?: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    if (ids && ids.length === 0) return out;
    const rows = ids
      ? (await supabase.from("conversations").select("id, product_category").in("id", ids)).data
      : await fetchAllRows(
          (from, to) =>
            supabase.from("conversations").select("id, product_category").range(from, to),
          "categoriesByConversation",
        );
    for (const r of rows ?? []) {
      const value = r.product_category?.trim();
      if (value) out.set(r.id, value);
    }
  } catch {
    // Sin columna (migración 0018 pendiente): se lista sin fuente y ya.
  }
  return out;
}

export interface OrdersPage {
  rows: OrderRow[];
  summary: OrdersSummary;
  page: number;
  hasNext: boolean;
  /** Productos presentes en las órdenes (para el selector), ordenados por nombre. */
  products: Array<{ sku: string; name: string }>;
  /** Agentes con órdenes (para el selector), con su moneda. */
  agents: Array<{ id: string; name: string; brand: string | null; currency: CurrencyCode }>;
  /** `method → etiqueta` de todos los agentes (la lista mezcla marcas). Ver ADR-0080. */
  methodLabels: Record<string, string>;
}

/**
 * Lista de órdenes con filtros, resumen y paginación.
 *
 * Barre TODAS las órdenes y filtra en JS (mismo criterio que los reportes) en vez
 * de empujar los filtros a PostgREST. Es a propósito: buscar por teléfono/nombre
 * cruza `contacts` y buscar por producto cruza `order_items`, y los totales del
 * encabezado tienen que cubrir el filtro COMPLETO, no la página que se ve. Con el
 * volumen v1 el barrido es barato; si crece, esto se muda a una vista/RPC.
 */
export async function getOrdersPage(opts: OrderListFilters = {}): Promise<OrdersPage> {
  const pageSize = opts.pageSize ?? 50;
  const page = Math.max(1, opts.page ?? 1);
  const supabase = createServiceClient();

  const [orders, items, contacts, convos, agents] = await Promise.all([
    fetchAllRows(
      (from, to) =>
        supabase
          .from("orders")
          .select(
            "id, conversation_id, contact_id, status, fulfillment_method, total, currency, shipping_city, created_at",
          )
          .order("created_at", { ascending: false })
          .range(from, to),
      "getOrdersPage orders",
    ),
    fetchAllRows(
      (from, to) => supabase.from("order_items").select("order_id, sku, name").range(from, to),
      "getOrdersPage items",
    ),
    fetchAllRows(
      (from, to) => supabase.from("contacts").select("id, name, phone").range(from, to),
      "getOrdersPage contacts",
    ),
    // La orden no lleva `agent_id`: cuelga de su conversación (migración 0010).
    fetchAllRows(
      (from, to) => supabase.from("conversations").select("id, agent_id").range(from, to),
      "getOrdersPage conversations",
    ),
    getAgents(),
  ]);

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const agentByConvo = new Map(convos.map((c) => [c.id, c.agent_id as string | null]));
  const agentById = new Map(agents.map((a) => [a.id, a]));

  // Producto/fuente de cada conversación (de qué pauta llegó el cliente). Va en
  // consulta aparte: si falta la migración 0018 (columna), esta falla y se ignora
  // sin tumbar la lista de órdenes. Mismo criterio que en `getConversation`.
  const categoryByConvo = await categoriesByConversation(supabase);

  // Ítems por orden: conteo (para la lista), SKUs (para el filtro de producto),
  // nombres (para ver QUÉ se pidió sin abrir la orden) y el catálogo de opciones
  // del selector (sku → nombre más reciente que se vio).
  const itemsByOrder = new Map<
    string,
    { count: number; skus: Set<string>; names: Set<string> }
  >();
  const productBySku = new Map<string, string>();
  for (const it of items) {
    const entry =
      itemsByOrder.get(it.order_id) ??
      { count: 0, skus: new Set<string>(), names: new Set<string>() };
    entry.count += 1;
    if (it.sku) entry.skus.add(it.sku);
    // Sin nombre guardado el SKU es lo único que identifica al producto.
    const label = it.name?.trim() || it.sku;
    if (label) entry.names.add(label);
    itemsByOrder.set(it.order_id, entry);
    if (it.sku && !productBySku.has(it.sku)) productBySku.set(it.sku, it.name ?? it.sku);
  }

  const q = searchKey(opts.q).trim();
  const filtered = orders.filter((o) => {
    if (opts.status && o.status !== opts.status) return false;
    if (opts.agentId && agentByConvo.get(o.conversation_id) !== opts.agentId) return false;
    if (opts.sku && !itemsByOrder.get(o.id)?.skus.has(opts.sku)) return false;
    if (q) {
      const c = contactById.get(o.contact_id);
      // Nombre, teléfono y ciudad. La comparación (acentos, dígitos sueltos) vive
      // en `matchesSearch`, que está testeada.
      if (!matchesSearch([c?.name, c?.phone, o.shipping_city], q)) return false;
    }
    return true;
  });

  // Moneda de lectura: filtrando por un agente manda la SUYA (no tiene sentido leer
  // el mercado mexicano en pesos colombianos); viendo todos, la que pida la UI.
  const filterAgent = opts.agentId ? agentById.get(opts.agentId) : undefined;
  const display: CurrencyCode = filterAgent?.currency ?? opts.display ?? DEFAULT_CURRENCY;

  // Moneda NATIVA de cada orden. Manda la del agente, no `orders.currency`: esa
  // columna tiene default 'COP' y hasta ADR-0068 nadie la escribía, así que las
  // órdenes históricas de EE.UU./México dicen "COP" sobre montos que no lo son.
  // El valor guardado solo se usa cuando la orden no tiene agente (manuales sueltas).
  const currencyOf = (o: { conversation_id: string; currency: string }): CurrencyCode => {
    const agentId = agentByConvo.get(o.conversation_id);
    const agent = agentId ? agentById.get(agentId) : undefined;
    return agent ? agent.currency : normalizeCurrency(o.currency);
  };

  // Resumen sobre el filtro COMPLETO. Las canceladas no suman monto (mismo
  // criterio que "Órdenes generadas" en Reportes) pero sí cuentan en `count`.
  const active = filtered.filter((o) => o.status !== "cancelled");

  // Suma homologada a `display`. La lógica (convertir antes de sumar, redondear una
  // sola vez, excluir lo que no tiene tasa) vive en `sumConverted`, que está testeada.
  const entriesOf = (list: typeof filtered) =>
    list.map((o) => ({ amount: o.total, currency: currencyOf(o) }));

  const sales = sumConverted(entriesOf(active), display);
  const confirmed = sumConverted(
    entriesOf(filtered.filter((o) => o.status === "confirmed")),
    display,
  );
  // El ticket promedio se reparte solo entre órdenes CON monto (> 0): meter las de
  // total 0 o vacío hundiría el promedio con filas que no son una venta medida.
  const ticketBase = sumConverted(entriesOf(active.filter((o) => Number(o.total) > 0)), display);

  const summary: OrdersSummary = {
    count: filtered.length,
    revenue: sales.total,
    confirmedRevenue: confirmed.total,
    avgTicket:
      ticketBase.counted > 0
        ? roundForCurrency(ticketBase.total / ticketBase.counted, display)
        : 0,
    currency: display,
    converted: sales.converted,
    excluded: sales.excluded,
  };

  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  return {
    rows: slice.map((r) => {
      const c = contactById.get(r.contact_id);
      const agentId = agentByConvo.get(r.conversation_id) ?? null;
      const agent = agentId ? agentById.get(agentId) : undefined;
      const native = currencyOf(r);
      return {
        id: r.id,
        conversationId: r.conversation_id,
        contactName: c?.name ?? null,
        phone: c?.phone ?? "",
        status: r.status,
        method: r.fulfillment_method,
        total: r.total,
        currency: native,
        itemsCount: itemsByOrder.get(r.id)?.count ?? 0,
        productNames: [...(itemsByOrder.get(r.id)?.names ?? [])],
        productCategory: categoryByConvo.get(r.conversation_id) ?? null,
        shippingCity: r.shipping_city,
        createdAt: r.created_at,
        agentId,
        agentName: agent?.name ?? null,
        displayTotal: (() => {
          const v = convertMoney(r.total, native, display);
          return v == null ? null : roundForCurrency(v, display);
        })(),
        displayCurrency: display,
      };
    }),
    summary,
    page,
    hasNext: start + pageSize < filtered.length,
    products: [...productBySku.entries()]
      .map(([sku, name]) => ({ sku, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    // Solo agentes que TIENEN órdenes: un selector con marcas que siempre dan 0 es ruido.
    agents: (() => {
      const withOrders = new Set(
        orders.map((o) => agentByConvo.get(o.conversation_id)).filter(Boolean) as string[],
      );
      return agents
        .filter((a) => withOrders.has(a.id))
        .map((a) => ({ id: a.id, name: a.name, brand: a.brand, currency: a.currency }))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
    })(),
    // `method → etiqueta` de TODOS los agentes: la lista mezcla marcas. Ver ADR-0080.
    methodLabels: buildMethodLabels(agents),
  };
}

export interface OrderItemDetail {
  id: string;
  sku: string;
  name: string | null;
  qty: number;
  unitPrice: number | null;
}

export interface OrderDetail {
  id: string;
  conversationId: string;
  status: OrderStatus;
  method: FulfillmentMethod;
  shippingName: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingPhone: string | null;
  notes: string | null;
  total: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
  /** `created_at` de la conversación = cuándo llegó el cliente (analítica de horarios). */
  clientArrivedAt: string | null;
  /** Producto/fuente de la conversación de origen: de qué pauta llegó. Ver ADR-0076. */
  productCategory: string | null;
  contact: { name: string | null; phone: string } | null;
  items: OrderItemDetail[];
  /** Agente que vendió (vía la conversación): manda los métodos de pago. Ver ADR-0080. */
  agentId: string | null;
  /** Métodos de pago configurados en ese agente (vacío si la orden no tiene agente). */
  paymentMethods: PaymentMethodConfig[];
}

export async function getOrder(id: string): Promise<OrderDetail | null> {
  const supabase = createServiceClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, conversation_id, contact_id, status, fulfillment_method, shipping_name, shipping_address, shipping_city, shipping_phone, notes, total, currency, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getOrder: ${error.message}`);
  if (!order) return null;

  const [contactRes, itemsRes, convoRes, categoryByConvo] = await Promise.all([
    supabase.from("contacts").select("name, phone").eq("id", order.contact_id).maybeSingle(),
    supabase
      .from("order_items")
      .select("id, sku, name, qty, unit_price, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
    // Hora de llegada del cliente = created_at de la conversación de origen; y su
    // `agent_id`, que es quien define los métodos de pago del selector (ADR-0080).
    supabase
      .from("conversations")
      .select("created_at, agent_id")
      .eq("id", order.conversation_id)
      .maybeSingle(),
    // Producto/fuente de la conversación, resiliente a que falte la migración 0018.
    categoriesByConversation(supabase, [order.conversation_id]),
  ]);
  if (itemsRes.error) throw new Error(`getOrder items: ${itemsRes.error.message}`);

  // Métodos de pago del agente que vendió. Consulta aparte y best-effort: si falta
  // la migración 0025 (columna `payment_methods`) el detalle de la orden igual abre.
  const agentId = (convoRes.data as { agent_id?: string | null } | null)?.agent_id ?? null;
  let paymentMethods: PaymentMethodConfig[] = [];
  if (agentId) {
    try {
      const { data: agent } = await supabase
        .from("agents")
        .select("payment_methods")
        .eq("id", agentId)
        .maybeSingle();
      paymentMethods = parsePaymentMethods(
        (agent as { payment_methods?: unknown } | null)?.payment_methods,
      );
    } catch {
      paymentMethods = [];
    }
  }

  return {
    agentId,
    paymentMethods,
    id: order.id,
    conversationId: order.conversation_id,
    status: order.status,
    method: order.fulfillment_method,
    shippingName: order.shipping_name,
    shippingAddress: order.shipping_address,
    shippingCity: order.shipping_city,
    shippingPhone: order.shipping_phone,
    notes: order.notes,
    total: order.total,
    currency: order.currency,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    clientArrivedAt: convoRes.data?.created_at ?? null,
    productCategory: categoryByConvo.get(order.conversation_id) ?? null,
    contact: contactRes.data
      ? { name: contactRes.data.name, phone: contactRes.data.phone }
      : null,
    items: (itemsRes.data ?? []).map((it) => ({
      id: it.id,
      sku: it.sku,
      name: it.name,
      qty: it.qty,
      unitPrice: it.unit_price,
    })),
  };
}

// --- Solicitudes de llamada (#llamada, ver ADR-0034) ------------------------

export interface CallRequestRow {
  id: string;
  conversationId: string;
  contactName: string | null;
  phone: string;
  note: string | null;
  status: CallRequestStatus;
  createdAt: string;
}

/** Solicitudes de llamada (opcionalmente filtradas por estado), recientes primero. */
export async function getCallRequests(opts?: {
  status?: CallRequestStatus;
  limit?: number;
}): Promise<CallRequestRow[]> {
  const supabase = createServiceClient();
  let q = supabase
    .from("call_requests")
    .select("id, conversation_id, contact_id, phone, note, status, created_at")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.status) q = q.eq("status", opts.status);

  const { data, error } = await q;
  if (error) throw new Error(`getCallRequests: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const contactsRes = await supabase.from("contacts").select("id, name, phone").in("id", contactIds);
  if (contactsRes.error) throw new Error(`getCallRequests contacts: ${contactsRes.error.message}`);
  const contactById = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));

  return rows.map((r) => {
    const c = contactById.get(r.contact_id);
    return {
      id: r.id,
      conversationId: r.conversation_id,
      contactName: c?.name ?? null,
      phone: c?.phone ?? r.phone ?? "",
      note: r.note,
      status: r.status as CallRequestStatus,
      createdAt: r.created_at,
    };
  });
}

// --- Reportes de ventas -----------------------------------------------------

/**
 * Reporte de ventas agregado desde TODAS las órdenes (lógica pura en report.ts).
 * Con `agentId` se restringe a las órdenes de las conversaciones de ese agente.
 */
export async function getSalesReport(agentId?: string): Promise<SalesReport> {
  const supabase = createServiceClient();
  const [rows, convos, agents] = await Promise.all([
    // Paginado: sin esto, PostgREST corta en 1000 filas y el reporte subcuenta.
    fetchAllRows(
      (from, to) =>
        supabase
          .from("orders")
          .select("status, fulfillment_method, total, currency, created_at, conversation_id")
          .range(from, to),
      "getSalesReport",
    ),
    fetchAllRows(
      (from, to) => supabase.from("conversations").select("id, agent_id").range(from, to),
      "getSalesReport conversations",
    ),
    getAgents(),
  ]);

  const agentById = new Map(agents.map((a) => [a.id, a]));
  const agentByConvo = new Map(convos.map((c) => [c.id, c.agent_id as string | null]));
  // Moneda de LECTURA: la del agente filtrado; consolidando todos los mercados,
  // el peso colombiano (mercado original). Mismo criterio que Órdenes (ADR-0068).
  const display: CurrencyCode = agentId
    ? (agentById.get(agentId)?.currency ?? DEFAULT_CURRENCY)
    : DEFAULT_CURRENCY;

  const facts: OrderFact[] = rows
    .filter((o) => !agentId || agentByConvo.get(o.conversation_id) === agentId)
    .map((o) => {
      // La moneda nativa manda la del AGENTE, no `orders.currency`: esa columna
      // quedó envenenada con 'COP' en órdenes viejas de otros mercados (ADR-0068).
      const aId = agentByConvo.get(o.conversation_id);
      const native = aId
        ? (agentById.get(aId)?.currency ?? normalizeCurrency(o.currency))
        : normalizeCurrency(o.currency);
      return {
        status: o.status,
        method: o.fulfillment_method,
        total: o.total,
        currency: native,
        createdAt: o.created_at,
      };
    });
  // Los métodos configurados en el agente (o en todos, consolidando) siempre salen
  // en el corte "por método", aunque no tengan órdenes todavía. Ver ADR-0080.
  const configuredMethods = agents
    .filter((a) => !agentId || a.id === agentId)
    .flatMap((a) => a.paymentMethods.map((m) => m.method));
  return summarizeOrders(facts, Date.now(), display, configuredMethods);
}

/**
 * Embudo de conversión. Dos medidas por periodo (hoy/7/30 días) y por día:
 *  - **Conversaciones** = conversaciones DISTINTAS con un mensaje del cliente
 *    (inbound) en el periodo. Antes se contaba por `created_at` de la conversación,
 *    pero como la ingesta reutiliza una sola conversación por contacto entre días,
 *    "Hoy" mostraba solo los leads nuevos (6) y no las atendidas (26).
 *  - **Transacciones** = órdenes NO canceladas por su `created_at` — la MISMA base
 *    que "Órdenes generadas" (`getSalesReport`), para que ambos cuadros coincidan.
 *    Antes se contaban por la actividad de la conversación (una compra vieja
 *    aparecía "hoy" si el cliente volvía a escribir).
 * `total` es histórico. Lógica pura en report.ts. Ver ADR-0037. Paginado.
 */
export async function getConversionReport(agentId?: string): Promise<ConversionReport> {
  const supabase = createServiceClient();
  // Las ventanas/gráfico solo miran los últimos 30 días.
  const sinceIso = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const convoIds = agentId ? await getAgentConversationIds(agentId) : null;

  const [convCountRes, orders, inbound] = await Promise.all([
    // `total` histórico de conversaciones: count exacto (sin traer filas). Con
    // agente, solo las suyas — así el denominador cuadra con el numerador filtrado.
    (agentId
      ? supabase.from("conversations").select("*", { count: "exact", head: true }).eq("agent_id", agentId)
      : supabase.from("conversations").select("*", { count: "exact", head: true })),
    // Órdenes (todas) para las transacciones — se filtran canceladas acá. Paginado.
    fetchAllRows(
      (from, to) => supabase.from("orders").select("status, created_at, conversation_id").range(from, to),
      "getConversionReport orders",
    ),
    // Actividad: inbound de los últimos 30 días. Paginado.
    fetchAllRows(
      (from, to) =>
        supabase
          .from("messages")
          .select("conversation_id, created_at")
          .eq("direction", "inbound")
          .gte("created_at", sinceIso)
          .range(from, to),
      "getConversionReport inbound",
    ),
  ]);
  if (convCountRes.error)
    throw new Error(`getConversionReport conversations: ${convCountRes.error.message}`);

  const activity: ConversationActivityFact[] = inbound
    .filter((m) => !convoIds || convoIds.has(m.conversation_id))
    .map((m) => ({
      conversationId: m.conversation_id,
      createdAt: m.created_at,
    }));

  // Transacciones = órdenes NO canceladas (misma base que "Órdenes generadas").
  const transactions: TransactionFact[] = orders
    .filter((o) => o.status !== "cancelled" && (!convoIds || convoIds.has(o.conversation_id)))
    .map((o) => ({ createdAt: o.created_at }));

  return summarizeConversationActivity(activity, transactions, {
    conversations: convCountRes.count ?? 0,
    transactions: transactions.length,
  });
}

/**
 * Retorno (ROAS): cuánto costó traer los chats vs. cuánto vendieron. Ver ADR-0065.
 *
 * Un **chat** es una conversación que recibió al menos un mensaje del cliente, y se
 * detecta con `last_inbound_at` (columna de `conversations`) en vez de barrer
 * `messages`: es un solo scan y da lo mismo. El costo se imputa el día en que LLEGÓ
 * la conversación (`created_at`), que es cuando se pagó por ese lead.
 *
 * Resiliente a que falte la migración 0028: sin las columnas de costo, todos los
 * agentes quedan "sin configurar" (chats y ventas sí se ven) en vez de romper la
 * página de Reportes.
 *
 * Trae también el gasto de IA POR AGENTE (tokens + audios de `events_log`, vía
 * su conversación; llamadas de `voice_calls`, que ya llevan `agent_id`) para las
 * columnas Costo IA/chat y ROAIS, y deriva el reporte de escala (ADR-0070) de
 * los MISMOS hechos, para que todo cuadre entre secciones.
 */
/** Fila de `ad_spend` tal como la trae la query del reporte (ver migración 0031). */
interface AdSpendRow {
  agent_id: string | null;
  date: string;
  spend: number | string | null;
  currency: string;
  leads: number | null;
}

export interface RoasScalingReport extends RoasReport {
  scaling: ScalingReport;
  weekly: WeeklyReport;
}

export async function getRoasReport(agentId?: string): Promise<RoasScalingReport> {
  const supabase = createServiceClient();

  const [agentRows, convos, orders, tokenRows, audioRows, voiceRows, spendRows] = await Promise.all([
    supabase.from("agents").select("*").order("created_at", { ascending: true }),
    fetchAllRows(
      (from, to) =>
        supabase
          .from("conversations")
          .select("id, agent_id, created_at, last_inbound_at")
          .range(from, to),
      "getRoasReport conversations",
    ),
    fetchAllRows(
      (from, to) =>
        supabase.from("orders").select("conversation_id, status, total, created_at").range(from, to),
      "getRoasReport orders",
    ),
    fetchAllRows(
      (from, to) =>
        supabase
          .from("events_log")
          .select("payload, conversation_id")
          .in("type", TOKEN_EVENT_TYPES as unknown as string[])
          .range(from, to),
      "getRoasReport tokens",
    ),
    fetchAllRows(
      (from, to) =>
        supabase
          .from("events_log")
          .select("payload, conversation_id")
          .eq("type", "audio_transcribed")
          .range(from, to),
      "getRoasReport audio",
    ),
    // Llamadas con IA: tabla de la migración 0027; si no existe aún, cuentan 0.
    (async () => {
      const { data, error } = await supabase.from("voice_calls").select("agent_id, cost_usd");
      return error ? [] : (data ?? []);
    })(),
    // Gasto REAL en pauta (migración 0031, ADR-0082). Si la tabla no existe todavía
    // el reporte sigue funcionando con el estimado de siempre: la lectura no puede
    // depender de que ya hayan corrido la migración.
    (async () => {
      const { data, error } = await supabase
        .from("ad_spend")
        .select("agent_id, date, spend, currency, leads");
      return error ? [] : (data ?? []);
    })(),
  ]);
  if (agentRows.error) throw new Error(`getRoasReport agents: ${agentRows.error.message}`);

  const agents: AgentCostConfig[] = (agentRows.data ?? [])
    .filter((a) => !agentId || a.id === agentId)
    .map((a) => {
      // 0 / vacío / columna ausente cuentan como "sin configurar": un costo de 0
      // daría un retorno infinito, que no dice nada.
      const cost = readCostConfig(a);
      return {
        id: a.id,
        name: a.name,
        brand: a.brand,
        costPerChat: cost.costPerChat,
        // DOS monedas, a propósito: la pauta se paga en una y el producto se vende
        // en otra. Antes acá iba `cost_currency` sola y las ventas de la fila
        // quedaban etiquetadas con la moneda de la PAUTA — el ROAS dividía pesos
        // mexicanos entre pesos colombianos. Ver ADR-0079.
        costCurrency: cost.costCurrency,
        saleCurrency: normalizeCurrency((a as { currency?: string | null }).currency),
      };
    });

  // Órdenes → agente vía su conversación (las órdenes no llevan `agent_id`).
  const agentByConvo = new Map(convos.map((c) => [c.id, c.agent_id as string | null]));

  const chats: ChatFact[] = convos.map((c) => ({
    agentId: c.agent_id as string | null,
    createdAt: c.created_at,
    isChat: Boolean(c.last_inbound_at),
  }));
  const orderFacts: RoasOrderFact[] = orders.map((o) => ({
    agentId: agentByConvo.get(o.conversation_id) ?? null,
    status: o.status,
    total: o.total,
    createdAt: o.created_at,
  }));

  // Gasto IA por agente, en USD. Tokens y audios cuelgan de su conversación (los
  // eventos sin conversación no se pueden atribuir y quedan fuera, igual que en
  // getAiCostReport); las llamadas llevan `agent_id` directo. `tokenCostUsd` es
  // lineal, así que sumar el costo evento por evento da lo mismo que agregarlo.
  const aiCostUsdByAgent = new Map<string, number>();
  const addCost = (aId: string | null | undefined, usd: number) => {
    if (!aId) return;
    aiCostUsdByAgent.set(aId, (aiCostUsdByAgent.get(aId) ?? 0) + usd);
  };
  for (const row of tokenRows) {
    const u = readUsage(row.payload);
    addCost(agentByConvo.get(row.conversation_id ?? ""), tokenCostUsd(u.inputTokens, u.outputTokens));
  }
  for (const row of audioRows) {
    addCost(agentByConvo.get(row.conversation_id ?? ""), readAudio(row.payload).costUsd);
  }
  for (const raw of voiceRows) {
    const r = raw as { agent_id: string | null; cost_usd: number | null };
    addCost(r.agent_id, Number(r.cost_usd ?? 0));
  }

  // Moneda de lectura del consolidado: la del agente filtrado, o COP al mirar
  // todos los mercados juntos (mismo criterio que el resto de Reportes).
  const display: CurrencyCode = agentId
    ? normalizeCurrency(
        // `currency` llega con la migración 0029; sin ella cae al default.
        ((agentRows.data ?? []).find((a) => a.id === agentId) as { currency?: string | null })
          ?.currency,
      )
    : DEFAULT_CURRENCY;

  // Gasto real, ya como hechos del reporte. El filtro por agente se aplica acá
  // (no en la query) porque la lista de agentes del alcance ya está resuelta arriba.
  const inScope = new Set(agents.map((a) => a.id));
  const adSpend: AdSpendFact[] = (spendRows as AdSpendRow[])
    .filter((s) => s.agent_id && inScope.has(s.agent_id))
    .map((s) => ({
      agentId: s.agent_id as string,
      date: s.date,
      spend: Number(s.spend) || 0,
      currency: s.currency,
      leads: Number(s.leads) || 0,
    }));

  const report = summarizeRoas(agents, chats, orderFacts, aiCostUsdByAgent, display, adSpend);
  return {
    ...report,
    scaling: summarizeScaling(report, chats, orderFacts),
    // La foto semanal sale de los MISMOS hechos que el ROAS (sin queries extra):
    // así los chats y las ventas de la semana cuadran con el resto de la página.
    weekly: summarizeWeekly(agents, chats, orderFacts, display),
  };
}

export interface ProductConversionReport {
  rows: ProductConversionRow[];
  /** Moneda en la que están homologadas las ventas de las filas. */
  currency: CurrencyCode;
  /** true si hubo que convertir montos de otra moneda (los totales son equivalencias). */
  converted: boolean;
}

/**
 * Conversión por PRODUCTO: agrupa las conversaciones por `product_category` y
 * cuenta cuántas convirtieron (orden no cancelada), cuántas órdenes y cuánta
 * plata trajo cada categoría. Los montos se homologan a UNA moneda de lectura
 * (la del agente filtrado, o COP consolidado — mismo criterio que Órdenes,
 * ADR-0068). Resiliente: si falta la migración 0018 (columna), todo cae en
 * "Sin categoría". Lógica pura en report.ts. Ver docs/21. Paginado.
 */
export async function getProductConversion(agentId?: string): Promise<ProductConversionReport> {
  const supabase = createServiceClient();

  const [orders, agents] = await Promise.all([
    fetchAllRows(
      (from, to) =>
        supabase.from("orders").select("conversation_id, status, total, currency").range(from, to),
      "getProductConversion orders",
    ),
    getAgents(),
  ]);

  // Conversaciones con su categoría y agente. Si falta la columna de categoría
  // (0018), se cae al set con `agent_id` pero sin categoría (todo "Sin categoría")
  // en vez de romper; `agent_id` existe desde 0010 (columna base).
  let convos: Array<{ id: string; product_category: string | null; agent_id: string | null }>;
  try {
    convos = await fetchAllRows(
      (from, to) =>
        supabase.from("conversations").select("id, product_category, agent_id").range(from, to),
      "getProductConversion conversations",
    );
  } catch {
    const ids = await fetchAllRows(
      (from, to) => supabase.from("conversations").select("id, agent_id").range(from, to),
      "getProductConversion conv ids",
    );
    convos = ids.map((c) => ({ id: c.id, product_category: null, agent_id: c.agent_id }));
  }

  const agentById = new Map(agents.map((a) => [a.id, a]));
  const agentByConvo = new Map(convos.map((c) => [c.id, c.agent_id]));
  const display: CurrencyCode = agentId
    ? (agentById.get(agentId)?.currency ?? DEFAULT_CURRENCY)
    : DEFAULT_CURRENCY;

  // Órdenes no canceladas por conversación, con el monto ya homologado. La moneda
  // nativa es la del AGENTE (no `orders.currency`, envenenada con 'COP' — ADR-0068).
  let anyConverted = false;
  const statsByConvo = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const aId = agentByConvo.get(o.conversation_id);
    const native = aId
      ? (agentById.get(aId)?.currency ?? normalizeCurrency(o.currency))
      : normalizeCurrency(o.currency);
    const s = statsByConvo.get(o.conversation_id) ?? { orders: 0, revenue: 0 };
    s.orders += 1;
    const value = convertMoney(o.total, native, display);
    if (value != null) {
      s.revenue += value;
      if (native !== display) anyConverted = true;
    }
    statsByConvo.set(o.conversation_id, s);
  }

  const facts: ProductConversionFact[] = convos
    .filter((c) => !agentId || c.agent_id === agentId)
    .map((c) => {
      const s = statsByConvo.get(c.id);
      return {
        productCategory: c.product_category,
        converted: (s?.orders ?? 0) > 0,
        orders: s?.orders ?? 0,
        revenue: s?.revenue ?? null,
      };
    });
  return { rows: summarizeProductConversion(facts), currency: display, converted: anyConverted };
}

export interface TopProductsReport {
  rows: TopProductRow[];
  /** Moneda en la que están homologadas las ventas. */
  currency: CurrencyCode;
  /** true si hubo que convertir montos de otra moneda. */
  converted: boolean;
  /** Ítems sin precio unitario: cuentan unidades/órdenes pero no suman ventas. */
  unpriced: number;
}

/**
 * Productos MÁS VENDIDOS: ranking por SKU desde los ítems de las órdenes
 * (`order_items`) — lo que de verdad se vendió, no lo que se preguntó. Montos
 * homologados a una moneda de lectura (mismo criterio que Órdenes, ADR-0068).
 * Lógica pura en report.ts. Paginado.
 */
export async function getTopProducts(agentId?: string): Promise<TopProductsReport> {
  const supabase = createServiceClient();

  const [orders, items, convos, agents] = await Promise.all([
    fetchAllRows(
      (from, to) =>
        supabase.from("orders").select("id, conversation_id, status, currency").range(from, to),
      "getTopProducts orders",
    ),
    fetchAllRows(
      (from, to) =>
        supabase.from("order_items").select("order_id, sku, name, qty, unit_price").range(from, to),
      "getTopProducts items",
    ),
    fetchAllRows(
      (from, to) => supabase.from("conversations").select("id, agent_id").range(from, to),
      "getTopProducts conversations",
    ),
    getAgents(),
  ]);

  const agentById = new Map(agents.map((a) => [a.id, a]));
  const agentByConvo = new Map(convos.map((c) => [c.id, c.agent_id as string | null]));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const display: CurrencyCode = agentId
    ? (agentById.get(agentId)?.currency ?? DEFAULT_CURRENCY)
    : DEFAULT_CURRENCY;

  let converted = false;
  let unpriced = 0;
  const facts: ProductSalesFact[] = [];
  for (const it of items) {
    const o = orderById.get(it.order_id);
    if (!o) continue;
    const aId = agentByConvo.get(o.conversation_id) ?? null;
    if (agentId && aId !== agentId) continue;
    const native = aId
      ? (agentById.get(aId)?.currency ?? normalizeCurrency(o.currency))
      : normalizeCurrency(o.currency);
    const qty = Number(it.qty) || 0;
    const cancelled = o.status === "cancelled";
    let revenue: number | null = null;
    if (it.unit_price != null && Number.isFinite(Number(it.unit_price))) {
      revenue = convertMoney(qty * Number(it.unit_price), native, display);
      if (revenue != null && native !== display) converted = true;
    } else if (!cancelled) {
      unpriced += 1;
    }
    facts.push({ sku: it.sku, name: it.name, qty, revenue, orderId: it.order_id, cancelled });
  }
  return { rows: summarizeTopProducts(facts), currency: display, converted, unpriced };
}

/**
 * Velocidad de cierre: minutos entre el primer contacto (creación de la
 * conversación) y su PRIMERA orden no cancelada, + recompras. Lógica pura en
 * report.ts. Paginado.
 */
export async function getCloseSpeed(agentId?: string): Promise<CloseSpeedReport> {
  const supabase = createServiceClient();

  const [orders, convos] = await Promise.all([
    fetchAllRows(
      (from, to) =>
        supabase.from("orders").select("conversation_id, status, created_at").range(from, to),
      "getCloseSpeed orders",
    ),
    fetchAllRows(
      (from, to) =>
        supabase.from("conversations").select("id, agent_id, created_at").range(from, to),
      "getCloseSpeed conversations",
    ),
  ]);

  const convoById = new Map(convos.map((c) => [c.id, c]));
  const facts: CloseSpeedFact[] = [];
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const c = convoById.get(o.conversation_id);
    if (!c) continue;
    if (agentId && c.agent_id !== agentId) continue;
    facts.push({
      conversationId: o.conversation_id,
      conversationCreatedAt: c.created_at,
      orderCreatedAt: o.created_at,
    });
  }
  return summarizeCloseSpeed(facts);
}

// --- Videos por palabra clave (ver docs/20, ADR-0038) -----------------------

export interface VideoRow {
  id: string;
  /** Mercado/marca dueño del video. null = global (todas las marcas). */
  agentId: string | null;
  keyword: string;
  videoUrl: string;
  caption: string | null;
  enabled: boolean;
  createdAt: string;
}

/** Lista de videos configurados (palabra → video), recientes primero. */
export async function getVideos(): Promise<VideoRow[]> {
  const supabase = createServiceClient();

  const withCaption = await supabase
    .from("videos")
    .select("id, agent_id, keyword, video_url, caption, enabled, created_at")
    .order("created_at", { ascending: false });

  // Resiliencia a la ventana de migración:
  //  - 42P01 (tabla inexistente, falta 0016) → sección vacía.
  //  - 42703 (columna caption inexistente, falta 0017) → reintenta sin caption.
  // Ver ADR-0038. `agent_id` existe desde 0016 (misma migración de la tabla).
  if (withCaption.error && withCaption.error.code === "42P01") return [];
  if (withCaption.error && withCaption.error.code === "42703") {
    const noCaption = await supabase
      .from("videos")
      .select("id, agent_id, keyword, video_url, enabled, created_at")
      .order("created_at", { ascending: false });
    if (noCaption.error) {
      if (noCaption.error.code === "42P01") return [];
      throw new Error(`getVideos: ${noCaption.error.message}`);
    }
    return (noCaption.data ?? []).map((v) => ({
      id: v.id,
      agentId: v.agent_id,
      keyword: v.keyword,
      videoUrl: v.video_url,
      caption: null,
      enabled: v.enabled,
      createdAt: v.created_at,
    }));
  }
  if (withCaption.error) throw new Error(`getVideos: ${withCaption.error.message}`);

  return (withCaption.data ?? []).map((v) => ({
    id: v.id,
    agentId: v.agent_id,
    keyword: v.keyword,
    videoUrl: v.video_url,
    caption: v.caption,
    enabled: v.enabled,
    createdAt: v.created_at,
  }));
}

// --- Reactivaciones por plantilla (7/15 días, ver docs/14) -------------------

export interface AgentReactivationConfig {
  agentId: string;
  name: string;
  brand: string | null;
  enabled: boolean;
  template7d: string | null;
  template15d: string | null;
  /** URL del header de imagen de la plantilla día 7 (null = plantilla de solo texto). */
  image7d: string | null;
  /** URL del header de imagen de la plantilla día 15 (null = plantilla de solo texto). */
  image15d: string | null;
}

/**
 * Config de reactivación POR AGENTE (las plantillas viven en la cuenta de Callbell
 * de cada agente). Alimenta el selector de la página de Retargets. Ver ADR-0030/0044.
 * Resiliente: si faltan las columnas de imagen (42703, migración 0022 sin aplicar)
 * reintenta sin ellas (imágenes = null) para no romper la página.
 */
export async function getAgentsReactivationConfig(): Promise<AgentReactivationConfig[]> {
  const supabase = createServiceClient();
  const full = await supabase
    .from("agents")
    .select(
      "id, name, brand, reactivation_enabled, reactivation_template_7d, reactivation_template_15d, reactivation_image_7d, reactivation_image_15d, created_at",
    )
    .order("created_at", { ascending: true });

  if (full.error) {
    if (full.error.code === "42703") {
      const basic = await supabase
        .from("agents")
        .select("id, name, brand, reactivation_enabled, reactivation_template_7d, reactivation_template_15d, created_at")
        .order("created_at", { ascending: true });
      if (basic.error) throw new Error(`getAgentsReactivationConfig: ${basic.error.message}`);
      return (basic.data ?? []).map((a) => ({
        agentId: a.id,
        name: a.name,
        brand: a.brand,
        enabled: a.reactivation_enabled,
        template7d: a.reactivation_template_7d,
        template15d: a.reactivation_template_15d,
        image7d: null,
        image15d: null,
      }));
    }
    throw new Error(`getAgentsReactivationConfig: ${full.error.message}`);
  }

  return (full.data ?? []).map((a) => ({
    agentId: a.id,
    name: a.name,
    brand: a.brand,
    enabled: a.reactivation_enabled,
    template7d: a.reactivation_template_7d,
    template15d: a.reactivation_template_15d,
    image7d: a.reactivation_image_7d ?? null,
    image15d: a.reactivation_image_15d ?? null,
  }));
}

/** Una etapa de seguimiento para el editor (delay en HORAS + guía). */
export interface AgentRetargetStage {
  delayHours: number;
  guidance: string;
}

export interface AgentRetargetConfig {
  agentId: string;
  name: string;
  brand: string | null;
  /** Etapas configuradas (vacío = usar el backstop genérico 1h/8h/23h). */
  stages: AgentRetargetStage[];
}

/**
 * Config de retargets por agente (etapas: cuántas y a qué hora + guía) para el
 * editor del dashboard. Resiliente: si falta la columna (42703, migración 0024 sin
 * aplicar) devuelve los agentes con `stages: []` (usarán el backstop). Ver ADR-0052.
 */
export async function getAgentsRetargetConfig(): Promise<AgentRetargetConfig[]> {
  const supabase = createServiceClient();
  const full = await supabase
    .from("agents")
    .select("id, name, brand, retarget_config, created_at")
    .order("created_at", { ascending: true });

  if (full.error) {
    if (full.error.code === "42703") {
      const basic = await supabase
        .from("agents")
        .select("id, name, brand, created_at")
        .order("created_at", { ascending: true });
      if (basic.error) throw new Error(`getAgentsRetargetConfig: ${basic.error.message}`);
      return (basic.data ?? []).map((a) => ({
        agentId: a.id,
        name: a.name,
        brand: a.brand,
        stages: [],
      }));
    }
    throw new Error(`getAgentsRetargetConfig: ${full.error.message}`);
  }

  return (full.data ?? []).map((a) => ({
    agentId: a.id,
    name: a.name,
    brand: a.brand,
    stages: parseRetargetConfig((a as { retarget_config: unknown }).retarget_config).map((s) => ({
      delayHours: s.delayMinutes / 60,
      guidance: s.guidance ?? "",
    })),
  }));
}

export interface ReactivationStats {
  scheduled: number;
  processing: number;
  sent: number;
  skipped: number;
  cancelled: number;
  failed: number;
  /** Costo total de las plantillas enviadas (USD). */
  costUsd: number;
}

/** Conteo por estado + costo total de las reactivaciones (tally en JS). */
export async function getReactivationStats(): Promise<ReactivationStats> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("reactivations").select("status, cost_usd");
  if (error) throw new Error(`getReactivationStats: ${error.message}`);

  const counts: Record<RetargetStatus, number> = {
    scheduled: 0,
    processing: 0,
    sent: 0,
    skipped: 0,
    cancelled: 0,
    failed: 0,
  };
  let costUsd = 0;
  for (const row of data ?? []) {
    const s = row.status as RetargetStatus;
    if (s in counts) counts[s] += 1;
    if (row.cost_usd != null) costUsd += Number(row.cost_usd) || 0;
  }
  return { ...counts, costUsd };
}

export interface ReactivationRow {
  id: string;
  conversationId: string;
  contactName: string | null;
  phone: string;
  stage: number;
  status: RetargetStatus;
  scheduledAt: string;
  sentAt: string | null;
  costUsd: number | null;
  error: string | null;
}

/** Reactivaciones recientes (por `scheduled_at` desc). */
export async function getRecentReactivations(limit = 50): Promise<ReactivationRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("reactivations")
    .select("id, conversation_id, contact_id, phone, stage, status, scheduled_at, sent_at, cost_usd, error")
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentReactivations: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const contactsRes = await supabase.from("contacts").select("id, name, phone").in("id", contactIds);
  if (contactsRes.error) throw new Error(`getRecentReactivations contacts: ${contactsRes.error.message}`);
  const contactById = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));

  return rows.map((r) => {
    const c = contactById.get(r.contact_id);
    return {
      id: r.id,
      conversationId: r.conversation_id,
      contactName: c?.name ?? null,
      phone: c?.phone ?? r.phone ?? "",
      stage: r.stage,
      status: r.status as RetargetStatus,
      scheduledAt: r.scheduled_at,
      sentAt: r.sent_at,
      costUsd: r.cost_usd,
      error: r.error,
    };
  });
}

// --- Agentes (multi-marca, ver docs/16) -------------------------------------

export interface AgentRow {
  id: string;
  name: string;
  brand: string | null;
  country: string | null;
  whatsappNumber: string | null;
  /** Proveedor de WhatsApp del agente. Ver ADR-0056. */
  provider: MessagingProviderId;
  callbellChannelUuid: string | null;
  hasCallbellApiKey: boolean;
  kapsoPhoneNumberId: string | null;
  logisticsTeamUuid: string | null;
  vectorStoreId: string | null;
  model: string;
  enabled: boolean;
  /** Métodos de pago del agente (tags de compra por mercado). Ver ADR-0055. */
  paymentMethods: PaymentMethodConfig[];
  /** Moneda en la que VENDE (manda en Órdenes). Ver ADR-0068. */
  currency: CurrencyCode;
}

/**
 * Agentes (marcas/números) para la lista del dashboard. NUNCA devuelve la API key
 * (solo `hasCallbellApiKey`).
 *
 * Usa `select("*")` a propósito: las columnas nuevas van llegando por migraciones
 * (`payment_methods` en la 0025, `provider` en la 0026) y una lista explícita obliga
 * a encadenar un fallback por cada una para sobrevivir a la ventana entre el deploy
 * y la migración. Con `*` el problema desaparece: lo que aún no existe simplemente
 * llega `undefined` y los parsers lo resuelven. Son pocos agentes, así que el costo
 * de traer todas las columnas es irrelevante. Ver ADR-0056.
 */
export async function getAgents(): Promise<AgentRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getAgents: ${error.message}`);
  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    brand: a.brand,
    country: a.country,
    whatsappNumber: a.whatsapp_number,
    provider: normalizeProviderId((a as { provider?: unknown }).provider),
    callbellChannelUuid: a.callbell_channel_uuid,
    hasCallbellApiKey: !!a.callbell_api_key,
    kapsoPhoneNumberId: (a as { kapso_phone_number_id?: string | null }).kapso_phone_number_id ?? null,
    logisticsTeamUuid: a.logistics_team_uuid,
    vectorStoreId: a.vector_store_id,
    model: a.model,
    enabled: a.enabled,
    paymentMethods: parsePaymentMethods((a as { payment_methods?: unknown }).payment_methods),
    currency: normalizeCurrency((a as { currency?: string | null }).currency),
  }));
}

export interface AgentDetail {
  id: string;
  name: string;
  brand: string | null;
  country: string | null;
  whatsappNumber: string | null;
  /** Proveedor de WhatsApp del agente. Ver ADR-0056. */
  provider: MessagingProviderId;
  callbellChannelUuid: string | null;
  /** Últimos 4 de la API key (para mostrar sin exponer el secreto). */
  callbellApiKeyLast4: string | null;
  hasCallbellApiKey: boolean;
  kapsoPhoneNumberId: string | null;
  kapsoTemplateLanguage: string | null;
  /** Los secretos de Kapso NUNCA salen: solo si están puestos. */
  hasKapsoApiKey: boolean;
  hasKapsoWebhookSecret: boolean;
  logisticsTeamUuid: string | null;
  vectorStoreId: string | null;
  model: string;
  temperature: number;
  systemPrompt: string;
  enabled: boolean;
  scheduleEnabled: boolean;
  scheduleTimezone: string;
  schedule: AgentSchedule;
  /** Métodos de pago del agente (tags de compra por mercado). Ver ADR-0055. */
  paymentMethods: PaymentMethodConfig[];
  /** Costo de traer una conversación (pauta). null = sin configurar. Ver ADR-0065. */
  costPerChat: number | null;
  costCurrency: string;
  /** Moneda en la que VENDE (manda en Órdenes). Ver ADR-0068. */
  currency: CurrencyCode;
  createdAt: string;
  updatedAt: string;
}

/** Detalle de un agente para el editor. La API key va ENMASCARADA (solo last4). */
export async function getAgent(id: string): Promise<AgentDetail | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("agents").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getAgent: ${error.message}`);
  if (!data) return null;
  const key = data.callbell_api_key ?? "";
  const kapso = data as {
    provider?: unknown;
    kapso_api_key?: string | null;
    kapso_phone_number_id?: string | null;
    kapso_webhook_secret?: string | null;
    kapso_template_language?: string | null;
  };
  return {
    id: data.id,
    name: data.name,
    brand: data.brand,
    country: data.country,
    whatsappNumber: data.whatsapp_number,
    provider: normalizeProviderId(kapso.provider),
    callbellChannelUuid: data.callbell_channel_uuid,
    callbellApiKeyLast4: key ? key.slice(-4) : null,
    hasCallbellApiKey: key.length > 0,
    kapsoPhoneNumberId: kapso.kapso_phone_number_id ?? null,
    kapsoTemplateLanguage: kapso.kapso_template_language ?? null,
    hasKapsoApiKey: (kapso.kapso_api_key ?? "").length > 0,
    hasKapsoWebhookSecret: (kapso.kapso_webhook_secret ?? "").length > 0,
    logisticsTeamUuid: data.logistics_team_uuid,
    vectorStoreId: data.vector_store_id,
    model: data.model,
    temperature: Number(data.temperature),
    systemPrompt: data.system_prompt,
    enabled: data.enabled,
    scheduleEnabled: data.schedule_enabled,
    scheduleTimezone: data.schedule_timezone,
    schedule: parseAgentSchedule(data.schedule),
    paymentMethods: parsePaymentMethods((data as { payment_methods?: unknown }).payment_methods),
    ...readCostConfig(data),
    currency: normalizeCurrency((data as { currency?: string | null }).currency),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Costo por chat de una fila de `agents`. Tolera que falte la migración 0028
 * (columnas ausentes → sin configurar) y que el numeric llegue como string.
 */
function readCostConfig(row: unknown): { costPerChat: number | null; costCurrency: string } {
  const r = (row ?? {}) as { cost_per_chat?: unknown; cost_currency?: unknown };
  const value = Number(r.cost_per_chat);
  return {
    costPerChat: Number.isFinite(value) && value > 0 ? value : null,
    costCurrency:
      typeof r.cost_currency === "string" && r.cost_currency.trim()
        ? r.cost_currency.trim().toUpperCase()
        : "COP",
  };
}

// --- Inventario: productos por agente (ver docs/22, ADR-0042) ---------------

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  inStock: boolean;
}

/**
 * Productos (catálogo) de un agente, para el inventario del dashboard. Ordenados
 * por nombre. Volumen v1 bajo → una página (tope 1000 de PostgREST). Solo lectura;
 * la edición de la imagen NO toca el vector store. Ver ADR-0042.
 */
export async function getAgentProducts(agentId: string): Promise<ProductRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, sku, name, price, currency, image_url, in_stock")
    .eq("agent_id", agentId)
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`getAgentProducts: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    price: p.price,
    currency: p.currency,
    imageUrl: p.image_url,
    inStock: p.in_stock,
  }));
}

// --- Hotmart: plantillas + carritos (ver docs/17, ADR-0040) -----------------

export interface HotmartTemplateRow {
  id: string;
  agentId: string | null;
  eventType: string;
  productId: string | null;
  name: string;
  templateUuid: string | null;
  messageText: string | null;
  enabled: boolean;
  createdAt: string;
}

/**
 * Plantillas de Hotmart configuradas (para el manager del dashboard). Resiliente:
 * si falta la migración 0019 (tabla ausente, 42P01) devuelve vacío. Ver ADR-0040.
 */
export async function getHotmartTemplates(): Promise<HotmartTemplateRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("hotmart_templates")
    .select("id, agent_id, event_type, product_id, name, template_uuid, message_text, enabled, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`getHotmartTemplates: ${error.message}`);
  }
  return (data ?? []).map((t) => ({
    id: t.id,
    agentId: t.agent_id,
    eventType: t.event_type,
    productId: t.product_id,
    name: t.name,
    templateUuid: t.template_uuid,
    messageText: t.message_text,
    enabled: t.enabled,
    createdAt: t.created_at,
  }));
}

export interface HotmartEventRow {
  id: string;
  conversationId: string | null;
  phone: string;
  buyerName: string | null;
  productName: string | null;
  messageSent: boolean;
  sendError: string | null;
  createdAt: string;
}

/**
 * id del agente designado como "de Hotmart" (`hotmart_enabled`) o null si no hay
 * ninguno marcado (se usará el fallback env/primer-activo). Resiliente a que falte
 * la migración 0020. Alimenta el selector del dashboard. Ver ADR-0041.
 */
export async function getHotmartAgentId(): Promise<string | null> {
  const supabase = createServiceClient();
  return findHotmartAgentId(supabase);
}

/**
 * Últimos carritos abandonados recibidos (para ver el flujo funcionando en el
 * dashboard). Resiliente a que falte la tabla (42P01). Ver docs/17.
 */
export async function getRecentHotmartEvents(limit = 25): Promise<HotmartEventRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("hotmart_events")
    .select("id, conversation_id, phone, buyer_name, product_name, message_sent, send_error, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`getRecentHotmartEvents: ${error.message}`);
  }
  return (data ?? []).map((e) => ({
    id: e.id,
    conversationId: e.conversation_id,
    phone: e.phone,
    buyerName: e.buyer_name,
    productName: e.product_name,
    messageSent: e.message_sent,
    sendError: e.send_error,
    createdAt: e.created_at,
  }));
}

// --- Llamadas con IA (Synthflow) --------------------------------------------

export interface VoiceCallRow {
  id: string;
  conversationId: string;
  agentId: string | null;
  agentName: string | null;
  contactName: string | null;
  phone: string;
  stage: number;
  delayMinutes: number | null;
  trigger: string;
  status: string;
  scheduledAt: string;
  placedAt: string | null;
  durationSec: number | null;
  costUsd: number | null;
  endCallReason: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  extracted: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
}

export interface VoiceCallFilters {
  /** `scheduled` agrupa las que aún no han salido; `done`, las que ya ocurrieron. */
  bucket?: "scheduled" | "done" | "all";
  status?: VoiceCallStatus;
  agentId?: string;
  /** Búsqueda por teléfono del cliente (coincidencia parcial). */
  phone?: string;
  limit?: number;
}

const VOICE_CALL_COLS =
  "id, conversation_id, agent_id, phone, stage, delay_minutes, trigger, status, " +
  "scheduled_at, placed_at, duration_sec, cost_usd, end_call_reason, recording_url, " +
  "transcript, extracted, error, created_at";

const SCHEDULED_STATUSES: VoiceCallStatus[] = ["scheduled", "processing"];
const DONE_STATUSES: VoiceCallStatus[] = [
  "placed",
  "completed",
  "no_answer",
  "failed",
  "cancelled",
  "skipped",
];

/**
 * Lista de llamadas con IA para la sección Llamadas. Resiliente a que falte la
 * tabla (migración 0027 sin aplicar): devuelve [] en vez de romper la página.
 */
export async function getVoiceCalls(opts?: VoiceCallFilters): Promise<VoiceCallRow[]> {
  const supabase = createServiceClient();
  let q = supabase
    .from("voice_calls")
    .select(VOICE_CALL_COLS)
    .order("scheduled_at", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (opts?.status) q = q.eq("status", opts.status);
  else if (opts?.bucket === "scheduled") q = q.in("status", SCHEDULED_STATUSES);
  else if (opts?.bucket === "done") q = q.in("status", DONE_STATUSES);

  if (opts?.agentId) q = q.eq("agent_id", opts.agentId);
  if (opts?.phone) {
    const digits = opts.phone.replace(/\D/g, "");
    if (digits) q = q.like("phone", `%${digits}%`);
  }

  const { data, error } = await q;
  if (error) {
    // 42P01 = tabla inexistente (migración sin aplicar).
    if (error.code === "42P01") return [];
    throw new Error(`getVoiceCalls: ${error.message}`);
  }
  return hydrateVoiceCalls(supabase, (data ?? []) as unknown as VoiceCallDbRow[]);
}

interface VoiceCallDbRow {
  id: string;
  conversation_id: string;
  agent_id: string | null;
  phone: string;
  stage: number;
  delay_minutes: number | null;
  trigger: string;
  status: string;
  scheduled_at: string;
  placed_at: string | null;
  duration_sec: number | null;
  cost_usd: number | null;
  end_call_reason: string | null;
  recording_url: string | null;
  transcript: string | null;
  extracted: unknown;
  error: string | null;
  created_at: string;
}

/** Rellena nombre de contacto y de agente en dos consultas (patrón de getCallRequests). */
async function hydrateVoiceCalls(
  supabase: ReturnType<typeof createServiceClient>,
  rows: VoiceCallDbRow[],
): Promise<VoiceCallRow[]> {
  if (rows.length === 0) return [];

  const convoIds = [...new Set(rows.map((r) => r.conversation_id))];
  const convosRes = await supabase
    .from("conversations")
    .select("id, contact_id")
    .in("id", convoIds);
  const contactByConvo = new Map(
    (convosRes.data ?? []).map((c) => [c.id as string, c.contact_id as string]),
  );

  const contactIds = [...new Set([...contactByConvo.values()])];
  const contactsRes = contactIds.length
    ? await supabase.from("contacts").select("id, name").in("id", contactIds)
    : { data: [] };
  const nameByContact = new Map(
    (contactsRes.data ?? []).map((c) => [c.id as string, (c.name as string | null) ?? null]),
  );

  const agentIds = [...new Set(rows.map((r) => r.agent_id).filter(Boolean))] as string[];
  const agentsRes = agentIds.length
    ? await supabase.from("agents").select("id, name").in("id", agentIds)
    : { data: [] };
  const nameByAgent = new Map(
    (agentsRes.data ?? []).map((a) => [a.id as string, (a.name as string | null) ?? null]),
  );

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    agentId: r.agent_id,
    agentName: r.agent_id ? (nameByAgent.get(r.agent_id) ?? null) : null,
    contactName: nameByContact.get(contactByConvo.get(r.conversation_id) ?? "") ?? null,
    phone: r.phone,
    stage: r.stage,
    delayMinutes: r.delay_minutes,
    trigger: r.trigger,
    status: r.status,
    scheduledAt: r.scheduled_at,
    placedAt: r.placed_at,
    durationSec: r.duration_sec,
    costUsd: r.cost_usd,
    endCallReason: r.end_call_reason,
    recordingUrl: r.recording_url,
    transcript: r.transcript,
    extracted:
      r.extracted && typeof r.extracted === "object"
        ? (r.extracted as Record<string, unknown>)
        : null,
    error: r.error,
    createdAt: r.created_at,
  }));
}

/** Llamadas de UNA conversación, para la tarjeta del detalle. */
export async function getVoiceCallsForConversation(
  conversationId: string,
): Promise<VoiceCallRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("voice_calls")
    .select(VOICE_CALL_COLS)
    .eq("conversation_id", conversationId)
    .order("scheduled_at", { ascending: true });
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`getVoiceCallsForConversation: ${error.message}`);
  }
  return hydrateVoiceCalls(supabase, (data ?? []) as unknown as VoiceCallDbRow[]);
}

/** Conversaciones que tuvieron al menos una llamada con IA (para el filtro). */
export async function getConversationIdsWithVoiceCall(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("voice_calls")
    .select("conversation_id")
    .in("status", ["placed", "completed", "no_answer", "failed"] as VoiceCallStatus[]);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => r.conversation_id as string))];
}

export interface VoiceCallStats {
  total: number;
  scheduled: number;
  completed: number;
  noAnswer: number;
  failed: number;
  totalMinutes: number;
  totalCostUsd: number;
}

/** Resumen para la cabecera de la sección Llamadas y el reporte de costos. */
export async function getVoiceCallStats(agentId?: string): Promise<VoiceCallStats> {
  const empty: VoiceCallStats = {
    total: 0,
    scheduled: 0,
    completed: 0,
    noAnswer: 0,
    failed: 0,
    totalMinutes: 0,
    totalCostUsd: 0,
  };
  const supabase = createServiceClient();
  let q = supabase.from("voice_calls").select("status, duration_sec, cost_usd");
  if (agentId) q = q.eq("agent_id", agentId);

  const { data, error } = await q;
  if (error || !data) return empty;

  const stats = { ...empty };
  for (const raw of data) {
    const r = raw as { status: string; duration_sec: number | null; cost_usd: number | null };
    stats.total++;
    if (r.status === "scheduled" || r.status === "processing") stats.scheduled++;
    if (r.status === "completed") stats.completed++;
    if (r.status === "no_answer") stats.noAnswer++;
    if (r.status === "failed") stats.failed++;
    stats.totalMinutes += (r.duration_sec ?? 0) / 60;
    stats.totalCostUsd += Number(r.cost_usd ?? 0);
  }
  stats.totalMinutes = Number(stats.totalMinutes.toFixed(1));
  stats.totalCostUsd = Number(stats.totalCostUsd.toFixed(2));
  return stats;
}

/**
 * Config de voz de un agente para el editor del dashboard. Resiliente a que
 * falten las columnas (migración 0027 sin aplicar): devuelve los defaults, así
 * la página del agente sigue abriendo. Ver docs/25.
 */
export async function getAgentVoiceSettings(agentId: string): Promise<{
  voiceEnabled: boolean;
  modelId: string;
  fromNumber: string;
  voiceId: string;
  voiceName: string;
  prompt: string;
  greeting: string;
  apiKey: string;
  stages: Array<{ delayMinutes: number; guidance: string | null }>;
  countries: string[];
  extractors: Array<{
    identifier: string;
    type: string;
    condition: string;
    choices: string[];
    examples: string[];
    actionId?: string | null;
  }>;
  stopWhenAnswered: boolean;
  migrationMissing: boolean;
}> {
  const fallback = {
    voiceEnabled: false,
    modelId: "",
    fromNumber: "",
    voiceId: "",
    voiceName: "",
    prompt: "",
    greeting: "",
    apiKey: "",
    stages: [] as Array<{ delayMinutes: number; guidance: string | null }>,
    countries: [] as string[],
    extractors: [] as Array<{
      identifier: string;
      type: string;
      condition: string;
      choices: string[];
      examples: string[];
      actionId?: string | null;
    }>,
    stopWhenAnswered: true,
    migrationMissing: true,
  };

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .select(
      "voice_enabled, synthflow_model_id, synthflow_from_number, voice_id, voice_name, " +
        "voice_prompt, voice_greeting, voice_config, voice_countries, voice_extractors, " +
        "voice_stop_when_answered",
    )
    .eq("id", agentId)
    .maybeSingle();
  if (error || !data) return fallback;

  const row = data as unknown as Record<string, unknown>;
  return {
    voiceEnabled: row.voice_enabled === true,
    modelId: (row.synthflow_model_id as string | null) ?? "",
    fromNumber: (row.synthflow_from_number as string | null) ?? "",
    voiceId: (row.voice_id as string | null) ?? "",
    voiceName: (row.voice_name as string | null) ?? "",
    prompt: (row.voice_prompt as string | null) ?? "",
    greeting: (row.voice_greeting as string | null) ?? "",
    apiKey: "",
    stages: parseVoiceConfig(row.voice_config),
    countries: parseVoiceCountries(row.voice_countries),
    extractors: parseVoiceExtractors(row.voice_extractors),
    stopWhenAnswered: row.voice_stop_when_answered !== false,
    migrationMissing: false,
  };
}
