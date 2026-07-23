import type { FulfillmentMethod, OrderStatus } from "@/lib/supabase/types";
import { convertMoney, DEFAULT_CURRENCY, roundForCurrency, type CurrencyCode } from "./currency";

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
  /**
   * Moneda NATIVA de la orden (la del mercado que la vendió). Se homologa a la
   * moneda de lectura dentro de `summarizeOrders`; sin esto, una orden de USD 96
   * se sumaba como si fueran 96 pesos. Ver ADR-0068.
   */
  currency?: string | null;
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
  /** Moneda de lectura: TODOS los montos del reporte están homologados acá. */
  currency: CurrencyCode;
  /** true si al menos una orden venía en otra moneda (los montos son equivalencias). */
  converted: boolean;
  /** Órdenes con monto en una moneda sin tasa: cuentan como orden, no como plata. */
  excluded: number;
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
  /**
   * Matriz día de la semana × hora (7×24), hora Bogota: `byWeekdayHour[d][h]`.
   * Es el mapa de calor de "cuándo se vende": los cortes sueltos por día y por
   * hora esconden la franja (un martes fuerte y un pico a las 8pm no dicen que
   * el martes a las 8pm sea el momento).
   */
  byWeekdayHour: Bucket[][];
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

// --- Rango de fechas de los Reportes (ADR-0087) ------------------------------
//
// Un rango [fromKey, toKey] de días calendario de Bogota, AMBOS INCLUSIVOS. Cuando
// está activo, las series y agregaciones del reporte se recalculan SOLO con los
// hechos que caen dentro del rango; sin rango, cada función mantiene su ventana de
// siempre (14 días, histórico, etc.). Las tarjetas móviles "Hoy / 7 / 30 días" NO
// dependen del rango: son siempre relativas a ahora (decisión de producto).

export interface ReportRange {
  /** Primer día incluido (YYYY-MM-DD, hora Bogota). */
  fromKey: string;
  /** Último día incluido (YYYY-MM-DD, hora Bogota). Inclusivo. */
  toKey: string;
}

/**
 * Arma un rango válido a partir de dos días calendario (los de un `<input type="date">`).
 * Descarta lo que no sea un día real y rellena el lado que falte: solo `from` → hasta
 * hoy; solo `to` → ese único día. Si queda invertido (desde > hasta) devuelve null en
 * vez de una ventana vacía sin explicación (mismo criterio que la lista de Conversaciones).
 */
export function normalizeRange(
  from: string | null | undefined,
  to: string | null | undefined,
  nowMs: number = Date.now(),
): ReportRange | null {
  const f = isDayKey(from) ? (from as string) : undefined;
  const t = isDayKey(to) ? (to as string) : undefined;
  if (!f && !t) return null;
  const toKey = t ?? bogotaDayKey(nowMs);
  const fromKey = f ?? toKey;
  if (fromKey > toKey) return null;
  return { fromKey, toKey };
}

/** Rango de los últimos `days` días terminando hoy (para los atajos 14/30/90). */
export function lastNDaysRange(days: number, nowMs: number = Date.now()): ReportRange {
  const toKey = bogotaDayKey(nowMs);
  const fromKey = bogotaDayKey(nowMs - (Math.max(1, days) - 1) * DAY_MS);
  return { fromKey, toKey };
}

/**
 * Días del rango, MÁS RECIENTE PRIMERO (como el resto de gráficos de la página).
 * `cap` es una red de seguridad: un rango de un año no debe dibujar 365 barras; se
 * quedan los `cap` días más recientes (la página avisa si truncó). El mediodía evita
 * cualquier borde de día (Colombia es UTC-5 fijo, sin horario de verano).
 */
export function rangeDayKeys(range: ReportRange, cap = 92): string[] {
  const startMs = Date.parse(`${range.fromKey}T12:00:00-05:00`);
  const endMs = Date.parse(`${range.toKey}T12:00:00-05:00`);
  const keys: string[] = [];
  for (let ms = endMs; ms >= startMs && keys.length < cap; ms -= DAY_MS) {
    keys.push(bogotaDayKey(ms));
  }
  return keys;
}

/** Cuántos días abarca el rango (para saber si `rangeDayKeys` truncó la serie). */
export function rangeDayCount(range: ReportRange): number {
  const startMs = Date.parse(`${range.fromKey}T12:00:00-05:00`);
  const endMs = Date.parse(`${range.toKey}T12:00:00-05:00`);
  return Math.floor((endMs - startMs) / DAY_MS) + 1;
}

