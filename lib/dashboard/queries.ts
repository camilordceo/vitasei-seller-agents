import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import {
  EST_IMAGE_INPUT_TOKENS,
  GPT5_MINI_INPUT_PER_1M,
  tokenCostUsd,
} from "@/lib/openai/pricing";
import {
  summarizeConversationActivity,
  summarizeOrders,
  type ConversationActivityFact,
  type ConversionReport,
  type OrderFact,
  type SalesReport,
  type TransactionFact,
} from "@/lib/dashboard/report";
import type {
  CallRequestStatus,
  ConversationStatus,
  FulfillmentMethod,
  MessageDirection,
  MessageType,
  OrderStatus,
  RetargetStatus,
} from "@/lib/supabase/types";
import { parseAgentSchedule, type AgentSchedule } from "@/lib/agent/schedule";

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
 */
export async function getAiCostReport(): Promise<AiCostReport> {
  const supabase = createServiceClient();
  const [tokenRes, audioRes] = await Promise.all([
    supabase.from("events_log").select("payload").in("type", TOKEN_EVENT_TYPES as unknown as string[]),
    supabase.from("events_log").select("payload").eq("type", "audio_transcribed"),
  ]);
  if (tokenRes.error) throw new Error(`getAiCostReport tokens: ${tokenRes.error.message}`);
  if (audioRes.error) throw new Error(`getAiCostReport audio: ${audioRes.error.message}`);

  let inputTokens = 0;
  let outputTokens = 0;
  let imageCount = 0;
  for (const row of tokenRes.data ?? []) {
    const u = readUsage(row.payload);
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    imageCount += readImages(row.payload);
  }

  let audioCostUsd = 0;
  let audioSeconds = 0;
  let audioCount = 0;
  for (const row of audioRes.data ?? []) {
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
}

export interface ConversationFilters {
  limit?: number;
  /** Filtra por estado de la conversación. */
  status?: ConversationStatus;
  /** true = solo con pedido · false = solo sin pedido · undefined = todas. */
  hasOrder?: boolean;
  /** Ventana de actividad reciente en días (por `updated_at`). undefined = sin límite. */
  sinceDays?: number;
}

export async function getRecentConversations(
  opts: ConversationFilters = {},
): Promise<ConversationRow[]> {
  const limit = opts.limit ?? 100;
  const supabase = createServiceClient();

  let q = supabase
    .from("conversations")
    .select("id, contact_id, status, fulfillment_method, ai_paused, last_inbound_at, updated_at")
    .order("updated_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.sinceDays != null) {
    const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString();
    q = q.gte("updated_at", since);
  }
  // El filtro "con/sin pedido" se resuelve en JS (requiere cruzar con `orders`),
  // así que traemos un margen mayor para no quedarnos cortos tras filtrar.
  // Volumen v1 bajo → aceptable; si crece, mover a una vista/RPC en Postgres.
  q = q.limit(opts.hasOrder == null ? limit : Math.max(limit * 5, 200));

  const { data: convos, error } = await q;
  if (error) throw new Error(`getRecentConversations: ${error.message}`);

  const rows = convos ?? [];
  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const convoIds = rows.map((r) => r.id);

  const [contactsRes, msgsRes, ordersRes] = await Promise.all([
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
  ]);
  if (contactsRes.error) throw new Error(`getRecentConversations contacts: ${contactsRes.error.message}`);
  if (msgsRes.error) throw new Error(`getRecentConversations messages: ${msgsRes.error.message}`);
  if (ordersRes.error) throw new Error(`getRecentConversations orders: ${ordersRes.error.message}`);

  const contactById = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));
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

  let mapped: ConversationRow[] = rows.map((r) => {
    const c = contactById.get(r.contact_id);
    const lm = lastMsgByConvo.get(r.id);
    const orderStatus = orderByConvo.get(r.id) ?? null;
    return {
      id: r.id,
      contactName: c?.name ?? null,
      phone: c?.phone ?? "",
      status: r.status,
      method: r.fulfillment_method,
      aiPaused: r.ai_paused,
      lastActivity: r.last_inbound_at ?? r.updated_at,
      lastMessage: lm ? (lm.type === "text" ? lm.content : `[${lm.type}]`) : null,
      hasOrder: orderStatus != null,
      orderStatus,
    };
  });

  if (opts.hasOrder === true) mapped = mapped.filter((r) => r.hasOrder);
  else if (opts.hasOrder === false) mapped = mapped.filter((r) => !r.hasOrder);

  return mapped.slice(0, limit);
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
    .select("id, conversation_id, contact_id, phone, stage, status, scheduled_at, sent_at, error")
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
  shippingName: string | null;
  shippingCity: string | null;
  method: FulfillmentMethod;
}

