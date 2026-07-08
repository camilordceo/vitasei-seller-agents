import { describe, expect, it } from "vitest";
import {
  bogotaDayKey,
  bogotaWeekdayHour,
  summarizeConversationActivity,
  summarizeOrders,
  summarizeProductConversion,
  type ConversationActivityFact,
  type OrderFact,
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
    { productCategory: "magnesio", converted: true },
    { productCategory: "magnesio", converted: false },
    { productCategory: "colageno", converted: true },
    { productCategory: null, converted: false },
    { productCategory: "  ", converted: true }, // vacío → Sin categoría (null)
  ]);

  it("agrupa por producto y calcula conversión", () => {
    expect(rows.find((x) => x.category === "magnesio")).toEqual({
      category: "magnesio",
      conversations: 2,
      transactions: 1,
      rate: 0.5,
    });
    expect(rows.find((x) => x.category === "colageno")).toEqual({
      category: "colageno",
      conversations: 1,
      transactions: 1,
      rate: 1,
    });
  });

  it("agrupa null + vacío como 'Sin categoría' y lo deja al final", () => {
    const none = rows.find((x) => x.category === null);
    expect(none).toEqual({ category: null, conversations: 2, transactions: 1, rate: 0.5 });
    expect(rows[rows.length - 1].category).toBe(null);
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
