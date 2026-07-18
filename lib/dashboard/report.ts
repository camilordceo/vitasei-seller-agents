import type { FulfillmentMethod, OrderStatus } from "@/lib/supabase/types";
import { convertMoney } from "./currency";

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

/**
 * Métodos conocidos que SIEMPRE aparecen en el corte "por método" (aunque tengan 0
 * órdenes), en este orden. El resto de métodos (texto libre por agente, ADR-0055)
 * se agregan según aparezcan en las órdenes, alfabéticos, con `undecided` al final.
 */
export const FULFILLMENT_METHODS: FulfillmentMethod[] = ["cod", "addi", "undecided"];

/** Clave de método normalizada (vacío → `undecided`). */
function methodKey(method: string | null | undefined): string {
  return method && method.trim() ? method : "undecided";
}

/**
 * Ordena las claves de método: primero las conocidas (`FULFILLMENT_METHODS`, sin
 * `undecided`), luego las demás alfabéticamente, y `undecided` siempre al final.
 */
export function orderMethodKeys(methods: Iterable<string>): string[] {
  const set = new Set<string>(methods);
  const known = FULFILLMENT_METHODS.filter((m) => m !== "undecided" && set.has(m));
  const extras = [...set]
    .filter((m) => !FULFILLMENT_METHODS.includes(m) && m !== "undecided")
    .sort((a, b) => a.localeCompare(b));
  const tail = set.has("undecided") ? ["undecided"] : [];
  return [...known, ...extras, ...tail];
}

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
  /** Cortes por método de pago (claves dinámicas: texto libre por agente). */
  byMethod: Record<string, Bucket>;
  /** Claves de `byMethod` en orden de despliegue (conocidas → extras → undecided). */
  methodKeys: string[];
  /** Órdenes generadas hoy (día calendario en Bogota). */
  today: Bucket;
  /** Últimos 7 días (ventana móvil). */
  last7: Bucket;
  /** Últimos 30 días (ventana móvil). */
  last30: Bucket;
  /** Órdenes generadas por día, últimos 14 días (más reciente primero). */
  perDay: DayBucket[];
  /** Órdenes generadas por día de la semana (índice 0=Dom … 6=Sáb), hora Bogota. */
  byWeekday: Bucket[];
  /** Órdenes generadas por hora del día (índice 0..23), hora Bogota. */
  byHour: Bucket[];
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

/** Un día calendario válido, `YYYY-MM-DD` (lo que produce un `<input type="date">`). */
export function isDayKey(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Descarta fechas imposibles (2026-02-31): el round-trip tiene que coincidir.
  return bogotaDayKey(Date.parse(`${value}T12:00:00-05:00`)) === value;
}

/**
 * Instante de INICIO de un día calendario de Bogota, en ISO/UTC. Colombia es
 * UTC-5 fijo, así que el offset se escribe literal (sin Intl ni DST).
 * Filtrar por rango se hace `>= dayStart(desde)` y `< dayStart(hasta + 1 día)`:
 * el extremo "hasta" queda INCLUSIVO sin pelear con la hora del timestamp.
 */
export function bogotaDayStartIso(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00-05:00`).toISOString();
}

/** Instante EXCLUSIVO de fin de un día de Bogota = inicio del día siguiente. */
export function bogotaDayEndIso(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00-05:00`) + DAY_MS).toISOString();
}

/**
 * Día de la semana (0=Dom … 6=Sáb) y hora (0..23) en hora Bogota. Colombia es
 * UTC-5 fijo (sin horario de verano), así que restar 5h y leer en UTC es exacto
 * y determinista (sirve en tests sin depender de Intl).
 */