export interface ConversationDetail {
  id: string;
  agentId: string | null;
  status: ConversationStatus;
  method: FulfillmentMethod;
  aiPaused: boolean;
  createdAt: string;
  contact: { name: string | null; phone: string } | null;
  messages: ConversationMessage[];
  order: ConversationOrder | null;
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

  const [contactRes, msgsRes, orderRes] = await Promise.all([
    supabase.from("contacts").select("name, phone").eq("id", convo.contact_id).maybeSingle(),
    supabase
      .from("messages")
      .select("id, direction, type, content, media_url, tags, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("orders")
      .select("id, status, total, fulfillment_method, shipping_name, shipping_city")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (msgsRes.error) throw new Error(`getConversation messages: ${msgsRes.error.message}`);

  let order: ConversationOrder | null = null;
  if (orderRes.data) {
    const { count } = await supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderRes.data.id);
    order = {
      id: orderRes.data.id,
      status: orderRes.data.status,
      total: orderRes.data.total,
      itemsCount: count ?? 0,
      shippingName: orderRes.data.shipping_name,
      shippingCity: orderRes.data.shipping_city,
      method: orderRes.data.fulfillment_method,
    };
  }

  return {
    id: convo.id,
    agentId: convo.agent_id,
    status: convo.status,
    method: convo.fulfillment_method,
    aiPaused: convo.ai_paused,
    createdAt: convo.created_at,
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
    order,
  };
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
  currency: string;
  itemsCount: number;
  shippingCity: string | null;
  createdAt: string;
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

  const [contactsRes, itemsRes] = await Promise.all([
    supabase.from("contacts").select("id, name, phone").in("id", contactIds),
    supabase.from("order_items").select("order_id").in("order_id", orderIds),
  ]);
  if (contactsRes.error) throw new Error(`getOrders contacts: ${contactsRes.error.message}`);
  if (itemsRes.error) throw new Error(`getOrders items: ${itemsRes.error.message}`);

  const contactById = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));
  const itemsByOrder = new Map<string, number>();
  for (const it of itemsRes.data ?? []) {
    itemsByOrder.set(it.order_id, (itemsByOrder.get(it.order_id) ?? 0) + 1);
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
      shippingCity: r.shipping_city,
      createdAt: r.created_at,
    };
  });
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
  contact: { name: string | null; phone: string } | null;
  items: OrderItemDetail[];
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

  const [contactRes, itemsRes] = await Promise.all([
    supabase.from("contacts").select("name, phone").eq("id", order.contact_id).maybeSingle(),
    supabase
      .from("order_items")
      .select("id, sku, name, qty, unit_price, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (itemsRes.error) throw new Error(`getOrder items: ${itemsRes.error.message}`);

  return {
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

/** Reporte de ventas agregado desde TODAS las órdenes (lógica pura en report.ts). */
export async function getSalesReport(): Promise<SalesReport> {
  const supabase = createServiceClient();
  // Paginado: sin esto, PostgREST corta en 1000 filas y el reporte subcuenta.
  const rows = await fetchAllRows(
    (from, to) =>
      supabase.from("orders").select("status, fulfillment_method, total, created_at").range(from, to),
    "getSalesReport",
  );

  const facts: OrderFact[] = rows.map((o) => ({
    status: o.status,
    method: o.fulfillment_method,
    total: o.total,
    createdAt: o.created_at,
  }));
  return summarizeOrders(facts);
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
export async function getConversionReport(): Promise<ConversionReport> {
  const supabase = createServiceClient();
  // Las ventanas/gráfico solo miran los últimos 30 días.
  const sinceIso = new Date(Date.now() - 30 * DAY_MS).toISOString();

  const [convCountRes, orders, inbound] = await Promise.all([
    // `total` histórico de conversaciones: count exacto (sin traer filas).
    supabase.from("conversations").select("*", { count: "exact", head: true }),
    // Órdenes (todas) para las transacciones — se filtran canceladas acá. Paginado.
    fetchAllRows(
      (from, to) => supabase.from("orders").select("status, created_at").range(from, to),
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

  const activity: ConversationActivityFact[] = inbound.map((m) => ({
    conversationId: m.conversation_id,
    createdAt: m.created_at,
  }));

  // Transacciones = órdenes NO canceladas (misma base que "Órdenes generadas").
  const transactions: TransactionFact[] = orders
    .filter((o) => o.status !== "cancelled")
    .map((o) => ({ createdAt: o.created_at }));

  return summarizeConversationActivity(activity, transactions, {
    conversations: convCountRes.count ?? 0,
    transactions: transactions.length,
  });
}

// --- Videos por palabra clave (ver docs/20, ADR-0038) -----------------------

export interface VideoRow {
  id: string;
  keyword: string;
  videoUrl: string;
  enabled: boolean;
  createdAt: string;
}

/** Lista de videos configurados (palabra → video), recientes primero. */
export async function getVideos(): Promise<VideoRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("videos")
    .select("id, keyword, video_url, enabled, created_at")
    .order("created_at", { ascending: false });
  // Resiliencia: si aún no se aplicó la migración 0016, la tabla no existe
  // (42P01) → la sección se muestra vacía en vez de romper. Ver ADR-0038.
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`getVideos: ${error.message}`);
  }
  return (data ?? []).map((v) => ({
    id: v.id,
    keyword: v.keyword,
    videoUrl: v.video_url,
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
}

/**
 * Config de reactivación POR AGENTE (las plantillas viven en la cuenta de Callbell
 * de cada agente). Alimenta el selector de la página de Retargets. Ver ADR-0030.
 */
export async function getAgentsReactivationConfig(): Promise<AgentReactivationConfig[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, brand, reactivation_enabled, reactivation_template_7d, reactivation_template_15d, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getAgentsReactivationConfig: ${error.message}`);
  return (data ?? []).map((a) => ({
    agentId: a.id,
    name: a.name,
    brand: a.brand,
    enabled: a.reactivation_enabled,
    template7d: a.reactivation_template_7d,
    template15d: a.reactivation_template_15d,
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
  callbellChannelUuid: string | null;
  hasCallbellApiKey: boolean;
  logisticsTeamUuid: string | null;
  vectorStoreId: string | null;
  model: string;
  enabled: boolean;
}

/** Agentes (marcas/números) para la lista del dashboard. NUNCA devuelve la API key. */
export async function getAgents(): Promise<AgentRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .select(
      "id, name, brand, country, whatsapp_number, callbell_channel_uuid, callbell_api_key, logistics_team_uuid, vector_store_id, model, enabled, created_at",
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getAgents: ${error.message}`);
  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    brand: a.brand,
    country: a.country,
    whatsappNumber: a.whatsapp_number,
    callbellChannelUuid: a.callbell_channel_uuid,
    hasCallbellApiKey: !!a.callbell_api_key,
    logisticsTeamUuid: a.logistics_team_uuid,
    vectorStoreId: a.vector_store_id,
    model: a.model,
    enabled: a.enabled,
  }));
}

export interface AgentDetail {
  id: string;
  name: string;
  brand: string | null;
  country: string | null;
  whatsappNumber: string | null;
  callbellChannelUuid: string | null;
  /** Últimos 4 de la API key (para mostrar sin exponer el secreto). */
  callbellApiKeyLast4: string | null;
  hasCallbellApiKey: boolean;
  logisticsTeamUuid: string | null;
  vectorStoreId: string | null;
  model: string;
  temperature: number;
  systemPrompt: string;
  enabled: boolean;
  scheduleEnabled: boolean;
  scheduleTimezone: string;
  schedule: AgentSchedule;
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
  return {
    id: data.id,
    name: data.name,
    brand: data.brand,
    country: data.country,
    whatsappNumber: data.whatsapp_number,
    callbellChannelUuid: data.callbell_channel_uuid,
    callbellApiKeyLast4: key ? key.slice(-4) : null,
    hasCallbellApiKey: key.length > 0,
    logisticsTeamUuid: data.logistics_team_uuid,
    vectorStoreId: data.vector_store_id,
    model: data.model,
    temperature: Number(data.temperature),
    systemPrompt: data.system_prompt,
    enabled: data.enabled,
    scheduleEnabled: data.schedule_enabled,
    scheduleTimezone: data.schedule_timezone,
    schedule: parseAgentSchedule(data.schedule),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
