import { describe, expect, it } from "vitest";
import {
  bogotaDayEndIso,
  bogotaDayKey,
  bogotaDayStartIso,
  bogotaWeekdayHour,
  isDayKey,
  matchesSearch,
  summarizeCloseSpeed,
  summarizeConversationActivity,
  summarizeOrders,
  summarizeProductConversion,
  summarizeRoas,
  summarizeTopProducts,
  type AgentCostConfig,
  type ChatFact,
  type CloseSpeedFact,
  type ConversationActivityFact,
  type OrderFact,
  type ProductSalesFact,
  type RoasOrderFact,
  type TransactionFact,
} from "./report";

// Ancla fija: 2026-07-02 15:00 UTC = 2026-07-02 10:00 en Bogota (UTC-5).
const NOW = Date.parse("2026-07-02T15:00:00Z");
const day = (iso: string) => iso;

describe("bogotaDayKey", () => {
  it("convierte a día calendario en Bogota (UTC-5)", () => {
    // 03:00 UTC del día 2 = 22:00 del día 1 en Bogota.
    expect(bogotaDayKey(Date.parse("2026-07-02T03:00:00Z"))).toBe("2026-07-01");
    expect(bogotaDayKey(Date.parse("2026-07-02T15:00:00Z"))).toBe("2026-07-02");
  });
});

describe("summarizeOrders", () => {
  const facts: OrderFact[] = [
    // Confirmada hoy, addi, 100k.
    { status: "confirmed", method: "addi", total: 100000, createdAt: day("2026-07-02T14:00:00Z") },
    // En logística hoy, cod, 50k.
    { status: "handed_off", method: "cod", total: 50000, createdAt: day("2026-07-02T13:00:00Z") },
    // Pendiente hace 3 días, cod, sin total.
    { status: "pending_handoff", method: "cod", total: null, createdAt: day("2026-06-29T12:00:00Z") },
    // Cancelada ayer, addi, 80k → no cuenta como venta.
    { status: "cancelled", method: "addi", total: 80000, createdAt: day("2026-07-01T12:00:00Z") },
    // Confirmada hace 20 días, undecided, 40k.
    { status: "confirmed", method: "undecided", total: 40000, createdAt: day("2026-06-12T12:00:00Z") },
  ];

  const r = summarizeOrders(facts, NOW);

  it("cuenta el total de órdenes incluyendo canceladas", () => {
    expect(r.totalOrders).toBe(5);
  });

  it("confirmadas = solo status confirmed", () => {
    expect(r.confirmed).toEqual({ count: 2, revenue: 140000 });
  });

  it("pipeline = pending + handed_off", () => {
    expect(r.pipeline).toEqual({ count: 2, revenue: 50000 });
  });

  it("canceladas separadas y excluidas de generadas", () => {
    expect(r.cancelled).toEqual({ count: 1, revenue: 80000 });
    // generadas = todas menos cancelada: 100k + 50k + 0 + 40k
    expect(r.generated).toEqual({ count: 4, revenue: 190000 });
  });

  it("por estado", () => {
    expect(r.byStatus.confirmed).toEqual({ count: 2, revenue: 140000 });
    expect(r.byStatus.cancelled).toEqual({ count: 1, revenue: 80000 });
    expect(r.byStatus.pending_handoff).toEqual({ count: 1, revenue: 0 });
  });

  it("por método excluye canceladas", () => {
    // addi cancelada (80k) NO cuenta; solo la addi confirmada (100k).
    expect(r.byMethod.addi).toEqual({ count: 1, revenue: 100000 });
    expect(r.byMethod.cod).toEqual({ count: 2, revenue: 50000 });
    expect(r.byMethod.undecided).toEqual({ count: 1, revenue: 40000 });
  });

  it("cortes por ventana de tiempo (generadas)", () => {
    // Hoy: las 2 de 2026-07-02.
    expect(r.today).toEqual({ count: 2, revenue: 150000 });
    // Últimos 7 días: hoy (2) + la pendiente de hace 3 días (0).
    expect(r.last7).toEqual({ count: 3, revenue: 150000 });
    // Últimos 30 días: las 4 generadas.
    expect(r.last30).toEqual({ count: 4, revenue: 190000 });
  });

  it("perDay tiene 14 días, más reciente primero, y ubica las órdenes", () => {
    expect(r.perDay).toHaveLength(14);
    expect(r.perDay[0].date).toBe("2026-07-02");
    expect(r.perDay[0]).toEqual({ date: "2026-07-02", count: 2, revenue: 150000 });
    // hace 3 días (2026-06-29): la pendiente sin total.
    const d = r.perDay.find((x) => x.date === "2026-06-29");
    expect(d).toEqual({ date: "2026-06-29", count: 1, revenue: 0 });
  });

  it("byHour ubica las generadas por hora Colombia (excluye canceladas)", () => {
    // 14:00Z→09h, 13:00Z→08h, 06-29 12:00Z→07h, 06-12 12:00Z→07h. La cancelada no cuenta.
    expect(r.byHour[9].count).toBe(1);
    expect(r.byHour[8].count).toBe(1);
    expect(r.byHour[7].count).toBe(2);
    expect(r.byHour.reduce((s, b) => s + b.count, 0)).toBe(4); // = generadas
  });

  it("byWeekday suma = generadas (7 días)", () => {
    expect(r.byWeekday).toHaveLength(7);
    expect(r.byWeekday.reduce((s, b) => s + b.count, 0)).toBe(4);
  });
});