export function bogotaWeekdayHour(ms: number): { weekday: number; hour: number } {
  const d = new Date(ms - 5 * 60 * 60 * 1000);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
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
  // Métodos a mostrar: los conocidos (siempre) + los presentes en las órdenes NO
  // canceladas (texto libre por agente). Ordenados para el despliegue.
  const presentMethods = new Set<string>(FULFILLMENT_METHODS);
  for (const f of facts) {
    if (f.status !== "cancelled") presentMethods.add(methodKey(f.method));
  }
  const methodKeys = orderMethodKeys(presentMethods);
  const byMethod = Object.fromEntries(
    methodKeys.map((m) => [m, emptyBucket()]),
  ) as Record<string, Bucket>;

  const confirmed = emptyBucket();
  const pipeline = emptyBucket();
  const cancelled = emptyBucket();
  const generated = emptyBucket();
  const today = emptyBucket();
  const last7 = emptyBucket();
  const last30 = emptyBucket();
  const byWeekday = Array.from({ length: 7 }, emptyBucket);
  const byHour = Array.from({ length: 24 }, emptyBucket);

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
    const mk = methodKey(f.method);
    if (byMethod[mk]) add(byMethod[mk], f.total);
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
      // Analítica de horarios (hora Colombia): ¿qué día de la semana y a qué hora
      // se generan las ventas? Solo cuenta generadas (no canceladas).
      const { weekday, hour } = bogotaWeekdayHour(createdMs);
      add(byWeekday[weekday], f.total);
      add(byHour[hour], f.total);
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
    methodKeys,
    today,
    last7,
    last30,
    perDay: dayKeys.map((k) => dayIndex.get(k)!),
    byWeekday,
    byHour,
  };
}

// --- Conversión por producto (fuente de la conversación) --------------------

export interface ProductConversionFact {
  /** Categoría/producto de la conversación (null = sin categorizar). */
  productCategory: string | null;
  /** true si la conversación tiene al menos una orden NO cancelada. */
  converted: boolean;
  /** Órdenes NO canceladas de la conversación. */
  orders: number;
  /** Ventas de la conversación YA homologadas a la moneda de lectura (null = nada sumable). */
  revenue: number | null;
}

export interface ProductConversionRow {
  /** null = "Sin categoría". */
  category: string | null;
  conversations: number;
  transactions: number;
  rate: number;
  /** Órdenes no canceladas atribuidas a la categoría. */
  orders: number;
  /** Ventas homologadas (misma moneda para todas las filas). */
  revenue: number;
  /** revenue / conversations: cuánta plata vale un chat de este producto. */
  revenuePerConversation: number;
}

/**
 * Agrupa las conversaciones por producto y calcula cuántas convirtieron, cuántas
 * órdenes y cuánta plata trajo cada categoría (los montos llegan YA homologados a
 * una sola moneda). Ordena por ventas desc, luego por conversaciones; "Sin
 * categoría" (null) va al final. Puro/testeable.
 */
export function summarizeProductConversion(facts: ProductConversionFact[]): ProductConversionRow[] {
  const byCat = new Map<
    string | null,
    { conversations: number; transactions: number; orders: number; revenue: number }
  >();
  for (const f of facts) {
    const key = f.productCategory && f.productCategory.trim() ? f.productCategory.trim() : null;
    const t = byCat.get(key) ?? { conversations: 0, transactions: 0, orders: 0, revenue: 0 };
    t.conversations += 1;
    if (f.converted) t.transactions += 1;
    t.orders += f.orders;
    t.revenue += f.revenue ?? 0;
    byCat.set(key, t);
  }
  return [...byCat.entries()]
    .map(([category, t]) => ({
      category,
      conversations: t.conversations,
      transactions: t.transactions,
      rate: t.conversations > 0 ? t.transactions / t.conversations : 0,
      orders: t.orders,
      revenue: t.revenue,
      revenuePerConversation: t.conversations > 0 ? t.revenue / t.conversations : 0,
    }))
    .sort((a, b) => {
      if (a.category === null) return 1; // "Sin categoría" al final
      if (b.category === null) return -1;
      return b.revenue - a.revenue || b.conversations - a.conversations;
    });
}

