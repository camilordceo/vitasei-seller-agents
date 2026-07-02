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

// --- Conversión (conversaciones → transacciones) ----------------------------

export interface ConversationFact {
  /** ISO del `created_at` de la conversación. */
  createdAt: string;
  /** true si la conversación generó al menos una orden NO cancelada. */
  converted: boolean;
}

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

function rate(transactions: number, conversations: number): number {
  return conversations > 0 ? transactions / conversations : 0;
}

interface Tally {
  conversations: number;
  transactions: number;
}

function bumpTally(t: Tally, converted: boolean): void {
  t.conversations += 1;
  if (converted) t.transactions += 1;
}

function toWindow(t: Tally): ConversionWindow {
  return { conversations: t.conversations, transactions: t.transactions, rate: rate(t.transactions, t.conversations) };
}

/**
 * Embudo de conversión: por ventana de tiempo y por día, cuántas conversaciones
 * hubo y cuántas terminaron en transacción (orden no cancelada). `nowMs` inyectable.
 */
export function summarizeConversion(
  facts: ConversationFact[],
  nowMs: number = Date.now(),
): ConversionReport {
  const total: Tally = { conversations: 0, transactions: 0 };
  const today: Tally = { conversations: 0, transactions: 0 };
  const last7: Tally = { conversations: 0, transactions: 0 };
  const last30: Tally = { conversations: 0, transactions: 0 };

  const dayKeys: string[] = [];
  const dayIndex = new Map<string, Tally>();
  for (let i = 0; i < 14; i++) {
    const key = bogotaDayKey(nowMs - i * DAY_MS);
    dayKeys.push(key);
    dayIndex.set(key, { conversations: 0, transactions: 0 });
  }
  const todayKey = dayKeys[0];

  for (const f of facts) {
    bumpTally(total, f.converted);
    const createdMs = Date.parse(f.createdAt);
    if (!Number.isFinite(createdMs)) continue;
    if (bogotaDayKey(createdMs) === todayKey) bumpTally(today, f.converted);
    if (createdMs >= nowMs - 7 * DAY_MS) bumpTally(last7, f.converted);
    if (createdMs >= nowMs - 30 * DAY_MS) bumpTally(last30, f.converted);
    const day = dayIndex.get(bogotaDayKey(createdMs));
    if (day) bumpTally(day, f.converted);
  }

  return {
    total: toWindow(total),
    today: toWindow(today),
    last7: toWindow(last7),
    last30: toWindow(last30),
    perDay: dayKeys.map((k) => {
      const d = dayIndex.get(k)!;
      return { date: k, conversations: d.conversations, transactions: d.transactions, rate: rate(d.transactions, d.conversations) };
    }),
  };
}