describe("bogotaWeekdayHour", () => {
  it("da la hora en Bogota (UTC-5), cruzando el día si toca", () => {
    expect(bogotaWeekdayHour(Date.parse("2026-07-02T14:00:00Z")).hour).toBe(9);
    // 03:00Z → 22:00 del día anterior en Bogota.
    expect(bogotaWeekdayHour(Date.parse("2026-07-02T03:00:00Z")).hour).toBe(22);
  });
});

describe("summarizeProductConversion", () => {
  const rows = summarizeProductConversion([
    { productCategory: "magnesio", converted: true, orders: 2, revenue: 150_000 },
    { productCategory: "magnesio", converted: false, orders: 0, revenue: null },
    { productCategory: "colageno", converted: true, orders: 1, revenue: 90_000 },
    { productCategory: null, converted: false, orders: 0, revenue: null },
    { productCategory: "  ", converted: true, orders: 1, revenue: 40_000 }, // vacío → Sin categoría
  ]);

  it("agrupa por producto: conversión, órdenes, ventas y valor por chat", () => {
    expect(rows.find((x) => x.category === "magnesio")).toEqual({
      category: "magnesio",
      conversations: 2,
      transactions: 1,
      rate: 0.5,
      orders: 2,
      revenue: 150_000,
      revenuePerConversation: 75_000,
    });
    expect(rows.find((x) => x.category === "colageno")).toEqual({
      category: "colageno",
      conversations: 1,
      transactions: 1,
      rate: 1,
      orders: 1,
      revenue: 90_000,
      revenuePerConversation: 90_000,
    });
  });

  it("ordena por ventas desc con 'Sin categoría' (null + vacío) al final", () => {
    expect(rows.map((x) => x.category)).toEqual(["magnesio", "colageno", null]);
    const none = rows.find((x) => x.category === null);
    expect(none).toEqual({
      category: null,
      conversations: 2,
      transactions: 1,
      rate: 0.5,
      orders: 1,
      revenue: 40_000,
      revenuePerConversation: 20_000,
    });
  });
});