/** ¿El instante `ms` cae dentro del rango? Compara por día calendario de Bogota. */
export function isWithinRange(ms: number, range: ReportRange): boolean {
  if (!Number.isFinite(ms)) return false;
  const key = bogotaDayKey(ms);
  return key >= range.fromKey && key <= range.toKey;
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
 *
 * `display` es la moneda de LECTURA: cada monto se convierte desde la moneda
 * nativa de su orden ANTES de entrar a cualquier suma, porque el dashboard
 * consolida mercados (Colombia, México, EE.UU.) en un solo número. Lo que no
 * tiene tasa no se suma: se cuenta en `excluded` para poder decirlo en pantalla.
 */
export function summarizeOrders(
  facts: OrderFact[],
  nowMs: number = Date.now(),
  display: CurrencyCode = DEFAULT_CURRENCY,
  /**
   * Métodos configurados en el/los agente(s): aparecen SIEMPRE en el corte "por
   * método", aunque todavía no tengan órdenes. Sin esto, un método recién agregado
   * (p. ej. "Link de pago") no existía en Reportes hasta la primera venta. Ver ADR-0080.
   */
  configuredMethods: ReadonlyArray<string> = [],
  /**
   * Rango de fechas activo (ADR-0087). Con rango, los titulares, cortes y la serie
   * por día miran SOLO las órdenes dentro del rango; las tarjetas móviles Hoy/7/30
   * siguen siendo relativas a ahora. Sin rango, comportamiento histórico.
   */
  range?: ReportRange,
): SalesReport {
  const byStatus = Object.fromEntries(
    ORDER_STATUSES.map((s) => [s, emptyBucket()]),
  ) as Record<OrderStatus, Bucket>;
  // Métodos a mostrar: los conocidos (siempre) + los presentes en las órdenes NO
  // canceladas (texto libre por agente). Ordenados para el despliegue.
  const presentMethods = new Set<string>([...FULFILLMENT_METHODS, ...configuredMethods]);
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
  const byWeekdayHour = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, emptyBucket),
  );
  let converted = false;
  let excluded = 0;

  // Serie por día: los días del rango (más reciente primero) si hay rango; si no,
  // los últimos 14 días — la ventana histórica de siempre.
  const dayKeys: string[] = range
    ? rangeDayKeys(range)
    : Array.from({ length: 14 }, (_, i) => bogotaDayKey(nowMs - i * DAY_MS));
  const dayIndex = new Map<string, DayBucket>();
  for (const key of dayKeys) dayIndex.set(key, { date: key, count: 0, revenue: 0 });
  // "Hoy" de las tarjetas móviles es SIEMPRE el día real, no el tope de la serie
  // (con rango, el tope de la serie puede ser un día del pasado).
  const todayKey = bogotaDayKey(nowMs);
  let scopedCount = 0;

  for (const f of facts) {
    // Monto YA en la moneda de lectura. `null` = no sumable (sin total, o en una
    // moneda sin tasa); de acá para abajo nadie vuelve a mirar `f.total`, así no
    // se cuela un monto crudo en una suma de otra moneda.
    const native = f.currency ?? display;
    const amount = convertMoney(f.total, native, display);
    const createdMs = Date.parse(f.createdAt);
    const finite = Number.isFinite(createdMs);
    const isCancelled = f.status === "cancelled";

    // Tarjetas MÓVILES (Hoy / 7 / 30 días): siempre relativas a ahora, ajenas al
    // rango. Solo ventas generadas (no canceladas), igual que siempre.
    if (!isCancelled && finite) {
      if (bogotaDayKey(createdMs) === todayKey) add(today, amount);
      if (createdMs >= nowMs - 7 * DAY_MS) add(last7, amount);
      if (createdMs >= nowMs - 30 * DAY_MS) add(last30, amount);
    }

    // Con rango activo, TODO lo demás (titulares, cortes y series) mira solo los
    // hechos dentro del rango. Sin rango, cuenta todo (comportamiento histórico).
    if (range && !(finite && isWithinRange(createdMs, range))) continue;
    scopedCount += 1;

    if (amount === null && f.total !== null && f.total !== undefined) excluded += 1;
    if (amount !== null && String(native).trim().toUpperCase() !== display) converted = true;

    if (byStatus[f.status]) add(byStatus[f.status], amount);

    if (isCancelled) {
      add(cancelled, amount);
      continue; // las canceladas no cuentan como ventas ni entran a cortes/método
    }

    // No canceladas = generadas.
    add(generated, amount);
    const mk = methodKey(f.method);
    if (byMethod[mk]) add(byMethod[mk], amount);
    if (f.status === "confirmed") add(confirmed, amount);
    if (f.status === "pending_handoff" || f.status === "handed_off") add(pipeline, amount);

    if (finite) {
      const dayBucket = dayIndex.get(bogotaDayKey(createdMs));
      if (dayBucket) {
        dayBucket.count += 1;
        dayBucket.revenue += amount ?? 0;
      }
      // Analítica de horarios (hora Colombia): ¿qué día de la semana y a qué hora
      // se generan las ventas? Solo cuenta generadas (no canceladas).
      const { weekday, hour } = bogotaWeekdayHour(createdMs);
      add(byWeekday[weekday], amount);
      add(byHour[hour], amount);
      add(byWeekdayHour[weekday][hour], amount);
    }
  }

  // Redondeo de presentación UNA vez, sobre los totales ya sumados (redondear
  // fila por fila arrastra el error y el total deja de cuadrar con la lista).
  for (const b of [
    confirmed,
    pipeline,
    cancelled,
    generated,
    today,
    last7,
    last30,
    ...Object.values(byStatus),
    ...Object.values(byMethod),
    ...byWeekday,
    ...byHour,
    ...byWeekdayHour.flat(),
    ...dayIndex.values(),
  ]) {
    b.revenue = roundForCurrency(b.revenue, display);
  }

  return {
    // Con rango, "en total" es el total DENTRO del rango (no el histórico); sin
    // rango, `scopedCount` termina siendo `facts.length` (nada se salta).
    totalOrders: scopedCount,
    currency: display,
    converted,
    excluded,
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
    byWeekdayHour,
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
  /**
   * Rango activo (ADR-0087): la serie por día abarca el rango en vez de los últimos
   * 14. Las ventanas Hoy/7/30 siguen relativas a ahora; `total` lo decide la query
   * (dentro del rango cuando hay rango, histórico si no).
   */
  range?: ReportRange,
): ConversionReport {
  // Conversaciones distintas por ventana/día (actividad inbound).
  const todayC = new Set<string>();
  const last7C = new Set<string>();
  const last30C = new Set<string>();

  const dayKeys: string[] = range
    ? rangeDayKeys(range)
    : Array.from({ length: 14 }, (_, i) => bogotaDayKey(nowMs - i * DAY_MS));
  const dayC = new Map<string, Set<string>>();
  const dayT = new Map<string, number>();
  for (const key of dayKeys) {
    dayC.set(key, new Set());
    dayT.set(key, 0);
  }
  // "Hoy" de las ventanas móviles es el día real, no el tope de la serie (con rango
  // el tope puede ser un día del pasado).
  const todayKey = bogotaDayKey(nowMs);

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

// --- Conversaciones por día por agente (ADR-0087) ---------------------------
//
// "Cuántas conversaciones ENTRAN por día, partidas por agente." Una conversación
// entra el día de su PRIMER contacto (`created_at`, cuando se pagó el lead) — la
// misma base que los chats del ROAS. Alimenta el gráfico apilado Y la tabla: es la
// misma data en dos vistas. Sirve para armar llamadas masivas por agente y ver de
// qué marca están entrando los leads día a día. Puro/testeable.

/** Una conversación con el agente que la atendió y su fecha de entrada. */
export interface ConversationDayFact {
  agentId: string | null;
  /** ISO del `created_at` de la conversación. */
  createdAt: string;
}

/** Cuántas conversaciones entraron para un agente en un día (celda del apilado). */
export interface ConversationDayAgentSlice {
  agentId: string;
  name: string;
  count: number;
}

export interface ConversationDayRow {
  /** Día calendario en Bogota, YYYY-MM-DD. */
  date: string;
  /** Total de conversaciones que entraron ese día (todos los agentes del alcance). */
  total: number;
  /** Desglose por agente, en el MISMO orden para todos los días (color estable). */
  byAgent: ConversationDayAgentSlice[];
}

export interface ConversationsByDayReport {
  /** Días más reciente primero (mismo orden que el resto de gráficos). */
  days: ConversationDayRow[];
  /** Agentes con conversaciones en el periodo, en orden estable (por total desc). */
  agents: Array<{ id: string; name: string }>;
  /** Total por agente en el periodo, alineado a `agents` (fila de totales de la tabla). */
  totalsByAgent: number[];
  /** Total de conversaciones del periodo (todos los días, todos los agentes). */
  total: number;
  /** Máximo de conversaciones en un día (para escalar las barras del apilado). */
  maxDay: number;
  /** true si el rango era más largo que el tope de la serie y se truncó. */
  truncated: boolean;
}

/**
 * Conversaciones por día partidas por agente. Los días son los del rango (más
 * reciente primero) o los últimos 14 si no hay rango. Una conversación sin agente
 * o de un agente fuera del alcance no se cuenta. El orden de los agentes es estable
 * (por total desc, desempatando por nombre) para que el color de cada uno no salte
 * de fila en fila. `nowMs` inyectable para tests.
 */
export function summarizeConversationsByDay(
  facts: ConversationDayFact[],
  agents: Array<{ id: string; name: string }>,
  range?: ReportRange,
  nowMs: number = Date.now(),
): ConversationsByDayReport {
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  const dayKeys = range
    ? rangeDayKeys(range)
    : Array.from({ length: 14 }, (_, i) => bogotaDayKey(nowMs - i * DAY_MS));
  const window = new Set(dayKeys);

  const byDayAgent = new Map<string, Map<string, number>>();
  for (const key of dayKeys) byDayAgent.set(key, new Map());
  const totalByAgent = new Map<string, number>();
  const active = new Set<string>();

  for (const f of facts) {
    if (!f.agentId || !nameById.has(f.agentId)) continue;
    const ms = Date.parse(f.createdAt);
    if (!Number.isFinite(ms)) continue;
    const key = bogotaDayKey(ms);
    if (!window.has(key)) continue;
    byDayAgent.get(key)!.set(f.agentId, (byDayAgent.get(key)!.get(f.agentId) ?? 0) + 1);
    totalByAgent.set(f.agentId, (totalByAgent.get(f.agentId) ?? 0) + 1);
    active.add(f.agentId);
  }

  const ordered = [...active].sort(
    (a, b) =>
      (totalByAgent.get(b) ?? 0) - (totalByAgent.get(a) ?? 0) ||
      (nameById.get(a) ?? "").localeCompare(nameById.get(b) ?? "", "es"),
  );

  const days: ConversationDayRow[] = dayKeys.map((date) => {
    const perAgent = byDayAgent.get(date)!;
    const byAgent = ordered.map((id) => ({
      agentId: id,
      name: nameById.get(id) ?? id,
      count: perAgent.get(id) ?? 0,
    }));
    return { date, total: byAgent.reduce((s, a) => s + a.count, 0), byAgent };
  });

  return {
    days,
    agents: ordered.map((id) => ({ id, name: nameById.get(id) ?? id })),
    totalsByAgent: ordered.map((id) => totalByAgent.get(id) ?? 0),
    total: [...totalByAgent.values()].reduce((s, n) => s + n, 0),
    maxDay: Math.max(1, ...days.map((d) => d.total)),
    truncated: range ? rangeDayCount(range) > dayKeys.length : false,
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

/**
 * Gasto REAL de pauta de un agente en un día, tal como lo reportó la plataforma
 * (tabla `ad_spend`, ADR-0082). Puede haber varias filas por agente/día —una por
 * campaña— y acá se suman.
 */
export interface AdSpendFact {
  agentId: string;
  /** Día calendario `YYYY-MM-DD` (el que reportó la plataforma). */
  date: string;
  spend: number;
  /** Moneda en la que se PAGÓ (se convierte a la de venta del agente para leerla). */
  currency: string;
  /** Leads que reporta la plataforma. Referencia, no reemplaza los chats. */
  leads: number;
}

/** Orden atribuida a un agente, para el retorno. */
export interface RoasOrderFact {
  agentId: string | null;
  status: OrderStatus;
  total: number | null;
  /** ISO del `created_at` de la orden. */
  createdAt: string;
}

/**
 * Lo que cuesta y lo que vende un agente. **Son dos monedas distintas** y hay que
 * tratarlas como tales: la pauta se PAGA en una (`costCurrency`, típicamente lo que
 * cobra Meta) y el producto se VENDE en otra (`saleCurrency`, la del mercado). Meterlas
 * en un solo campo fue el bug: la fila dividía inversión en pesos mexicanos entre
 * ventas en pesos colombianos y llamaba a eso ROAS. Ver ADR-0079.
 */
export interface AgentCostConfig {
  id: string;
  name: string;
  brand: string | null;
  costPerChat: number | null;
  /** Moneda en la que se PAGA la pauta (`agents.cost_currency`). */
  costCurrency: string;
  /** Moneda en la que el agente VENDE (`agents.currency`). */
  saleCurrency: string;
}

export interface RoasRow {
  agentId: string | null;
  name: string;
  brand: string | null;
  /** Costo por chat YA en `currency` (se paga en `costCurrency`, se lee en la de venta). */
  costPerChat: number | null;
  /** Moneda de LECTURA de la fila = la moneda en la que el agente vende. */
  currency: string;
  /** Moneda en la que se paga la pauta de este agente. */
  costCurrency: string;
  /**
   * true si vende en una moneda y paga la pauta en otra. No es un error —pasa de
   * verdad, Meta cobra en dólares— pero es EXACTAMENTE la forma que toma el mercado
   * mal configurado, así que la UI lo pregunta en vez de tragárselo.
   */
  currencyMismatch: boolean;
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
  /** Parte de `investment` que viene del gasto REAL reportado (ADR-0082), en `currency`. */
  realInvestment: number;
  /** Parte estimada con `costPerChat × chats` de los días sin dato real. */
  estimatedInvestment: number;
  /** Nº de días con gasto real reportado. 0 = la fila es 100% estimación. */
  realDays: number;
  /** Leads que reportó la plataforma en esos días. null si no reportó ninguno. */
  platformLeads: number | null;
  /** De dónde sale la inversión de esta fila. Lo que la UI tiene que decir en voz alta. */
  spendSource: SpendSource;
}

/**
 * De dónde salió la inversión que se está mostrando. Se calcula, no se configura:
 * `real` = todos los días con plata tienen dato reportado; `estimated` = ninguno;
 * `mixed` = unos sí y otros no (lo normal mientras Roberto arranca o si un día
 * falla el envío); `none` = no hay ni costo por chat ni gasto real, y entonces la
 * pantalla NO muestra un ROAS inventado.
 */
export type SpendSource = "real" | "estimated" | "mixed" | "none";

export interface RoasDay {
  /** Clave de día en Bogota, YYYY-MM-DD. */
  date: string;
  chats: number;
  investment: number;
  revenue: number;
  roas: number | null;
  /** true si la inversión de ESE día es gasto reportado y no una estimación. */
  real: boolean;
}

export interface RoasReport {
  rows: RoasRow[];
  /**
   * Consolidado de todos los agentes del alcance, con los montos homologados a
   * `currency`. null solo si ningún agente del alcance tiene una moneda con tasa.
   */
  total: RoasRow | null;
  /** Últimos 14 días del alcance, homologados a `currency`. */
  perDay: RoasDay[];
  /** Moneda de lectura del consolidado y del gráfico (las filas van en la suya). */
  currency: CurrencyCode;
  /** true si el consolidado mezcla monedas (es una equivalencia, no una caja). */
  converted: boolean;
  /** Agentes dejados fuera del consolidado por no tener tasa para su moneda. */
  excludedAgents: number;
  /** true si al menos un agente del alcance tiene costo por chat configurado. */
  configured: boolean;
  /** De dónde sale la inversión del alcance completo. Ver `SpendSource`. */
  spendSource: SpendSource;
  /** Días distintos con gasto real reportado en el alcance. */
  realSpendDays: number;
  /** Día más reciente con gasto reportado (`YYYY-MM-DD`), o null. Delata un feed caído. */
  lastRealSpendDate: string | null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * De dónde viene la plata que se está mostrando como inversión. Se decide por los
 * MONTOS y no por los días: un agente con 29 días reportados y uno estimado de $500
 * no debería leerse como "mitad y mitad" — lo que importa es cuánta de la plata en
 * pantalla es dato duro.
 */
function classifySpend(real: number, estimated: number): SpendSource {
  if (real > 0 && estimated > 0) return "mixed";
  if (real > 0) return "real";
  if (estimated > 0) return "estimated";
  return "none";
}

/**
 * Retorno por agente: cuánto costó traer los chats vs. cuánto vendieron.
 *
 * El costo por chat lo define cada agente en su moneda (ADR-0065), así que cada
 * FILA se lee en la suya; el consolidado y el gráfico homologan todo a `display`
 * con las tasas fijas de `currency.ts` (antes, con mercados mezclados, el
 * consolidado simplemente no salía y el dueño se quedaba sin la foto). Un agente
 * cuya moneda no tenga tasa queda fuera del consolidado y se cuenta en
 * `excludedAgents` — no se suma como si ya estuviera en la moneda destino. Un agente sin costo configurado
 * aparece igual (con sus chats y ventas) pero con inversión 0 y ROAS null: se ve
 * que falta configurarlo en vez de mostrar un retorno inventado.
 *
 * `aiCostUsdByAgent` es el gasto de IA de cada agente EN USD (tokens + audios +
 * llamadas); acá se convierte a la moneda del agente para leer Costo IA/chat y
 * ROAIS al lado de la pauta, en las mismas unidades. Ver ADR-0070.
 *
 * `adSpend` es el gasto REAL reportado por la plataforma de anuncios (ADR-0082) y
 * **manda día a día**: para cada día, si hay gasto reportado se usa ese; si no, se
 * cae al estimado `costPerChat × chats de ese día`. La mezcla es a propósito y no
 * un estado transitorio: un día que falle el envío no puede apagar el retorno de
 * todo el mes, y un mes entero de dato real no debe seguir leyéndose con un
 * promedio tecleado a mano. Los días con gasto reportado y CERO chats también
 * suman inversión —se pagó pauta y no llegó nadie, que es justo lo que hay que ver.
 */
export function summarizeRoas(
  agents: AgentCostConfig[],
  chats: ChatFact[],
  orders: RoasOrderFact[],
  aiCostUsdByAgent: Map<string, number> = new Map(),
  display: CurrencyCode = DEFAULT_CURRENCY,
  adSpend: AdSpendFact[] = [],
  /**
   * Rango activo (ADR-0087): la serie por día abarca el rango. Las filas ya llegan
   * filtradas al rango desde la query (chats/órdenes/gasto), así que acá solo cambia
   * la ventana del gráfico. Sin rango, los últimos 14 días de siempre.
   */
  range?: ReportRange,
): RoasReport {
  const byAgent = new Map<string, RoasRow>();
  for (const a of agents) {
    // La fila se lee en la moneda de VENTA: es la del mercado y la de `revenue`.
    // La pauta se convierte a ella una sola vez, acá, para que investment, ROAS,
    // CPA y ganancia salgan todos de las mismas unidades.
    const sale = a.saleCurrency;
    const costPerChatInSale =
      a.costPerChat == null ? null : convertMoney(a.costPerChat, a.costCurrency, sale);
    byAgent.set(a.id, {
      agentId: a.id,
      name: a.name,
      brand: a.brand,
      costPerChat: costPerChatInSale,
      currency: sale,
      costCurrency: a.costCurrency,
      // Sin costo por chat no hay pauta que contradiga nada: marcar el desfase ahí
      // sería un aviso sobre un campo que nadie usó.
      currencyMismatch: a.costPerChat != null && a.costCurrency !== sale,
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
      realInvestment: 0,
      estimatedInvestment: 0,
      realDays: 0,
      platformLeads: null,
      spendSource: "none",
    });
  }

  // --- Gasto real por agente y día, YA en la moneda de venta de ese agente ------
  // Se agrupa una sola vez y lo usan tanto las filas como la serie de 14 días, para
  // que el gráfico y la tabla no puedan contar historias distintas. Una fila cuya
  // moneda no tenga tasa se DESCARTA (no se suma como si ya estuviera en destino).
  const saleCurrencyOf = new Map(agents.map((a) => [a.id, a.saleCurrency]));
  const realByAgentDay = new Map<string, Map<string, { spend: number; leads: number }>>();
  for (const s of adSpend) {
    const sale = saleCurrencyOf.get(s.agentId);
    if (!sale) continue; // gasto de un agente fuera del alcance (o borrado)
    const amount = convertMoney(s.spend, s.currency, sale);
    if (amount === null) continue;
    let days = realByAgentDay.get(s.agentId);
    if (!days) {
      days = new Map();
      realByAgentDay.set(s.agentId, days);
    }
    const prev = days.get(s.date) ?? { spend: 0, leads: 0 };
    days.set(s.date, { spend: prev.spend + amount, leads: prev.leads + (s.leads || 0) });
  }

  // Chats por agente y día: el estimado se arma día a día (no con el total), porque
  // el gasto real reemplaza días sueltos y hay que saber cuáles quedaron sin dato.
  const chatsByAgentDay = new Map<string, Map<string, number>>();
  for (const c of chats) {
    if (!c.isChat) continue;
    const row = c.agentId ? byAgent.get(c.agentId) : undefined;
    if (!row || !c.agentId) continue;
    row.chats += 1;
    let days = chatsByAgentDay.get(c.agentId);
    if (!days) {
      days = new Map();
      chatsByAgentDay.set(c.agentId, days);
    }
    const key = bogotaDayKey(Date.parse(c.createdAt));
    days.set(key, (days.get(key) ?? 0) + 1);
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
    const id = row.agentId ?? "";
    const realDays = realByAgentDay.get(id) ?? new Map<string, { spend: number; leads: number }>();
    const chatDays = chatsByAgentDay.get(id) ?? new Map<string, number>();

    let leads = 0;
    for (const d of realDays.values()) {
      row.realInvestment += d.spend;
      leads += d.leads;
    }
    // Solo los días SIN gasto reportado se estiman. Sumar los dos sobre el mismo
    // día contaría la pauta dos veces, que era el riesgo obvio de esta mezcla.
    for (const [day, count] of chatDays) {
      if (realDays.has(day)) continue;
      row.estimatedInvestment += (row.costPerChat ?? 0) * count;
    }
    row.realDays = realDays.size;
    row.platformLeads = realDays.size > 0 ? leads : null;
    row.investment = row.realInvestment + row.estimatedInvestment;
    row.spendSource = classifySpend(row.realInvestment, row.estimatedInvestment);

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

  // Tasa de CADA fila hacia la moneda de lectura. `null` = sin tasa: esa fila no
  // entra al consolidado (ni su plata ni sus chats, o el ROAS saldría torcido).
  const rateOf = new Map<string | null, number | null>();
  for (const r of rows) rateOf.set(r.agentId, convertMoney(1, r.currency, display));
  const usable = rows.filter((r) => rateOf.get(r.agentId) != null);
  const excludedAgents = rows.length - usable.length;
  const converted = usable.some((r) => r.currency !== display);
  const sumIn = (pick: (r: RoasRow) => number): number =>
    usable.reduce((s, r) => s + pick(r) * (rateOf.get(r.agentId) as number), 0);

  let total: RoasRow | null = null;
  if (usable.length > 0) {
    const chatsTotal = usable.reduce((s, r) => s + r.chats, 0);
    const investment = sumIn((r) => r.investment);
    const revenue = sumIn((r) => r.revenue);
    const confirmedRevenue = sumIn((r) => r.confirmedRevenue);
    const ordersTotal = usable.reduce((s, r) => s + r.orders, 0);
    const aiCostTotal = sumIn((r) => r.aiCost);
    const realTotal = sumIn((r) => r.realInvestment);
    const estimatedTotal = sumIn((r) => r.estimatedInvestment);
    const leadsTotal = usable.reduce((s, r) => s + (r.platformLeads ?? 0), 0);
    total = {
      agentId: null,
      name: "Todos los agentes",
      brand: null,
      // Costo por chat MEZCLADO del alcance (inversión / chats), no un promedio
      // simple: si un agente trae 10× más chats, pesa 10× más.
      costPerChat: ratio(investment, chatsTotal),
      currency: display,
      costCurrency: display,
      currencyMismatch: false,
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
      realInvestment: realTotal,
      estimatedInvestment: estimatedTotal,
      // Días DISTINTOS con dato en todo el alcance: si dos agentes reportaron el
      // mismo martes, el alcance tiene un martes cubierto, no dos.
      realDays: new Set(
        usable.flatMap((r) => [...(realByAgentDay.get(r.agentId ?? "")?.keys() ?? [])]),
      ).size,
      platformLeads: usable.some((r) => r.platformLeads != null) ? leadsTotal : null,
      spendSource: classifySpend(realTotal, estimatedTotal),
    };
  }

  // Serie de 14 días, MÁS RECIENTE PRIMERO: el gráfico es una lista vertical de
  // filas (igual que "Órdenes generadas" y "Conversión") y todas ponen hoy arriba.
  const perDay: RoasDay[] = [];
  if (usable.length > 0) {
    // Costo por chat de cada agente YA homologado: el gráfico y el consolidado
    // tienen que salir de la misma conversión o no cuadran entre sí.
    const inScope = new Set(usable.map((r) => r.agentId));
    const costById = new Map(
      agents.map((a) => [a.id, convertMoney(a.costPerChat ?? 0, a.costCurrency, display) ?? 0]),
    );
    const dayChats = new Map<string, number>();
    const dayInvestment = new Map<string, number>();
    const dayRevenue = new Map<string, number>();
    /** Días del gráfico donde AL MENOS un agente aportó gasto reportado. */
    const dayHasReal = new Set<string>();

    const dayKeys: string[] = range
      ? rangeDayKeys(range)
      : Array.from({ length: 14 }, (_, i) => bogotaDayKey(Date.now() - i * DAY_MS));
    const window = new Set(dayKeys);

    // El gasto real entra PRIMERO y por agente/día, para poder saltarse después el
    // estimado de exactamente esos pares (misma regla que las filas: nunca los dos).
    for (const r of usable) {
      const id = r.agentId ?? "";
      const rate = (rateOf.get(r.agentId) as number | null) ?? 0;
      for (const [day, d] of realByAgentDay.get(id) ?? []) {
        if (!window.has(day)) continue;
        dayInvestment.set(day, (dayInvestment.get(day) ?? 0) + d.spend * rate);
        dayHasReal.add(day);
      }
    }

    for (const c of chats) {
      if (!c.isChat || !c.agentId || !inScope.has(c.agentId)) continue;
      const key = bogotaDayKey(Date.parse(c.createdAt));
      if (!window.has(key)) continue;
      dayChats.set(key, (dayChats.get(key) ?? 0) + 1);
      // Los chats se cuentan siempre; el costo estimado, solo si ESE agente no
      // reportó gasto ESE día.
      if (realByAgentDay.get(c.agentId)?.has(key)) continue;
      dayInvestment.set(key, (dayInvestment.get(key) ?? 0) + (costById.get(c.agentId) ?? 0));
    }
    for (const o of orders) {
      if (o.status === "cancelled" || !o.agentId || !inScope.has(o.agentId)) continue;
      const key = bogotaDayKey(Date.parse(o.createdAt));
      if (!window.has(key)) continue;
      const rate = (rateOf.get(o.agentId) as number | null) ?? 0;
      dayRevenue.set(key, (dayRevenue.get(key) ?? 0) + (Number(o.total) || 0) * rate);
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
        real: dayHasReal.has(key),
      });
    }
  }

  // Última fecha con gasto reportado en TODO el alcance (no solo en los 14 días):
  // es el semáforo del feed — si dice "hace 6 días", el envío se cayó.
  let lastRealSpendDate: string | null = null;
  for (const days of realByAgentDay.values()) {
    for (const day of days.keys()) {
      if (lastRealSpendDate === null || day > lastRealSpendDate) lastRealSpendDate = day;
    }
  }

  return {
    rows,
    total,
    perDay,
    currency: display,
    converted,
    excludedAgents,
    configured: rows.some(
      (r) => (r.costPerChat != null && r.costPerChat > 0) || r.realInvestment > 0,
    ),
    spendSource: total ? total.spendSource : classifySpend(0, 0),
    realSpendDays: new Set([...realByAgentDay.values()].flatMap((d) => [...d.keys()])).size,
    lastRealSpendDate,
  };
}

// --- Semana a semana: chats por agente vs. ventas (ADR-0079) -----------------

/**
 * Lunes de la semana (clave `YYYY-MM-DD`, hora Bogota) a la que pertenece un instante.
 * Semana lunes→domingo, que es como el equipo habla de "esta semana" — no la del
 * `getUTCDay()` crudo, que arranca en domingo y parte los fines de semana en dos.
 */
export function bogotaWeekStartKey(ms: number): string {
  const { weekday } = bogotaWeekdayHour(ms);
  // weekday: 0=Dom … 6=Sáb → días a retroceder hasta el lunes.
  const back = (weekday + 6) % 7;
  return bogotaDayKey(ms - back * DAY_MS);
}

/** Cuántos chats trajo un agente en una semana (para la barra apilada). */
export interface WeeklyAgentSlice {
  agentId: string;
  name: string;
  chats: number;
}

export interface WeekBucket {
  /** Lunes de la semana, `YYYY-MM-DD` en Bogota. */
  weekStart: string;
  /** Chats de la semana (conversaciones con al menos un inbound). */
  chats: number;
  /** Desglose por agente, en el mismo orden para todas las semanas. */
  byAgent: WeeklyAgentSlice[];
  /** Órdenes NO canceladas creadas en la semana. */
  orders: number;
  /** Plata de esas órdenes, homologada a la moneda de lectura. */
  revenue: number;
  /** orders / chats. null sin chats — no es 0%, es "no hay base". */
  conversion: number | null;
  /** true en la semana en curso: va incompleta y no se compara de igual a igual. */
  partial: boolean;
}

export interface WeeklyReport {
  /** Semanas más reciente primero (mismo orden que el resto de gráficos). */
  weeks: WeekBucket[];
  /** Agentes con actividad en el periodo, en orden estable (para el color). */
  agents: Array<{ id: string; name: string }>;
  currency: CurrencyCode;
  /** true si hubo que convertir ventas de otra moneda. */
  converted: boolean;
}

/**
 * La foto semanal: cuántos chats entraron (y de qué agente salió cada uno) contra
 * cuántas ventas cerraron esa misma semana.
 *
 * El día a día de una operación de WhatsApp es ruido —un festivo, un día que la
 * pauta arrancó tarde— y el mes tarda demasiado en decir algo. La semana es la
 * unidad en la que se decide subir o bajar presupuesto, y partirla por agente
 * muestra CUÁL mercado está creciendo, no solo que "hay más chats".
 *
 * Un chat se cuenta el día que ENTRÓ (`created_at` de la conversación, cuando se
 * pagó el lead) y una orden el día que se creó: las mismas bases que ROAS y
 * "Órdenes generadas", para que los números cuadren entre secciones.
 */
export function summarizeWeekly(
  agents: AgentCostConfig[],
  chats: ChatFact[],
  orders: RoasOrderFact[],
  display: CurrencyCode = DEFAULT_CURRENCY,
  weeksBack = 8,
  nowMs: number = Date.now(),
  /**
   * Rango activo (ADR-0087): las semanas van de la del `toKey` a la del `fromKey`
   * (tope 26) en vez de las últimas 8. Los chats/órdenes ya llegan filtrados al
   * rango desde la query.
   */
  range?: ReportRange,
): WeeklyReport {
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  // Tasa de venta de cada agente hacia la moneda de lectura. Sin tasa → la plata
  // de ese agente no entra (no se suma como si ya estuviera en la moneda destino).
  const rateById = new Map<string, number | null>(
    agents.map((a) => [a.id, convertMoney(1, a.saleCurrency, display)]),
  );

  const weekKeys: string[] = [];
  if (range) {
    const toWkMs = Date.parse(
      `${bogotaWeekStartKey(Date.parse(`${range.toKey}T12:00:00-05:00`))}T12:00:00-05:00`,
    );
    const fromWkMs = Date.parse(
      `${bogotaWeekStartKey(Date.parse(`${range.fromKey}T12:00:00-05:00`))}T12:00:00-05:00`,
    );
    for (let ms = toWkMs; ms >= fromWkMs && weekKeys.length < 26; ms -= 7 * DAY_MS) {
      weekKeys.push(bogotaDayKey(ms));
    }
  } else {
    for (let i = 0; i < weeksBack; i++) weekKeys.push(bogotaWeekStartKey(nowMs - i * 7 * DAY_MS));
  }
  // La marca "en curso" es la semana que contiene a HOY, esté o no en la lista (con
  // rango en el pasado no hay ninguna semana en curso).
  const currentWeek = bogotaWeekStartKey(nowMs);
  const index = new Map<string, WeekBucket>();
  for (const key of weekKeys) {
    index.set(key, {
      weekStart: key,
      chats: 0,
      byAgent: [],
      orders: 0,
      revenue: 0,
      conversion: null,
      partial: key === currentWeek,
    });
  }
  // Chats por semana y agente. Se acumula en un mapa aparte y al final se vuelca en
  // el MISMO orden para todas las semanas: si el orden variara, el color de cada
  // agente cambiaría de fila en fila y el gráfico dejaría de leerse.
  const chatsByWeekAgent = new Map<string, Map<string, number>>();
  const activeAgents = new Set<string>();

  for (const c of chats) {
    if (!c.isChat || !c.agentId || !nameById.has(c.agentId)) continue;
    const ms = Date.parse(c.createdAt);
    if (!Number.isFinite(ms)) continue;
    const key = bogotaWeekStartKey(ms);
    const bucket = index.get(key);
    if (!bucket) continue;
    bucket.chats += 1;
    activeAgents.add(c.agentId);
    const perAgent = chatsByWeekAgent.get(key) ?? new Map<string, number>();
    perAgent.set(c.agentId, (perAgent.get(c.agentId) ?? 0) + 1);
    chatsByWeekAgent.set(key, perAgent);
  }

  let converted = false;
  for (const o of orders) {
    if (o.status === "cancelled" || !o.agentId || !nameById.has(o.agentId)) continue;
    const ms = Date.parse(o.createdAt);
    if (!Number.isFinite(ms)) continue;
    const bucket = index.get(bogotaWeekStartKey(ms));
    if (!bucket) continue;
    bucket.orders += 1;
    const rate = rateById.get(o.agentId);
    if (rate != null) {
      bucket.revenue += (Number(o.total) || 0) * rate;
      if (rate !== 1) converted = true;
    }
  }

  // Orden estable de agentes: por chats totales del periodo, de mayor a menor.
  const totalByAgent = new Map<string, number>();
  for (const perAgent of chatsByWeekAgent.values()) {
    for (const [id, n] of perAgent) totalByAgent.set(id, (totalByAgent.get(id) ?? 0) + n);
  }
  const ordered = [...activeAgents].sort(
    (a, b) =>
      (totalByAgent.get(b) ?? 0) - (totalByAgent.get(a) ?? 0) ||
      (nameById.get(a) ?? "").localeCompare(nameById.get(b) ?? ""),
  );

  for (const key of weekKeys) {
    const bucket = index.get(key)!;
    const perAgent = chatsByWeekAgent.get(key);
    bucket.byAgent = ordered.map((id) => ({
      agentId: id,
      name: nameById.get(id) ?? id,
      chats: perAgent?.get(id) ?? 0,
    }));
    bucket.revenue = roundForCurrency(bucket.revenue, display);
    bucket.conversion = bucket.chats > 0 ? bucket.orders / bucket.chats : null;
  }

  return {
    weeks: weekKeys.map((k) => index.get(k)!),
    agents: ordered.map((id) => ({ id, name: nameById.get(id) ?? id })),
    currency: display,
    converted,
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
  // Mismo criterio que el consolidado: solo los agentes cuya moneda tiene tasa, y
  // cada monto multiplicado por ella. Si acá se sumara `total` crudo, la
  // proyección del mes volvería a mezclar dólares con pesos.
  const rateOf = new Map<string | null, number>();
  for (const r of report.rows) {
    const rate = convertMoney(1, r.currency, report.currency);
    if (rate != null) rateOf.set(r.agentId, rate);
  }
  const inScope = new Set(rateOf.keys());
  const rate = (agentId: string | null): number => rateOf.get(agentId) ?? 0;

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
      const amount = (Number(o.total) || 0) * rate(o.agentId);
      if (key.startsWith(monthKey)) {
        revenueMtd += amount;
        ordersMtd += 1;
      } else if (key.startsWith(prevKey)) {
        prevRevenue += amount;
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
      const amount = (Number(o.total) || 0) * rate(o.agentId);
      if (ms >= nowMs - week) revenue7 += amount;
      else if (ms >= nowMs - 2 * week) revenuePrev7 += amount;
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
