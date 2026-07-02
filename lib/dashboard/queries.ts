import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  ConversationStatus,
  FulfillmentMethod,
  MessageDirection,
  MessageType,
  OrderStatus,
  RetargetStatus,
} from "@/lib/supabase/types";

/**
 * Consultas de solo lectura del dashboard (Sprint 6).
 *
 * Corren en server components con el cliente service-role (bypassa RLS). El
 * service role NUNCA llega al browser. Volumen v1 bajo → sumas en JS; si crece,
 * mover a vistas/RPC en Postgres.
 */

// Placeholder de precios (USD por 1M tokens). Ajusta con el pricing real del
// modelo cuando lo confirmes — hoy es solo para empezar a medir.
const PRICE_INPUT_PER_1M = 2.5;
const PRICE_OUTPUT_PER_1M = 10;

export interface Kpis {
  totalSales: number;
  txCount: number;
  inputTokens: number;
  outputTokens: number;
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

export async function getKpis(): Promise<Kpis> {
  const supabase = createServiceClient();
  const [ordersRes, eventsRes] = await Promise.all([
    supabase.from("orders").select("total"),
    supabase.from("events_log").select("payload").eq("type", "reply_generated"),
  ]);
  if (ordersRes.error) throw new Error(`getKpis orders: ${ordersRes.error.message}`);
  if (eventsRes.error) throw new Error(`getKpis events: ${eventsRes.error.message}`);

  const orders = ordersRes.data ?? [];
  const totalSales = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of eventsRes.data ?? []) {
    const u = readUsage(row.payload);
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
  }
  const estCostUsd =
    (inputTokens / 1e6) * PRICE_INPUT_PER_1M + (outputTokens / 1e6) * PRICE_OUTPUT_PER_1M;

  return { totalSales, txCount: orders.length, inputTokens, outputTokens, estCostUsd };
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
}

export async function getRecentConversations(limit = 30): Promise<ConversationRow[]> {
  const supabase = createServiceClient();
  const { data: convos, error } = await supabase
    .from("conversations")
    .select("id, contact_id, status, fulfillment_method, ai_paused, last_inbound_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentConversations: ${error.message}`);

  const rows = convos ?? [];
  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const convoIds = rows.map((r) => r.id);

  const [contactsRes, msgsRes] = await Promise.all([
    supabase.from("contacts").select("id, name, phone").in("id", contactIds),
    supabase
      .from("messages")
      .select("conversation_id, content, type, created_at")
      .in("conversation_id", convoIds)
      .order("created_at", { ascending: false }),
  ]);
  if (contactsRes.error) throw new Error(`getRecentConversations contacts: ${contactsRes.error.message}`);
  if (msgsRes.error) throw new Error(`getRecentConversations messages: ${msgsRes.error.message}`);

  const contactById = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));
  const lastMsgByConvo = new Map<string, { content: string | null; type: MessageType }>();
  for (const m of msgsRes.data ?? []) {
    if (!lastMsgByConvo.has(m.conversation_id)) {
      lastMsgByConvo.set(m.conversation_id, { content: m.content, type: m.type as MessageType });
    }
  }

  return rows.map((r) => {
    const c = contactById.get(r.contact_id);
    const lm = lastMsgByConvo.get(r.id);
    return {
      id: r.id,
      contactName: c?.name ?? null,
      phone: c?.phone ?? "",
      status: r.status,
      method: r.fulfillment_method,
      aiPaused: r.ai_paused,
      lastActivity: r.last_inbound_at ?? r.updated_at,
      lastMessage: lm ? (lm.type === "text" ? lm.content : `[${lm.type}]`) : null,
    };
  });
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
    .select("id, contact_id, status, fulfillment_method, ai_paused, created_at")
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