describe("summarizeTopProducts", () => {
  const item = (
    sku: string,
    orderId: string,
    over: Partial<ProductSalesFact> = {},
  ): ProductSalesFact => ({
    sku,
    name: `Producto ${sku}`,
    qty: 1,
    revenue: 50_000,
    orderId,
    cancelled: false,
    ...over,
  });

  it("agrupa por SKU: unidades, órdenes distintas, ventas y ticket por orden", () => {
    const rows = summarizeTopProducts([
      item("MAG-1", "o1", { qty: 2, revenue: 100_000 }),
      item("MAG-1", "o2"),
      item("COL-1", "o2", { revenue: 90_000 }),
    ]);
    expect(rows[0]).toMatchObject({
      sku: "MAG-1",
      units: 3,
      orders: 2,
      revenue: 150_000,
      perOrder: 75_000,
      cancelRate: 0,
    });
    // Ordena por ventas desc.
    expect(rows.map((r) => r.sku)).toEqual(["MAG-1", "COL-1"]);
  });

  it("las canceladas no suman ventas/unidades pero sí a la tasa de cancelación", () => {
    const rows = summarizeTopProducts([
      item("MAG-1", "o1"),
      item("MAG-1", "o2", { cancelled: true, revenue: null }),
    ]);
    expect(rows[0]).toMatchObject({
      units: 1,
      orders: 1,
      revenue: 50_000,
      cancelledOrders: 1,
      cancelRate: 0.5,
    });
  });

  it("ítems sin precio (revenue null) cuentan unidades pero no plata; sin nombre usa el SKU", () => {
    const rows = summarizeTopProducts([item("MAG-1", "o1", { name: null, revenue: null })]);
    expect(rows[0]).toMatchObject({ name: "MAG-1", units: 1, revenue: 0, perOrder: 0 });
  });

  it("ignora ítems con SKU vacío", () => {
    expect(summarizeTopProducts([item("  ", "o1")])).toEqual([]);
  });
});

describe("summarizeCloseSpeed", () => {
  const fact = (
    conversationId: string,
    conversationCreatedAt: string,
    orderCreatedAt: string,
  ): CloseSpeedFact => ({ conversationId, conversationCreatedAt, orderCreatedAt });

  it("mide la PRIMERA orden por conversación y ubica los buckets", () => {
    const r = summarizeCloseSpeed([
      // A: cierra en 10 min (≤ 15 min). Su segunda orden es recompra, no cierre.
      fact("A", "2026-07-02T10:00:00Z", "2026-07-02T10:10:00Z"),
      fact("A", "2026-07-02T10:00:00Z", "2026-07-03T10:00:00Z"),
      // B: cierra en 30 min (15–60 min).
      fact("B", "2026-07-02T10:00:00Z", "2026-07-02T10:30:00Z"),
      // C: cierra en 2 días (1–3 días).
      fact("C", "2026-07-01T10:00:00Z", "2026-07-03T10:00:00Z"),
    ]);
    expect(r.closes).toBe(3);
    expect(r.medianMinutes).toBe(30);
    expect(r.buckets.map((b) => b.count)).toEqual([1, 1, 0, 0, 1, 0]);
    expect(r.withinHourRate).toBeCloseTo(2 / 3, 5);
    expect(r.withinDayRate).toBeCloseTo(2 / 3, 5);
  });

  it("cuenta recompras: conversaciones con más de una orden y sus órdenes extra", () => {
    const r = summarizeCloseSpeed([
      fact("A", "2026-07-02T10:00:00Z", "2026-07-02T10:10:00Z"),
      fact("A", "2026-07-02T10:00:00Z", "2026-07-03T10:00:00Z"),
      fact("A", "2026-07-02T10:00:00Z", "2026-07-04T10:00:00Z"),
      fact("B", "2026-07-02T10:00:00Z", "2026-07-02T10:30:00Z"),
    ]);
    expect(r.repeatConversations).toBe(1);
    expect(r.repeatOrders).toBe(2);
  });

  it("una orden 'antes' de la conversación (desfase de relojes) cuenta como 0 min", () => {
    const r = summarizeCloseSpeed([fact("A", "2026-07-02T10:00:05Z", "2026-07-02T10:00:00Z")]);
    expect(r.medianMinutes).toBe(0);
    expect(r.buckets[0].count).toBe(1);
  });

  it("vacío: mediana null y tasas en 0", () => {
    const r = summarizeCloseSpeed([]);
    expect(r).toMatchObject({ closes: 0, medianMinutes: null, withinHourRate: 0, withinDayRate: 0 });
  });
});