// --- Productos más vendidos (ítems de las órdenes) ---------------------------

export interface ProductSalesFact {
  sku: string;
  name: string | null;
  qty: number;
  /** qty × precio unitario, YA homologado a la moneda de lectura (null = ítem sin precio). */
  revenue: number | null;
  /** Orden a la que pertenece el ítem (para contar órdenes distintas). */
  orderId: string;
  /** true si la orden está cancelada: no suma ventas, pero sí a la tasa de cancelación. */
  cancelled: boolean;
}

export interface TopProductRow {
  sku: string;
  name: string;
  /** Unidades vendidas (órdenes no canceladas). */
  units: number;
  /** Órdenes distintas no canceladas en las que aparece. */
  orders: number;
  /** Ventas homologadas del producto (suma de sus ítems no cancelados). */
  revenue: number;
  /** revenue / orders: cuánto factura una orden típica de este producto. null sin órdenes. */
  perOrder: number | null;
  /** Órdenes distintas CANCELADAS en las que aparecía. */
  cancelledOrders: number;
  /** canceladas / (activas + canceladas): qué tanto se cae este producto. */
  cancelRate: number;
}

/**
 * Ranking de productos por lo que de verdad se vendió (ítems de las órdenes), no
 * por lo que se preguntó. Los montos llegan YA homologados a una moneda. Ordena
 * por ventas desc y luego unidades. Puro/testeable.
 */
