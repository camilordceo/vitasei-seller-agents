import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENT_METHODS,
  matchPaymentMethod,
  methodLabelMap,
  normalizePaymentTag,
  parsePaymentMethods,
  slugMethod,
} from "./paymentMethods";

describe("normalizePaymentTag", () => {
  it("agrega el # inicial, baja a minúsculas y quita acentos/espacios", () => {
    expect(normalizePaymentTag("Zelle")).toBe("#zelle");
    expect(normalizePaymentTag("#Contra Entrega")).toBe("#contra-entrega");
    expect(normalizePaymentTag("  #ADDI  ")).toBe("#addi");
    expect(normalizePaymentTag("#compra-contra-entrega")).toBe("#compra-contra-entrega");
  });

  it("devuelve '' para valores vacíos o no-string", () => {
    expect(normalizePaymentTag("#")).toBe("");
    expect(normalizePaymentTag("")).toBe("");
    expect(normalizePaymentTag(null)).toBe("");
    expect(normalizePaymentTag(42)).toBe("");
  });
});

describe("slugMethod", () => {
  it("deriva la clave del tag sin #", () => {
    expect(slugMethod("#zelle")).toBe("zelle");
    expect(slugMethod("#compra-contra-entrega")).toBe("compra-contra-entrega");
  });
});

describe("parsePaymentMethods", () => {
  it("normaliza, deriva method del tag y deduplica por tag y por método", () => {
    const parsed = parsePaymentMethods([
      { tag: "Zelle", label: "Zelle" },
      { tag: "#zelle", label: "Otro" }, // tag duplicado → se ignora
      { tag: "#nequi" }, // sin label → label por defecto "Nequi"; method "nequi"
    ]);
    expect(parsed).toEqual([
      { tag: "#zelle", label: "Zelle", method: "zelle" },
      { tag: "#nequi", label: "Nequi", method: "nequi" },
    ]);
  });

  it("respeta la clave method explícita (para conservar el histórico CO cod/addi)", () => {
    const parsed = parsePaymentMethods(DEFAULT_PAYMENT_METHODS);
    expect(parsed).toEqual(DEFAULT_PAYMENT_METHODS);
  });

  it("descarta 'undecided' como método (reservado) y entradas inválidas", () => {
    const parsed = parsePaymentMethods([
      { tag: "#x", method: "undecided" },
      "basura",
      null,
      { label: "sin tag" },
    ]);
    expect(parsed).toEqual([]);
  });

  it("no lanza con entradas no-array", () => {
    expect(parsePaymentMethods(null)).toEqual([]);
    expect(parsePaymentMethods("x")).toEqual([]);
  });
});

describe("matchPaymentMethod", () => {
  it("matchea sin distinguir mayúsculas y devuelve el método", () => {
    expect(matchPaymentMethod("#zelle", DEFAULT_PAYMENT_METHODS)).toBeNull();
    expect(matchPaymentMethod("#ADDI", DEFAULT_PAYMENT_METHODS)?.method).toBe("addi");
    expect(matchPaymentMethod("hola", DEFAULT_PAYMENT_METHODS)).toBeNull();
  });
});

describe("methodLabelMap", () => {
  it("construye method → label", () => {
    expect(methodLabelMap(DEFAULT_PAYMENT_METHODS)).toEqual({
      cod: "Contra entrega",
      addi: "Addi",
    });
  });
});