describe("summarizeConversationActivity", () => {
  // Actividad = un inbound del cliente. Conversaciones distintas: A, B, C, D.
  const activity: ConversationActivityFact[] = [
    // A: activa HOY (dos mensajes → cuenta una vez) y hace 3 días.
    { conversationId: "A", createdAt: "2026-07-02T14:00:00Z" },
    { conversationId: "A", createdAt: "2026-07-02T09:00:00Z" },
    { conversationId: "A", createdAt: "2026-06-29T10:00:00Z" },
    // B: activa HOY.
    { conversationId: "B", createdAt: "2026-07-02T09:30:00Z" },
    // C: activa hace 3 días.
    { conversationId: "C", createdAt: "2026-06-29T12:00:00Z" },
    // D: activa hace 20 días.
    { conversationId: "D", createdAt: "2026-06-12T12:00:00Z" },
  ];
  // Transacciones = órdenes no canceladas, por su FECHA DE CREACIÓN (no la actividad).
  const transactions: TransactionFact[] = [
    { createdAt: "2026-07-02T11:00:00Z" }, // orden creada hoy
    { createdAt: "2026-06-29T12:00:00Z" }, // orden creada hace 3 días
    { createdAt: "2026-06-10T12:00:00Z" }, // hace 22 días (en 30d, fuera de los 14 del gráfico)
  ];
  // total histórico se pasa aparte.
  const c = summarizeConversationActivity(activity, transactions, { conversations: 10, transactions: 3 }, NOW);

  it("total: histórico inyectado (10 conversaciones, 3 transacciones, 30%)", () => {
    expect(c.total).toEqual({ conversations: 10, transactions: 3, rate: 0.3 });
  });

  it("hoy: 2 conversaciones (A, B) y 1 transacción (orden creada hoy)", () => {
    expect(c.today).toEqual({ conversations: 2, transactions: 1, rate: 0.5 });
  });

  it("7 días: 3 conversaciones (A, B, C) y 2 transacciones (hoy + hace 3 días)", () => {
    expect(c.last7.conversations).toBe(3);
    expect(c.last7.transactions).toBe(2);
    expect(c.last7.rate).toBeCloseTo(2 / 3, 5);
  });

  it("30 días: 4 conversaciones y las 3 transacciones", () => {
    expect(c.last30).toEqual({ conversations: 4, transactions: 3, rate: 0.75 });
  });

  it("una compra vieja NO cuenta como transacción de hoy aunque la conversación esté activa hoy", () => {
    // A está activa hoy pero su única orden asociada (si la hubiera) no se
    // atribuye a hoy: las transacciones salen de la fecha de la orden, no del chat.
    const soloActividad = summarizeConversationActivity(
      [{ conversationId: "A", createdAt: "2026-07-02T14:00:00Z" }],
      [{ createdAt: "2026-06-28T12:00:00Z" }], // orden de hace días
      { conversations: 1, transactions: 1 },
      NOW,
    );
    expect(soloActividad.today).toEqual({ conversations: 1, transactions: 0, rate: 0 });
  });

  it("rate = 0 y ventanas vacías cuando no hay nada", () => {
    const empty = summarizeConversationActivity([], [], { conversations: 0, transactions: 0 }, NOW);
    expect(empty.total).toEqual({ conversations: 0, transactions: 0, rate: 0 });
    expect(empty.today).toEqual({ conversations: 0, transactions: 0, rate: 0 });
  });

  it("perDay: conversaciones activas distintas + transacciones por fecha de orden", () => {
    expect(c.perDay).toHaveLength(14);
    // Hoy: A + B activas; 1 orden creada hoy.
    expect(c.perDay[0]).toEqual({
      date: "2026-07-02",
      conversations: 2,
      transactions: 1,
      rate: 0.5,
    });
    // Hace 3 días: A y C activas; 1 orden creada ese día.
    expect(c.perDay.find((x) => x.date === "2026-06-29")).toEqual({
      date: "2026-06-29",
      conversations: 2,
      transactions: 1,
      rate: 0.5,
    });
  });
});