export function summarizeTopProducts(facts: ProductSalesFact[]): TopProductRow[] {
  const bySku = new Map<
    string,
    {
      name: string;
      units: number;
      revenue: number;
      orders: Set<string>;
      cancelledOrders: Set<string>;
    }
  >();
  for (const f of facts) {
    const sku = f.sku.trim();
    if (!sku) continue;
    const t =
      bySku.get(sku) ??
      { name: "", units: 0, revenue: 0, orders: new Set<string>(), cancelledOrders: new Set<string>() };
    // El nombre más reciente que se haya visto gana (los ítems viejos pueden traer null).
    if (f.name && f.name.trim()) t.name = f.name.trim();
    if (f.cancelled) {
      t.cancelledOrders.add(f.orderId);
    } else {
      t.units += Number(f.qty) || 0;
      t.revenue += f.revenue ?? 0;
      t.orders.add(f.orderId);
    }
    bySku.set(sku, t);
  }
  return [...bySku.entries()]
    .map(([sku, t]) => {
      const orders = t.orders.size;
      const cancelledOrders = t.cancelledOrders.size;
      return {
        sku,
        name: t.name || sku,
        units: t.units,
        orders,
        revenue: t.revenue,
        perOrder: orders > 0 ? t.revenue / orders : null,
        cancelledOrders,
        cancelRate: orders + cancelledOrders > 0 ? cancelledOrders / (orders + cancelledOrders) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units);
}

// --- Velocidad de cierre (lead → primera orden) ------------------------------

/** Una orden NO cancelada atada a la conversación que la originó. */
export interface CloseSpeedFact {
  conversationId: string;
  /** ISO del `created_at` de la conversación = primer contacto del cliente. */
  conversationCreatedAt: string;
  /** ISO del `created_at` de la orden. */
  orderCreatedAt: string;
}

export interface CloseSpeedBucket {
  label: string;
  count: number;
}

export interface CloseSpeedReport {
  /** Conversaciones que cerraron al menos una orden (con delta medible). */
  closes: number;
  /** Mediana de minutos entre el primer contacto y la PRIMERA orden. null sin cierres. */
  medianMinutes: number | null;
  /** Fracción de cierres dentro de la primera hora. */
  withinHourRate: number;
  /** Fracción de cierres dentro de las primeras 24 h. */
  withinDayRate: number;
  /** Distribución fija: ≤15 min · 15–60 min · 1–6 h · 6–24 h · 1–3 días · >3 días. */
  buckets: CloseSpeedBucket[];
  /** Conversaciones con MÁS de una orden (clientes que recompraron). */
  repeatConversations: number;
  /** Órdenes adicionales más allá de la primera (volumen de recompra). */
  repeatOrders: number;
}

const CLOSE_SPEED_BUCKETS: Array<{ label: string; maxMin: number }> = [
  { label: "≤ 15 min", maxMin: 15 },
  { label: "15–60 min", maxMin: 60 },
  { label: "1–6 h", maxMin: 6 * 60 },
  { label: "6–24 h", maxMin: 24 * 60 },
  { label: "1–3 días", maxMin: 3 * 24 * 60 },
  { label: "> 3 días", maxMin: Infinity },
];

/**
 * ¿Qué tan rápido cierra la IA? Mide, por conversación, los minutos entre el
 * primer contacto (`created_at` de la conversación) y su PRIMERA orden no
 * cancelada. Solo la primera: las órdenes siguientes son recompras (se cuentan
 * aparte), y medirlas desde el primer contacto inflaría el tiempo. Mediana en vez
 * de promedio: un lead que volvió a los 20 días no debe tapar que el resto cierra
 * en minutos. Puro/testeable.
 */
export function summarizeCloseSpeed(facts: CloseSpeedFact[]): CloseSpeedReport {
  // Primera orden y # de órdenes por conversación.
  const byConvo = new Map<string, { firstOrderMs: number; orders: number; convoMs: number }>();
  for (const f of facts) {
    const orderMs = Date.parse(f.orderCreatedAt);
    const convoMs = Date.parse(f.conversationCreatedAt);
    if (!Number.isFinite(orderMs) || !Number.isFinite(convoMs)) continue;
    const t = byConvo.get(f.conversationId);
    if (!t) {
      byConvo.set(f.conversationId, { firstOrderMs: orderMs, orders: 1, convoMs });
    } else {
      t.orders += 1;
      if (orderMs < t.firstOrderMs) t.firstOrderMs = orderMs;
    }
  }

  const deltas: number[] = [];
  let repeatConversations = 0;
  let repeatOrders = 0;
  for (const t of byConvo.values()) {
    // Relojes/ingesta pueden dejar la orden "antes" de la conversación por segundos.
    deltas.push(Math.max(0, (t.firstOrderMs - t.convoMs) / 60000));
    if (t.orders > 1) {
      repeatConversations += 1;
      repeatOrders += t.orders - 1;
    }
  }
  deltas.sort((a, b) => a - b);

  const buckets = CLOSE_SPEED_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  let withinHour = 0;
  let withinDay = 0;
  for (const d of deltas) {
    const i = CLOSE_SPEED_BUCKETS.findIndex((b) => d <= b.maxMin);
    buckets[i === -1 ? buckets.length - 1 : i].count += 1;
    if (d <= 60) withinHour += 1;
    if (d <= 24 * 60) withinDay += 1;
  }

  const n = deltas.length;
  const medianMinutes =
    n === 0 ? null : n % 2 === 1 ? deltas[(n - 1) / 2] : (deltas[n / 2 - 1] + deltas[n / 2]) / 2;

  return {
    closes: n,
    medianMinutes,
    withinHourRate: n > 0 ? withinHour / n : 0,
    withinDayRate: n > 0 ? withinDay / n : 0,
    buckets,
    repeatConversations,
    repeatOrders,
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
//    escribir), lo que no cuadraba con el cuadro de órdenes. Ver ADR-0037.
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

// --- ROAS: retorno sobre el costo de adquirir cada chat (ver ADR-0065) -------

/**
 * Un chat = una conversación que recibió al menos un mensaje del cliente. Se le
 * imputa el costo el día en que LLEGÓ (`created_at` de la conversación), que es
 * cuando se pagó por el lead, no el día en que volvió a escribir.
 */
export interface ChatFact {
  agentId: string | null;
  /** ISO del `created_at` de la conversación. */
  createdAt: string;
  /** false = conversación sin ningún inbound (no se cobra: nunca fue un chat). */
  isChat: boolean;
}

/** Orden atribuida a un agente, para el retorno. */
export interface RoasOrderFact {
  agentId: string | null;
  status: OrderStatus;
  total: number | null;
  /** ISO del `created_at` de la orden. */
  createdAt: string;
}

/** Costo por chat configurado en un agente (null = sin configurar). */
export interface AgentCostConfig {
  id: string;
  name: string;
  brand: string | null;
  costPerChat: number | null;
  currency: string;
}

export interface RoasRow {
  agentId: string | null;
  name: string;
  brand: string | null;
  /** null = el agente no tiene costo por chat configurado. */
  costPerChat: number | null;
  currency: string;
  chats: number;
  /** chats × costo por chat. */
  investment: number;
  /** Órdenes no canceladas (misma base que "Órdenes generadas"). */
  orders: number;
  revenue: number;
  confirmedRevenue: number;
  /** revenue / inversión. null si no hay inversión (sin costo o sin chats). */
  roas: number | null;
  /** Igual pero solo con lo confirmado: la lectura conservadora. */
  confirmedRoas: number | null;
  /** Inversión / órdenes generadas = cuánto costó cada venta (CPA). */
  costPerOrder: number | null;
  /** revenue − inversión. */
  profit: number;
  /** Costo IA total del agente (tokens + audios + llamadas), YA en su moneda. */
  aiCost: number;
  /** aiCost / chats: cuánto cuesta la IA por conversación atendida. null sin chats. */
  aiCostPerChat: number | null;
  /** ROAIS (return on AI spend) = revenue / aiCost. null sin gasto IA. */
  roais: number | null;
}

export interface RoasDay {
  /** Clave de día en Bogota, YYYY-MM-DD. */
  date: string;
  chats: number;
  investment: number;
  revenue: number;
  roas: number | null;
}

export interface RoasReport {
  rows: RoasRow[];
  /**
   * Consolidado de todos los agentes del alcance. null si conviven varias monedas
   * (sumar pesos con dólares daría un número falso).
   */
  total: RoasRow | null;
  /** Últimos 14 días del alcance. Vacío si el alcance mezcla monedas. */
  perDay: RoasDay[];
  /** true si al menos un agente del alcance tiene costo por chat configurado. */
  configured: boolean;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Retorno por agente: cuánto costó traer los chats vs. cuánto vendieron.
 *
 * El costo por chat lo define cada agente en su moneda (ADR-0065), así que las
 * filas NUNCA se suman entre monedas distintas: el consolidado y el gráfico solo
 * salen cuando todo el alcance comparte moneda. Un agente sin costo configurado
 * aparece igual (con sus chats y ventas) pero con inversión 0 y ROAS null: se ve
 * que falta configurarlo en vez de mostrar un retorno inventado.
 *
 * `aiCostUsdByAgent` es el gasto de IA de cada agente EN USD (tokens + audios +
 * llamadas); acá se convierte a la moneda del agente para leer Costo IA/chat y
 * ROAIS al lado de la pauta, en las mismas unidades. Ver ADR-0070.
 */
export function summarizeRoas(
  agents: AgentCostConfig[],
  chats: ChatFact[],
  orders: RoasOrderFact[],
  aiCostUsdByAgent: Map<string, number> = new Map(),
): RoasReport {
  const byAgent = new Map<string, RoasRow>();
  for (const a of agents) {
    byAgent.set(a.id, {
      agentId: a.id,
      name: a.name,
      brand: a.brand,
      costPerChat: a.costPerChat,
      currency: a.currency,
      chats: 0,
      investment: 0,
      orders: 0,
      revenue: 0,
      confirmedRevenue: 0,
      roas: null,
      confirmedRoas: null,
      costPerOrder: null,
      profit: 0,
      aiCost: 0,
      aiCostPerChat: null,
      roais: null,
    });
  }

  for (const c of chats) {
    if (!c.isChat) continue;
    const row = c.agentId ? byAgent.get(c.agentId) : undefined;
    if (row) row.chats += 1;
  }
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const row = o.agentId ? byAgent.get(o.agentId) : undefined;
    if (!row) continue;
    row.orders += 1;
    row.revenue += Number(o.total) || 0;
    if (o.status === "confirmed") row.confirmedRevenue += Number(o.total) || 0;
  }

  const rows = [...byAgent.values()];
  for (const row of rows) {
    row.investment = (row.costPerChat ?? 0) * row.chats;
    row.roas = ratio(row.revenue, row.investment);
    row.confirmedRoas = ratio(row.confirmedRevenue, row.investment);
    row.costPerOrder = ratio(row.investment, row.orders);
    row.profit = row.revenue - row.investment;
    // Gasto IA del agente: llega en USD y se lee en la moneda de la fila. Si la
    // moneda del agente no tiene tasa, queda 0 (no se inventa una conversión).
    row.aiCost = convertMoney(aiCostUsdByAgent.get(row.agentId ?? "") ?? 0, "USD", row.currency) ?? 0;
    row.aiCostPerChat = ratio(row.aiCost, row.chats);
    row.roais = ratio(row.revenue, row.aiCost);
  }
  rows.sort((a, b) => b.revenue - a.revenue);

  // Una sola moneda en TODO el alcance → se puede consolidar y graficar.
  const currencies = new Set(rows.map((r) => r.currency));
  const singleCurrency = currencies.size === 1 ? [...currencies][0] : null;

  let total: RoasRow | null = null;
  if (singleCurrency) {
    const chatsTotal = rows.reduce((s, r) => s + r.chats, 0);
    const investment = rows.reduce((s, r) => s + r.investment, 0);
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const confirmedRevenue = rows.reduce((s, r) => s + r.confirmedRevenue, 0);
    const ordersTotal = rows.reduce((s, r) => s + r.orders, 0);
    const aiCostTotal = rows.reduce((s, r) => s + r.aiCost, 0);
    total = {
      agentId: null,
      name: "Todos los agentes",
      brand: null,
      // Costo por chat MEZCLADO del alcance (inversión / chats), no un promedio
      // simple: si un agente trae 10× más chats, pesa 10× más.
      costPerChat: ratio(investment, chatsTotal),
      currency: singleCurrency,
      chats: chatsTotal,
      investment,
      orders: ordersTotal,
      revenue,
      confirmedRevenue,
      roas: ratio(revenue, investment),
      confirmedRoas: ratio(confirmedRevenue, investment),
      costPerOrder: ratio(investment, ordersTotal),
      profit: revenue - investment,
      aiCost: aiCostTotal,
      aiCostPerChat: ratio(aiCostTotal, chatsTotal),
      roais: ratio(revenue, aiCostTotal),
    };
  }

  // Serie de 14 días, MÁS RECIENTE PRIMERO: el gráfico es una lista vertical de
  // filas (igual que "Órdenes generadas" y "Conversión") y todas ponen hoy arriba.
  const perDay: RoasDay[] = [];
  if (singleCurrency) {
    const costById = new Map(agents.map((a) => [a.id, a.costPerChat ?? 0]));
    const dayChats = new Map<string, number>();
    const dayInvestment = new Map<string, number>();
    const dayRevenue = new Map<string, number>();

    const dayKeys: string[] = [];
    const now = Date.now();
    for (let i = 0; i < 14; i++) dayKeys.push(bogotaDayKey(now - i * DAY_MS));
    const window = new Set(dayKeys);

    for (const c of chats) {
      if (!c.isChat || !c.agentId) continue;
      const key = bogotaDayKey(Date.parse(c.createdAt));
      if (!window.has(key)) continue;
      dayChats.set(key, (dayChats.get(key) ?? 0) + 1);
      dayInvestment.set(key, (dayInvestment.get(key) ?? 0) + (costById.get(c.agentId) ?? 0));
    }
    for (const o of orders) {
      if (o.status === "cancelled" || !o.agentId) continue;
      const key = bogotaDayKey(Date.parse(o.createdAt));
      if (!window.has(key)) continue;
      dayRevenue.set(key, (dayRevenue.get(key) ?? 0) + (Number(o.total) || 0));
    }

    for (const key of dayKeys) {
      const investment = dayInvestment.get(key) ?? 0;
      const revenue = dayRevenue.get(key) ?? 0;
      perDay.push({
        date: key,
        chats: dayChats.get(key) ?? 0,
        investment,
        revenue,
        roas: ratio(revenue, investment),
      });
    }
  }

  return {
    rows,
    total,
    perDay,
    configured: rows.some((r) => r.costPerChat != null && r.costPerChat > 0),
  };
}

// --- Escala: economía por chat, proyección del mes y crecimiento (ADR-0070) ---

export interface ScalingReport {
  /**
   * Economía unitaria del alcance: qué produce y qué cuesta UN chat. null si el
   * alcance mezcla monedas o no hay chats (no se inventa un promedio).
   */
  perChat: {
    currency: string;
    /** Pauta por chat (inversión / chats). */
    adCost: number;
    /** IA por chat (gasto IA / chats). */
    aiCost: number;
    /** Venta generada por chat (ventas / chats). */
    revenue: number;
    /** revenue − adCost − aiCost: lo que deja cada chat antes de producto/logística. */
    margin: number;
  } | null;
  /**
   * Proyección del mes calendario (Bogota) a ritmo actual: MTD ÷ días corridos ×
   * días del mes. null si el alcance mezcla monedas.
   */
  month: {
    daysElapsed: number;
    daysInMonth: number;
    revenueMtd: number;
    ordersMtd: number;
    projectedRevenue: number;
    projectedOrders: number;
    /** Mes calendario anterior completo, para comparar. */
    prevRevenue: number;
    prevOrders: number;
  } | null;
  /** Semana contra semana: últimos 7 días vs. los 7 anteriores. */
  wow: {
    chats7: number;
    chatsPrev7: number;
    /** (chats7 − chatsPrev7) / chatsPrev7. null si la semana anterior fue 0. */
    chatsGrowth: number | null;
    /** Montos solo con moneda única en el alcance. */
    revenue7: number | null;
    revenuePrev7: number | null;
    revenueGrowth: number | null;
  };
}

/**
 * Lecturas para ESCALAR: cuánto deja cada chat (pauta + IA vs. venta), a dónde va
 * el mes si sigue así (run-rate simple, sin estacionalidad — se enuncia como
 * "a este ritmo") y si la operación crece o se frena semana contra semana. Usa los
 * MISMOS hechos que el ROAS para que todos los números cuadren entre secciones.
 */
export function summarizeScaling(
  report: RoasReport,
  chats: ChatFact[],
  orders: RoasOrderFact[],
  nowMs: number = Date.now(),
): ScalingReport {
  const total = report.total;
  const inScope = new Set(report.rows.map((r) => r.agentId));

  const perChat =
    total && total.chats > 0
      ? {
          currency: total.currency,
          adCost: total.investment / total.chats,
          aiCost: total.aiCost / total.chats,
          revenue: total.revenue / total.chats,
          margin: (total.revenue - total.investment - total.aiCost) / total.chats,
        }
      : null;

  // Mes calendario en Bogota. El mes anterior se compara COMPLETO (no "mismo día
  // del mes pasado"): es la vara que el equipo ya usa al hablar de "el mes".
  let month: ScalingReport["month"] = null;
  if (total) {
    const todayKey = bogotaDayKey(nowMs);
    const [y, m, d] = todayKey.split("-").map(Number);
    const monthKey = todayKey.slice(0, 7);
    const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    let revenueMtd = 0;
    let ordersMtd = 0;
    let prevRevenue = 0;
    let prevOrders = 0;
    for (const o of orders) {
      if (o.status === "cancelled" || !inScope.has(o.agentId)) continue;
      const ms = Date.parse(o.createdAt);
      if (!Number.isFinite(ms)) continue;
      const key = bogotaDayKey(ms);
      if (key.startsWith(monthKey)) {
        revenueMtd += Number(o.total) || 0;
        ordersMtd += 1;
      } else if (key.startsWith(prevKey)) {
        prevRevenue += Number(o.total) || 0;
        prevOrders += 1;
      }
    }
    month = {
      daysElapsed: d,
      daysInMonth,
      revenueMtd,
      ordersMtd,
      projectedRevenue: d > 0 ? (revenueMtd / d) * daysInMonth : 0,
      projectedOrders: d > 0 ? Math.round((ordersMtd / d) * daysInMonth) : 0,
      prevRevenue,
      prevOrders,
    };
  }

  // Semana contra semana. Los chats se cuentan siempre (no dependen de moneda).
  const week = 7 * DAY_MS;
  let chats7 = 0;
  let chatsPrev7 = 0;
  for (const c of chats) {
    if (!c.isChat || !inScope.has(c.agentId)) continue;
    const ms = Date.parse(c.createdAt);
    if (!Number.isFinite(ms)) continue;
    if (ms >= nowMs - week) chats7 += 1;
    else if (ms >= nowMs - 2 * week) chatsPrev7 += 1;
  }
  let revenue7: number | null = null;
  let revenuePrev7: number | null = null;
  if (total) {
    revenue7 = 0;
    revenuePrev7 = 0;
    for (const o of orders) {
      if (o.status === "cancelled" || !inScope.has(o.agentId)) continue;
      const ms = Date.parse(o.createdAt);
      if (!Number.isFinite(ms)) continue;
      if (ms >= nowMs - week) revenue7 += Number(o.total) || 0;
      else if (ms >= nowMs - 2 * week) revenuePrev7 += Number(o.total) || 0;
    }
  }

  const growth = (cur: number, prev: number): number | null =>
    prev > 0 ? (cur - prev) / prev : null;

  return {
    perChat,
    month,
    wow: {
      chats7,
      chatsPrev7,
      chatsGrowth: growth(chats7, chatsPrev7),
      revenue7,
      revenuePrev7,
      revenueGrowth:
        revenue7 != null && revenuePrev7 != null ? growth(revenue7, revenuePrev7) : null,
    },
  };
}

// --- Búsqueda de texto libre (Órdenes) --------------------------------------

/** Normaliza para buscar: minúsculas y sin acentos ("Bogotá" encuentra "bogota"). */
export function searchKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * ¿Alguno de los campos contiene la búsqueda? Compara sin acentos ni mayúsculas y,
 * si la búsqueda TRAE dígitos, también los compara sueltos: así "+57 300-123"
 * encuentra el teléfono guardado como E.164.
 *
 * Búsqueda vacía = no filtra (todo pasa). Ojo con el caso que ya rompió una vez:
 * los dígitos de una búsqueda de texto son "", y `includes("")` es siempre true,
 * así que la variante numérica SOLO se prueba cuando hay dígitos de verdad.
 */
export function matchesSearch(fields: Array<string | null | undefined>, query: string): boolean {
  const q = searchKey(query).trim();
  if (!q) return true;
  const haystack = fields.map(searchKey).join(" ");
  const haystackDigits = haystack.replace(/\D/g, "");
  if (haystack.includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  return digits.length > 0 && haystackDigits.includes(digits);
}
