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
}

export interface ProductConversionRow {
  /** null = "Sin categoría". */
  category: string | null;
  conversations: number;
  transactions: number;
  rate: number;
}

/**
 * Agrupa las conversaciones por producto y calcula cuántas convirtieron. Ordena
 * por # de conversaciones desc; "Sin categoría" (null) va al final. Puro/testeable.
 */
export function summarizeProductConversion(facts: ProductConversionFact[]): ProductConversionRow[] {
  const byCat = new Map<string | null, { conversations: number; transactions: number }>();
  for (const f of facts) {
    const key = f.productCategory && f.productCategory.trim() ? f.productCategory.trim() : null;
    const t = byCat.get(key) ?? { conversations: 0, transactions: 0 };
    t.conversations += 1;
    if (f.converted) t.transactions += 1;
    byCat.set(key, t);
  }
  return [...byCat.entries()]
    .map(([category, t]) => ({
      category,
      conversations: t.conversations,
      transactions: t.transactions,
      rate: t.conversations > 0 ? t.transactions / t.conversations : 0,
    }))
    .sort((a, b) => {
      if (a.category === null) return 1; // "Sin categoría" al final
      if (b.category === null) return -1;
      return b.conversations - a.conversations;
    });
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
 */
export function summarizeRoas(
  agents: AgentCostConfig[],
  chats: ChatFact[],
  orders: RoasOrderFact[],
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
    };
  }

  // Serie de 14 días (hoy primero al construir, se devuelve del más viejo al más
  // nuevo para que el gráfico se lea de izquierda a derecha).
  const perDay: RoasDay[] = [];
  if (singleCurrency) {
    const costById = new Map(agents.map((a) => [a.id, a.costPerChat ?? 0]));
    const dayChats = new Map<string, number>();
    const dayInvestment = new Map<string, number>();
    const dayRevenue = new Map<string, number>();

    const dayKeys: string[] = [];
    const now = Date.now();
    for (let i = 13; i >= 0; i--) dayKeys.push(bogotaDayKey(now - i * DAY_MS));
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