describe("isDayKey / rangos de día en Bogota", () => {
  it("acepta un YYYY-MM-DD real y rechaza basura o fechas imposibles", () => {
    expect(isDayKey("2026-07-02")).toBe(true);
    expect(isDayKey("2026-02-31")).toBe(false);
    expect(isDayKey("02/07/2026")).toBe(false);
    expect(isDayKey("")).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });

  it("el día empieza a las 00:00 de Bogota = 05:00 UTC", () => {
    expect(bogotaDayStartIso("2026-07-02")).toBe("2026-07-02T05:00:00.000Z");
  });

  it("el fin es EXCLUSIVO (inicio del día siguiente), así 'hasta' queda inclusivo", () => {
    expect(bogotaDayEndIso("2026-07-02")).toBe("2026-07-03T05:00:00.000Z");
    // Un mensaje de las 23:59 de Bogota del día 2 cae dentro del rango [2, 2].
    const lateNight = Date.parse("2026-07-03T04:59:00Z");
    expect(lateNight).toBeGreaterThanOrEqual(Date.parse(bogotaDayStartIso("2026-07-02")));
    expect(lateNight).toBeLessThan(Date.parse(bogotaDayEndIso("2026-07-02")));
  });
});

describe("summarizeRoas", () => {
  const agent = (
    id: string,
    costPerChat: number | null,
    currency = "COP",
  ): AgentCostConfig => ({ id, name: `Agente ${id}`, brand: null, costPerChat, currency });

  const chat = (agentId: string | null, isChat = true, createdAt = "2026-07-02T15:00:00Z"): ChatFact => ({
    agentId,
    createdAt,
    isChat,
  });

  const order = (
    agentId: string | null,
    total: number,
    status: OrderFact["status"] = "confirmed",
  ): RoasOrderFact => ({ agentId, status, total, createdAt: "2026-07-02T15:00:00Z" });

  it("calcula el retorno con el ejemplo de Colombia: 1.000 por chat", () => {
    const r = summarizeRoas(
      [agent("a", 1000)],
      [chat("a"), chat("a"), chat("a"), chat("a"), chat("a")],
      [order("a", 120_000), order("a", 80_000)],
    );
    const row = r.rows[0];
    expect(row.chats).toBe(5);
    expect(row.investment).toBe(5000);
    expect(row.revenue).toBe(200_000);
    expect(row.roas).toBe(40);
    expect(row.costPerOrder).toBe(2500);
    expect(row.profit).toBe(195_000);
    expect(r.configured).toBe(true);
  });

  it("no cobra las conversaciones donde el cliente nunca escribió", () => {
    const r = summarizeRoas([agent("a", 1000)], [chat("a"), chat("a", false)], []);
    expect(r.rows[0].chats).toBe(1);
    expect(r.rows[0].investment).toBe(1000);
  });

  it("las canceladas no suman ventas, y ROAS confirmado solo cuenta lo confirmado", () => {
    const r = summarizeRoas(
      [agent("a", 100)],
      [chat("a"), chat("a")],
      [
        order("a", 1000, "confirmed"),
        order("a", 500, "pending_handoff"),
        order("a", 9999, "cancelled"),
      ],
    );
    expect(r.rows[0].orders).toBe(2);
    expect(r.rows[0].revenue).toBe(1500);
    expect(r.rows[0].confirmedRevenue).toBe(1000);
    expect(r.rows[0].roas).toBe(7.5);
    expect(r.rows[0].confirmedRoas).toBe(5);
  });

  it("un agente sin costo configurado aparece, pero sin ROAS inventado", () => {
    const r = summarizeRoas([agent("a", null)], [chat("a")], [order("a", 50_000)]);
    expect(r.rows[0].chats).toBe(1);
    expect(r.rows[0].revenue).toBe(50_000);
    expect(r.rows[0].investment).toBe(0);
    expect(r.rows[0].roas).toBeNull();
    expect(r.configured).toBe(false);
  });

  it("consolida cuando comparten moneda", () => {
    const r = summarizeRoas(
      [agent("a", 1000), agent("b", 500)],
      [chat("a"), chat("b"), chat("b")],
      [order("a", 10_000), order("b", 4_000)],
    );
    expect(r.total).not.toBeNull();
    expect(r.total!.chats).toBe(3);
    expect(r.total!.investment).toBe(2000); // 1×1000 + 2×500
    expect(r.total!.revenue).toBe(14_000);
    expect(r.total!.roas).toBe(7);
    // Costo por chat mezclado (ponderado), no promedio simple de 1000 y 500.
    expect(r.total!.costPerChat).toBeCloseTo(666.67, 1);
  });

  it("NO consolida ni grafica cuando hay monedas distintas", () => {
    const r = summarizeRoas(
      [agent("a", 1000, "COP"), agent("b", 2, "USD")],
      [chat("a"), chat("b")],
      [order("a", 10_000), order("b", 30)],
    );
    expect(r.total).toBeNull();
    expect(r.perDay).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });

  it("ignora chats y órdenes de agentes fuera del alcance", () => {
    const r = summarizeRoas([agent("a", 1000)], [chat("a"), chat("z"), chat(null)], [order("z", 1)]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].chats).toBe(1);
    expect(r.rows[0].revenue).toBe(0);
  });

  it("la serie por día trae 14 días, MÁS RECIENTE primero (como los demás gráficos)", () => {
    const r = summarizeRoas([agent("a", 1000)], [chat("a")], []);
    expect(r.perDay).toHaveLength(14);
    expect(r.perDay[0].date > r.perDay[13].date).toBe(true);
    // Misma orientación que summarizeOrders/summarizeConversationActivity: hoy arriba.
    expect(r.perDay[0].date).toBe(bogotaDayKey(Date.now()));
  });
});

