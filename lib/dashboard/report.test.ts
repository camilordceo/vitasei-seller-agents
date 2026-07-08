import { describe, expect, it } from "vitest";
import {
  bogotaDayKey,
  summarizeConversationActivity,
  summarizeOrders,
  type ConversationActivityFact,
  type OrderFact,
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
});

describe("summarizeConversationActivity", () => {
  // Actividad = un inbound del cliente. Distintas conversaciones: A, B, C, D.
  const facts: ConversationActivityFact[] = [
    // A: activa HOY (dos mensajes → debe contar una vez) y hace 3 días. Convirtió.
    { conversationId: "A", createdAt: "2026-07-02T14:00:00Z", converted: true },
    { conversationId: "A", createdAt: "2026-07-02T09:00:00Z", converted: true },
    { conversationId: "A", createdAt: "2026-06-29T10:00:00Z", converted: true },
    // B: activa HOY, no convirtió.
    { conversationId: "B", createdAt: "2026-07-02T09:30:00Z", converted: false },
    // C: activa hace 3 días, convirtió.
    { conversationId: "C", createdAt: "2026-06-29T12:00:00Z", converted: true },
    // D: activa hace 20 días, no convirtió.
    { conversationId: "D", createdAt: "2026-06-12T12:00:00Z", converted: false },
  ];
  // total histórico se pasa aparte (no se deriva de la actividad).
  const c = summarizeConversationActivity(facts, { conversations: 10, converted: 4 }, NOW);

  it("total: histórico inyectado (10 conversaciones, 4 transacciones, 40%)", () => {
    expect(c.total).toEqual({ conversations: 10, transactions: 4, rate: 0.4 });
  });

  it("hoy: A y B distintas (A cuenta una sola vez pese a 2 mensajes)", () => {
    expect(c.today).toEqual({ conversations: 2, transactions: 1, rate: 0.5 });
  });

  it("7 días: A, B, C distintas; A y C convirtieron", () => {
    expect(c.last7.conversations).toBe(3);
    expect(c.last7.transactions).toBe(2);
    expect(c.last7.rate).toBeCloseTo(2 / 3, 5);
  });

  it("30 días incluye las 4 conversaciones", () => {
    expect(c.last30).toEqual({ conversations: 4, transactions: 2, rate: 0.5 });
  });

  it("rate = 0 y ventanas vacías cuando no hay actividad ni total", () => {
    const empty = summarizeConversationActivity([], { conversations: 0, converted: 0 }, NOW);
    expect(empty.total).toEqual({ conversations: 0, transactions: 0, rate: 0 });
    expect(empty.today).toEqual({ conversations: 0, transactions: 0, rate: 0 });
  });

  it("perDay cuenta conversaciones activas distintas por día", () => {
    expect(c.perDay).toHaveLength(14);
    // Hoy: A + B activas; solo A convirtió.
    expect(c.perDay[0]).toEqual({
      date: "2026-07-02",
      conversations: 2,
      transactions: 1,
      rate: 0.5,
    });
    // Hace 3 días: A y C activas, ambas convirtieron.
    expect(c.perDay.find((x) => x.date === "2026-06-29")).toEqual({
      date: "2026-06-29",
      conversations: 2,
      transactions: 2,
      rate: 1,
    });
  });
});
