import { describe, expect, it } from "vitest";
import {
  convertMoney,
  normalizeCurrency,
  rateNote,
  roundForCurrency,
  sumConverted,
  USD_RATES,
} from "./currency";

describe("normalizeCurrency", () => {
  it("acepta minúsculas y espacios", () => {
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("mxn")).toBe("MXN");
  });

  it("cae al default cuando no hay dato o la moneda no tiene tasa", () => {
    expect(normalizeCurrency(null)).toBe("COP");
    expect(normalizeCurrency("")).toBe("COP");
    expect(normalizeCurrency("EUR")).toBe("COP");
    expect(normalizeCurrency("EUR", "USD")).toBe("USD");
  });
});

describe("convertMoney", () => {
  it("no toca el monto cuando la moneda es la misma", () => {
    expect(convertMoney(1234.56, "COP", "COP")).toBe(1234.56);
  });

  it("aplica las tasas pedidas: 3.500 COP y 20 MXN por dólar", () => {
    expect(convertMoney(1, "USD", "COP")).toBe(3500);
    expect(convertMoney(1, "USD", "MXN")).toBe(20);
    expect(convertMoney(3500, "COP", "USD")).toBe(1);
    expect(convertMoney(20, "MXN", "USD")).toBe(1);
  });

  it("deriva MXN↔COP vía USD: 1 MXN = 175 COP", () => {
    expect(convertMoney(1, "MXN", "COP")).toBe(175);
    expect(convertMoney(175, "COP", "MXN")).toBe(1);
  });

  it("es reversible (ida y vuelta devuelve el original)", () => {
    const ida = convertMoney(89_900, "COP", "MXN")!;
    expect(convertMoney(ida, "MXN", "COP")).toBeCloseTo(89_900, 6);
  });

  it("devuelve null cuando alguna moneda no tiene tasa", () => {
    expect(convertMoney(100, "EUR", "COP")).toBeNull();
    expect(convertMoney(100, "COP", "EUR")).toBeNull();
    expect(convertMoney(100, null, "COP")).toBeNull();
  });

  it("devuelve null con montos que no son número (no los cuenta como 0)", () => {
    expect(convertMoney(null, "COP", "USD")).toBeNull();
    expect(convertMoney(undefined, "COP", "USD")).toBeNull();
    expect(convertMoney(Number.NaN, "COP", "USD")).toBeNull();
  });

  it("convierte 0 sin confundirlo con 'sin dato'", () => {
    expect(convertMoney(0, "COP", "USD")).toBe(0);
  });

  it("las tasas son consistentes entre sí (COP/MXN = 175)", () => {
    expect(USD_RATES.COP / USD_RATES.MXN).toBe(175);
  });
});

describe("roundForCurrency", () => {
  it("COP va entero y las demás a dos decimales", () => {
    expect(roundForCurrency(1234.6, "COP")).toBe(1235);
    expect(roundForCurrency(12.345, "USD")).toBe(12.35);
    expect(roundForCurrency(12.344, "MXN")).toBe(12.34);
  });
});

describe("sumConverted", () => {
  it("homologa monedas distintas a la destino antes de sumar", () => {
    // 1 USD (=3.500 COP) + 20 MXN (=3.500 COP) + 1.000 COP = 8.000 COP
    const r = sumConverted(
      [
        { amount: 1, currency: "USD" },
        { amount: 20, currency: "MXN" },
        { amount: 1000, currency: "COP" },
      ],
      "COP",
    );
    expect(r.total).toBe(8000);
    expect(r.counted).toBe(3);
    expect(r.converted).toBe(true);
    expect(r.excluded).toBe(0);
  });

  it("no marca 'converted' cuando todo ya venía en la moneda destino", () => {
    const r = sumConverted(
      [
        { amount: 50_000, currency: "COP" },
        { amount: 30_000, currency: "COP" },
      ],
      "COP",
    );
    expect(r.total).toBe(80_000);
    expect(r.converted).toBe(false);
  });

  it("excluye (y cuenta) lo que no tiene tasa en vez de sumarlo como si nada", () => {
    const r = sumConverted(
      [
        { amount: 100, currency: "USD" },
        { amount: 999, currency: "EUR" },
      ],
      "USD",
    );
    expect(r.total).toBe(100); // el EUR NO se coló
    expect(r.counted).toBe(1);
    expect(r.excluded).toBe(1);
  });

  it("las órdenes sin monto no suman ni cuentan como excluidas", () => {
    const r = sumConverted(
      [
        { amount: null, currency: "COP" },
        { amount: 5000, currency: "COP" },
      ],
      "COP",
    );
    expect(r.total).toBe(5000);
    expect(r.counted).toBe(1);
    expect(r.excluded).toBe(0);
  });

  it("redondea una sola vez al final (no arrastra el error por fila)", () => {
    // 3 × 10 COP → 0,00857… USD c/u. Redondeando por fila daría 0,03; al final, 0,01.
    const r = sumConverted(
      [
        { amount: 10, currency: "COP" },
        { amount: 10, currency: "COP" },
        { amount: 10, currency: "COP" },
      ],
      "USD",
    );
    expect(r.total).toBe(0.01);
  });

  it("una lista vacía da cero sin inventar exclusiones", () => {
    expect(sumConverted([], "MXN")).toEqual({
      total: 0,
      counted: 0,
      converted: false,
      excluded: 0,
    });
  });
});

describe("rateNote", () => {
  it("enuncia la tasa desde la moneda grande para no mostrar 0,0002", () => {
    expect(rateNote("COP")).toContain("1 USD = 3.500 COP");
    expect(rateNote("COP")).toContain("1 MXN = 175 COP");
    expect(rateNote("USD")).toContain("1 USD = 3.500 COP");
    expect(rateNote("USD")).toContain("1 USD = 20 MXN");
  });
});