describe("matchesSearch", () => {
  const contact = ["Néstor Cortés", "573001234567", "Bogotá"];

  it("una búsqueda vacía no filtra nada", () => {
    expect(matchesSearch(contact, "")).toBe(true);
    expect(matchesSearch(contact, "   ")).toBe(true);
  });

  it("ignora mayúsculas y acentos en ambos lados", () => {
    expect(matchesSearch(contact, "nestor")).toBe(true);
    expect(matchesSearch(contact, "CORTES")).toBe(true);
    expect(matchesSearch(contact, "bogota")).toBe(true);
  });

  // Regresión: los dígitos de una búsqueda de texto son "", y `"".includes("")`
  // es true — eso hacía que CUALQUIER texto pasara y la lista no filtrara nada.
  it("un texto que no está NO pasa (aunque no tenga dígitos)", () => {
    expect(matchesSearch(contact, "ruby")).toBe(false);
    expect(matchesSearch(contact, "zzz")).toBe(false);
  });

  it("encuentra el teléfono aunque se escriba con separadores", () => {
    expect(matchesSearch(contact, "+57 300-123")).toBe(true);
    expect(matchesSearch(contact, "3001234567")).toBe(true);
    expect(matchesSearch(contact, "573009999999")).toBe(false);
  });

  it("tolera campos nulos", () => {
    expect(matchesSearch([null, undefined, "Cali"], "cali")).toBe(true);
    expect(matchesSearch([null, undefined], "cali")).toBe(false);
  });
});
