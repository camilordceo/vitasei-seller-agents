import { describe, expect, it } from "vitest";
import { buildInvoicePayload, moneyValue, percentValue } from "./invoice";

const base = {
  brand: "Vitasei USA",
  currency: "usd",
  orderTotal: null as number | null,
  taxPercent: 0,
  shippingAmount: 0,
  reference: "orden-123",
};

describe("moneyValue / percentValue", () => {
  it("montos con 2 decimales y porcentajes sin ceros colgantes", () => {
    expect(moneyValue(25)).toBe("25.00");
    expect(moneyValue(25.1 * 3)).toBe("75.30"); // sin ruido de coma flotante
    expect(percentValue(7.25)).toBe("7.25");
    expect(percentValue(8)).toBe("8");
  });
});

describe("buildInvoicePayload", () => {
  it("mapea los ítems con precio (qty como string, USD en mayúsculas)", () => {
    const p = buildInvoicePayload({
      ...base,
      items: [
        { name: "Colágeno", qty: 2, unit_price: 29.99 },
        { name: null, qty: 1, unit_price: 10 }, // sin nombre → "Producto"
        { name: "Sin precio", qty: 1, unit_price: null }, // se omite
      ],
    })!;
    const items = p.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: "Colágeno",
      quantity: "2",
      unit_amount: { currency_code: "USD", value: "29.99" },
    });
    expect(items[0]).not.toHaveProperty("tax");
    expect(items[1].name).toBe("Producto");
    const detail = p.detail as Record<string, unknown>;
    expect(detail.currency_code).toBe("USD");
    expect(detail.reference).toBe("orden-123");
  });

  it("agrega tax por ítem y shipping en el breakdown cuando están configurados", () => {
    const p = buildInvoicePayload({
      ...base,
      items: [{ name: "Magnesio", qty: 1, unit_price: 25 }],
      taxPercent: 7.25,
      shippingAmount: 5.99,
    })!;
    const items = p.items as Array<Record<string, unknown>>;
    expect(items[0].tax).toEqual({ name: "Tax", percent: "7.25" });
    expect(p.amount).toEqual({
      breakdown: {
        shipping: { amount: { currency_code: "USD", value: "5.99" } },
      },
    });
  });

  it("sin ítems con precio pero con total → un solo ítem por el total", () => {
    const p = buildInvoicePayload({
      ...base,
      items: [{ name: "X", qty: 1, unit_price: null }],
      orderTotal: 49.9,
    })!;
    const items = p.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Pedido Vitasei USA",
      quantity: "1",
      unit_amount: { currency_code: "USD", value: "49.90" },
    });
  });

  it("sin ningún monto cobrable → null (sin monto no hay link)", () => {
    expect(buildInvoicePayload({ ...base, items: [] })).toBeNull();
    expect(
      buildInvoicePayload({ ...base, items: [{ name: "X", qty: 1, unit_price: null }] }),
    ).toBeNull();
    expect(buildInvoicePayload({ ...base, items: [], orderTotal: 0 })).toBeNull();
  });

  it("sin shipping no manda amount (PayPal calcula solo con los ítems)", () => {
    const p = buildInvoicePayload({ ...base, items: [{ name: "X", qty: 1, unit_price: 10 }] })!;
    expect(p).not.toHaveProperty("amount");
  });
});
