import { describe, expect, it } from "vitest";
import {
  buildPaypalMessage,
  DEFAULT_PAYPAL_MESSAGE,
  parseDecimal,
  parsePaypalConfig,
  readPaypalEditorFields,
} from "./config";

describe("parseDecimal", () => {
  it("acepta números, strings con símbolos y coma decimal", () => {
    expect(parseDecimal(7.25)).toBe(7.25);
    expect(parseDecimal("7.25")).toBe(7.25);
    expect(parseDecimal("7,25")).toBe(7.25);
    expect(parseDecimal("$ 5.99")).toBe(5.99);
    expect(parseDecimal("8 %")).toBe(8);
  });

  it("colapsa a 0 lo inválido o negativo", () => {
    expect(parseDecimal("")).toBe(0);
    expect(parseDecimal("abc")).toBe(0);
    expect(parseDecimal(-3)).toBe(0);
    expect(parseDecimal(null)).toBe(0);
    expect(parseDecimal(NaN)).toBe(0);
  });
});

describe("parsePaypalConfig", () => {
  it("devuelve null sin credenciales completas (feature apagado)", () => {
    expect(parsePaypalConfig(null)).toBeNull();
    expect(parsePaypalConfig({})).toBeNull();
    expect(parsePaypalConfig({ client_id: "abc" })).toBeNull();
    expect(parsePaypalConfig({ client_secret: "xyz" })).toBeNull();
    expect(parsePaypalConfig([])).toBeNull();
    expect(parsePaypalConfig("texto")).toBeNull();
  });

  it("normaliza la config completa con defaults", () => {
    const cfg = parsePaypalConfig({ client_id: " abc ", client_secret: " xyz " });
    expect(cfg).not.toBeNull();
    expect(cfg!.clientId).toBe("abc");
    expect(cfg!.clientSecret).toBe("xyz");
    expect(cfg!.sandbox).toBe(false);
    expect(cfg!.message).toBe(DEFAULT_PAYPAL_MESSAGE);
    expect(cfg!.taxPercent).toBe(0);
    expect(cfg!.shippingAmount).toBe(0);
  });

  it("lee sandbox, mensaje, tax y shipping; el tax se topa en 100", () => {
    const cfg = parsePaypalConfig({
      client_id: "abc",
      client_secret: "xyz",
      sandbox: true,
      message: "Paga aquí: {link}",
      tax_percent: "7.25",
      shipping: "5.99",
    });
    expect(cfg!.sandbox).toBe(true);
    expect(cfg!.message).toBe("Paga aquí: {link}");
    expect(cfg!.taxPercent).toBe(7.25);
    expect(cfg!.shippingAmount).toBe(5.99);
    expect(parsePaypalConfig({ client_id: "a", client_secret: "b", tax_percent: 250 })!.taxPercent).toBe(100);
  });
});

describe("buildPaypalMessage", () => {
  it("reemplaza {link} (todas las veces)", () => {
    expect(buildPaypalMessage("Paga: {link} — otra vez {link}", "https://x.co")).toBe(
      "Paga: https://x.co — otra vez https://x.co",
    );
  });

  it("sin placeholder, anexa el link al final", () => {
    expect(buildPaypalMessage("Tu link de pago:", "https://x.co")).toBe(
      "Tu link de pago:\n\nhttps://x.co",
    );
  });

  it("mensaje vacío → usa el default (que trae {link})", () => {
    const out = buildPaypalMessage("", "https://x.co");
    expect(out).toContain("https://x.co");
    expect(out).not.toContain("{link}");
  });
});

describe("readPaypalEditorFields", () => {
  it("expone lo crudo sin el secreto (solo hasPaypalSecret)", () => {
    const f = readPaypalEditorFields({
      client_id: "abc",
      client_secret: "xyz",
      sandbox: true,
      tax_percent: 7.25,
      shipping: "5.99",
      message: "hola {link}",
    });
    expect(f.paypalClientId).toBe("abc");
    expect(f.hasPaypalSecret).toBe(true);
    expect(f).not.toHaveProperty("clientSecret");
    expect(f.paypalSandbox).toBe(true);
    expect(f.paypalTaxPercent).toBe("7.25");
    expect(f.paypalShipping).toBe("5.99");
    expect(f.paypalMessage).toBe("hola {link}");
  });

  it("config ausente o incompleta → campos vacíos (no pierde lo escrito)", () => {
    const f = readPaypalEditorFields(null);
    expect(f.paypalClientId).toBe("");
    expect(f.hasPaypalSecret).toBe(false);
    expect(f.paypalSandbox).toBe(false);
    expect(f.paypalTaxPercent).toBe("");
    expect(f.paypalShipping).toBe("");
    expect(f.paypalMessage).toBe("");
    // Incompleta (solo client_id): el editor la muestra igual.
    expect(readPaypalEditorFields({ client_id: "abc" }).paypalClientId).toBe("abc");
  });
});
