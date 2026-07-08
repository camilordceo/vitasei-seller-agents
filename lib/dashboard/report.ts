import type { FulfillmentMethod, OrderStatus } from "@/lib/supabase/types";

/**
 * Agregación PURA de órdenes para los reportes de ventas (Sprint 6 — órdenes).
 * Sin I/O: recibe hechos mínimos de cada orden y devuelve los cortes que muestra
 * el dashboard. Testeable con Vitest. Zona horaria fija America/Bogota (UTC-5, sin
 * DST) para los cortes por día.
 */

export const ORDER_STATUSES: OrderStatus[] = [
  "pending_handoff",
  "handed_off",
  "confirmed",
  "cancelled",
];

export const FULFILLMENT_METHODS: FulfillmentMethod[] = ["addi", "cod", "undecided"];

/** Estados que cuentan como "venta generada" (todo menos cancelada). */
export const GENERATED_STATUSES: OrderStatus[] = ["pending_handoff", "handed_off", "confirmed"];

/** Estados aún en curso (creadas por la IA, sin confirmar ni cancelar). */
export const PIPELINE_STATUSES: OrderStatus[] = ["pending_handoff", "handed_off"];

export interface OrderFact {
  status: OrderStatus;
  method: FulfillmentMethod;
  total: number | null;
  /** ISO del `created_at` de la orden. */
  createdAt: string;
}

export interface Bucket {
  count: number;
  revenue: number;
}

export interface DayBucket {
  /** Clave de día en Bogota, YYYY-MM-DD. */
  date: string;
  count: number;
  revenue: number;
}

