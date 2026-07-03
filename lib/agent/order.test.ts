import { describe, expect, it } from "vitest";
import {
  buildSaleNotification,
  buildTranscript,
  computeOrderTotal,
  normalizeOrderItem,
  normalizeQty,
  resolveFulfillmentMethod,
} from "./order";
import type { OrderDraft } from "@/lib/openai/extractOrder";

describe("buildTranscript", () => {
  it("etiqueta Cliente/Asesor y omite vacíos", () => {
    const t = buildTranscript([
      { direction: "inbound", content: "Quiero el colágeno" },
      { direction: "outbound", content: "  Claro, ideal para ti  " },
      { direction: "outbound", content: "" },
      { direction: "inbound", content: null },
    ]);
    expect(t).toBe("Cliente: Quiero el colágeno\nAsesor: Claro, ideal para ti");
  });
});

describe("computeOrderTotal", () => {
  it("suma qty * unit_price de los ítems con precio", () => {
    expect(
      computeOrderTotal([
        { qty: 2, unit_price: 50000 },
        { qty: 1, unit_price: 30000 },
      ]),
    ).toBe(130000);
  });

  it("null si ningún ítem tiene precio", () => {
    expect(computeOrderTotal([{ qty: 3, unit_price: null }])).toBeNull();
  });
});

describe("normalizeQty", () => {
  it("fuerza entero >= 1", () => {
    expect(normalizeQty(0)).toBe(1);
    expect(normalizeQty(-5)).toBe(1);
    expect(normalizeQty(2.9)).toBe(2);
    expect(normalizeQty(NaN)).toBe(1);
  });
});

describe("resolveFulfillmentMethod", () => {
  it("prioriza el método de la conversación", () => {
    expect(resolveFulfillmentMethod("cod", "addi")).toBe("cod");
    expect(resolveFulfillmentMethod("addi", null)).toBe("addi");
  });

  it("cae al draft si la conversación está undecided", () => {
    expect(resolveFulfillmentMethod("undecided", "cod")).toBe("cod");
    expect(resolveFulfillmentMethod("undecided", "loquesea")).toBe("undecided");
    expect(resolveFulfillmentMethod("undecided", null)).toBe("undecided");
  });
});

describe("normalizeOrderItem", () => {
  it("sku no nulo y qty válida", () => {
    expect(normalizeOrderItem({ sku: " VITA-001 ", name: "Colágeno", qty: 0, unit_price: 89000 }))
      .toEqual({ sku: "VITA-001", name: "Colágeno", qty: 1, unit_price: 89000 });
    expect(normalizeOrderItem({ sku: null, name: null, qty: 3, unit_price: null }))
      .toEqual({ sku: "", name: null, qty: 3, unit_price: null });
  });
});

describe("buildSaleNotification", () => {
  const draft: OrderDraft = {
    items: [
      { sku: "#ID123", name: "Colágeno", qty: 2, unit_price: 89000 },
      { sku: null, name: "Envío", qty: 1, unit_price: null },
    ],
    shipping: { name: "Ana Pérez", address: "Cra 1 #2-3", city: "Bogotá", phone: "573001112233" },
    fulfillment_method: "cod",
    notes: "Entregar en la tarde",
    total: 178000,
  };

  it("incluye cliente, método, total, productos y envío", () => {
    const msg = buildSaleNotification({
      clientPhone: "573001112233",
      method: "cod",
      total: 178000,
      draft,
    });
    expect(msg).toContain("+573001112233");
    expect(msg).toContain("Ana Pérez");
    expect(msg).toContain("Contra entrega");
    expect(msg).toContain("2x Colágeno #ID123");
    expect(msg).toContain("Cra 1 #2-3, Bogotá");
    expect(msg).toContain("Entregar en la tarde");
    // El total se formatea como COP (contiene los dígitos, sin importar separadores).
    expect(msg.replace(/\D/g, "")).toContain("178000");
  });

  it("sin total ni envío no rompe", () => {
    const msg = buildSaleNotification({
      clientPhone: "573009998877",
      method: "undecided",
      total: null,
      draft: {
        items: [],
        shipping: { name: null, address: null, city: null, phone: null },
        fulfillment_method: null,
        notes: null,
        total: null,
      },
    });
    expect(msg).toContain("+573009998877");
    expect(msg).toContain("por confirmar");
    expect(msg).toContain("Sin definir");
  });
});