export interface SalesReport {
  totalOrders: number;
  /** status === 'confirmed' — ventas confirmadas por el equipo. */
  confirmed: Bucket;
  /** pending_handoff + handed_off — en curso. */
  pipeline: Bucket;
  /** status === 'cancelled'. */
  cancelled: Bucket;
  /** Todo menos cancelada — lo que la IA "generó". */
  generated: Bucket;
  byStatus: Record<OrderStatus, Bucket>;
  byMethod: Record<FulfillmentMethod, Bucket>;
  /** Órdenes generadas hoy (día calendario en Bogota). */
  today: Bucket;
  /** Últimos 7 días (ventana móvil). */
  last7: Bucket;
  /** Últimos 30 días (ventana móvil). */
  last30: Bucket;
  /** Órdenes generadas por día, últimos 14 días (más reciente primero). */
  perDay: DayBucket[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const bogotaDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Clave de día (YYYY-MM-DD) en hora de Bogota para un instante dado. */
export function bogotaDayKey(ms: number): string {
  // en-CA con partes 2-digit produce "YYYY-MM-DD".
  return bogotaDateFmt.format(new Date(ms));
}

function emptyBucket(): Bucket {
  return { count: 0, revenue: 0 };
}

function add(bucket: Bucket, total: number | null): void {
  bucket.count += 1;
  bucket.revenue += Number.isFinite(total) ? (total as number) : 0;
}

/**
 * Construye el reporte de ventas a partir de los hechos de cada orden.
 * `nowMs` se inyecta (determinismo en tests); default = ahora.
 */
export function summarizeOrders(facts: OrderFact[], nowMs: number = Date.now()): SalesReport {
  const byStatus = Object.fromEntries(
    ORDER_STATUSES.map((s) => [s, emptyBucket()]),
  ) as Record<OrderStatus, Bucket>;
  const byMethod = Object.fromEntries(
    FULFILLMENT_METHODS.map((m) => [m, emptyBucket()]),
  ) as Record<FulfillmentMethod, Bucket>;

  const confirmed = emptyBucket();
  const pipeline = emptyBucket();
  const cancelled = emptyBucket();
  const generated = emptyBucket();
  const today = emptyBucket();
  const last7 = emptyBucket();
  const last30 = emptyBucket();

  // Claves de los últimos 14 días (índice para acumular perDay).
  const dayKeys: string[] = [];
  const dayIndex = new Map<string, DayBucket>();
  for (let i = 0; i < 14; i++) {
    const key = bogotaDayKey(nowMs - i * DAY_MS);
    dayKeys.push(key);
    dayIndex.set(key, { date: key, count: 0, revenue: 0 });
  }
  const todayKey = dayKeys[0];

  for (const f of facts) {
    if (byStatus[f.status]) add(byStatus[f.status], f.total);

    const isCancelled = f.status === "cancelled";
    if (isCancelled) {
      add(cancelled, f.total);
      continue; // las canceladas no cuentan como ventas ni entran a cortes/método
    }

    // No canceladas = generadas.
    add(generated, f.total);
    if (byMethod[f.method]) add(byMethod[f.method], f.total);
    if (f.status === "confirmed") add(confirmed, f.total);
    if (f.status === "pending_handoff" || f.status === "handed_off") add(pipeline, f.total);

    const createdMs = Date.parse(f.createdAt);
    if (Number.isFinite(createdMs)) {
      if (bogotaDayKey(createdMs) === todayKey) add(today, f.total);
      if (createdMs >= nowMs - 7 * DAY_MS) add(last7, f.total);
      if (createdMs >= nowMs - 30 * DAY_MS) add(last30, f.total);
      const dayBucket = dayIndex.get(bogotaDayKey(createdMs));
      if (dayBucket) {
        dayBucket.count += 1;
        dayBucket.revenue += Number.isFinite(f.total) ? (f.total as number) : 0;
      }
    }
  }

  return {
    totalOrders: facts.length,
    confirmed,
    pipeline,
    cancelled,
    generated,
    byStatus,
    byMethod,
    today,
    last7,
    last30,
    perDay: dayKeys.map((k) => dayIndex.get(k)!),
  };
}

// --- Conversión (conversaciones ACTIVAS → transacciones) --------------------
//
// DOS medidas independientes por ventana (hoy/7/30 días) y por día:
//
//  - "Conversaciones" = conversaciones DISTINTAS que tuvieron ACTIVIDAD del
//    cliente (al menos un mensaje inbound) en el periodo. NO las creadas ese día:
//    la ingesta reutiliza una conversación por (contacto, agente) entre días
//    (`processMessage.ts`), así que su `created_at` es el primer contacto de
//    siempre; contar por creación mostraba solo los leads nuevos (6, no 26).
//
//  - "Transacciones" = órdenes NO canceladas ubicadas por su FECHA DE CREACIÓN
//    (`orders.created_at`) — EXACTAMENTE la misma fuente que "Órdenes generadas
//    por día" (`summarizeOrders`). Antes se contaban por la actividad de la
//    conversación (una compra del 4 jul aparecía "hoy" si el cliente volvía a
//    escribir), lo que no cuadraba con el cuadro de órdenes. Ver ADR-0035.
//
// `total` es histórico: TODAS las conversaciones vs. TODAS las órdenes no
// canceladas. Se inyecta aparte para no traer todo el historial.

export interface ConversionWindow {
  conversations: number;
  transactions: number;
  /** transactions / conversations, en 0..1 (0 si no hay conversaciones). */
  rate: number;
}

export interface ConversionDay {
  date: string;
  conversations: number;
  transactions: number;
  rate: number;
}

export interface ConversionReport {
  total: ConversionWindow;
  today: ConversionWindow;
  last7: ConversionWindow;
  last30: ConversionWindow;
  /** Últimos 14 días (más reciente primero). */
  perDay: ConversionDay[];
}

/** Un mensaje inbound (actividad del cliente) atado a su conversación. */
export interface ConversationActivityFact {
  /** Conversación a la que pertenece el inbound (clave para contar distintas). */
  conversationId: string;
  /** ISO del `created_at` del mensaje inbound. */
  createdAt: string;
}

/** Una transacción = una orden NO cancelada, ubicada por su fecha de creación. */
export interface TransactionFact {
  /** ISO del `created_at` de la orden (misma base que "Órdenes generadas"). */
  createdAt: string;
}

function rate(transactions: number, conversations: number): number {
  return conversations > 0 ? transactions / conversations : 0;
}

function convWindow(conversations: number, transactions: number): ConversionWindow {
  return { conversations, transactions, rate: rate(transactions, conversations) };
}

/**
 * Embudo de conversión. Conversaciones = actividad inbound DISTINTA por periodo;
 * transacciones = órdenes no canceladas por su `created_at` (misma base que el
 * cuadro de órdenes). Una conversación activa varios días cuenta en cada día,
 * pero UNA sola vez por ventana (dedup por `conversationId`). `total` (histórico)
 * se pasa aparte. `nowMs` inyectable para tests.
 */
export function summarizeConversationActivity(
  activity: ConversationActivityFact[],
  transactions: TransactionFact[],
  total: { conversations: number; transactions: number },
  nowMs: number = Date.now(),
): ConversionReport {
  // Conversaciones distintas por ventana/día (actividad inbound).
  const todayC = new Set<string>();
  const last7C = new Set<string>();
  const last30C = new Set<string>();

  const dayKeys: string[] = [];
  const dayC = new Map<string, Set<string>>();
  const dayT = new Map<string, number>();
  for (let i = 0; i < 14; i++) {
    const key = bogotaDayKey(nowMs - i * DAY_MS);
    dayKeys.push(key);
    dayC.set(key, new Set());
    dayT.set(key, 0);
  }
  const todayKey = dayKeys[0];

  for (const a of activity) {
    const ms = Date.parse(a.createdAt);
    if (!Number.isFinite(ms)) continue;
    const id = a.conversationId;
    const key = bogotaDayKey(ms);
    if (key === todayKey) todayC.add(id);
    if (ms >= nowMs - 7 * DAY_MS) last7C.add(id);
    if (ms >= nowMs - 30 * DAY_MS) last30C.add(id);
    dayC.get(key)?.add(id);
  }

  // Transacciones = órdenes no canceladas, contadas por su fecha de creación.
  let todayT = 0;
  let last7T = 0;
  let last30T = 0;
  for (const t of transactions) {
    const ms = Date.parse(t.createdAt);
    if (!Number.isFinite(ms)) continue;
    const key = bogotaDayKey(ms);
    if (key === todayKey) todayT += 1;
    if (ms >= nowMs - 7 * DAY_MS) last7T += 1;
    if (ms >= nowMs - 30 * DAY_MS) last30T += 1;
    if (dayT.has(key)) dayT.set(key, (dayT.get(key) ?? 0) + 1);
  }

  return {
    total: convWindow(total.conversations, total.transactions),
    today: convWindow(todayC.size, todayT),
    last7: convWindow(last7C.size, last7T),
    last30: convWindow(last30C.size, last30T),
    perDay: dayKeys.map((k) => {
      const conversations = dayC.get(k)!.size;
      const transactions = dayT.get(k) ?? 0;
      return { date: k, conversations, transactions, rate: rate(transactions, conversations) };
    }),
  };
}
