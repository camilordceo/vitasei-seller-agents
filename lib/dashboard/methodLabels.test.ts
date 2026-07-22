import { describe, expect, it } from "vitest";
import {
  buildMethodLabels,
  humanizeMethod,
  methodLabel,
  methodOptionsFor,
} from "./methodLabels";
import { DEFAULT_PAYMENT_METHODS } from "@/lib/agent/paymentMethods";

const LINK = { tag: "#link-de-pago", label: "Link de Pago", method: "link-de-pago" };

describe("humanizeMethod", () => {
  it("vuelve legible una clave sin etiqueta", () => {
    expect(humanizeMethod("link-de-pago")).toBe("Link de pago");
    expect(humanizeMethod("zelle")).toBe("Zelle");
    expect(humanizeMethod("")).toBe("Sin definir");
  });
});

describe("methodLabel", () => {
  it("usa la etiqueta del agente por encima de todo", () => {
    expect(methodLabel("cod", { cod: "Pago al recibir" })).toBe("Pago al recibir");
  });

  it("cae a las claves históricas y al nombre derivado", () => {
    expect(methodLabel("cod")).toBe("Contra entrega");
    expect(methodLabel("link-de-pago")).toBe("Link de pago");
  });

  it("un método sin definir NO se confunde con uno real", () => {
    expect(methodLabel(null)).toBe("Sin definir");
    // Antes cualquier método desconocido caía a "Sin definir": una venta por Zelle
    // se leía como si el cliente no hubiera elegido nada.
    expect(methodLabel("zelle")).toBe("Zelle");
  });
});

describe("buildMethodLabels", () => {
  it("junta los métodos de varios agentes sobre los históricos", () => {
    const labels = buildMethodLabels([
      { paymentMethods: [...DEFAULT_PAYMENT_METHODS, LINK] },
      { paymentMethods: [{ tag: "#zelle", label: "Zelle", method: "zelle" }] },
    ]);
    expect(labels["link-de-pago"]).toBe("Link de Pago");
    expect(labels.zelle).toBe("Zelle");
    expect(labels.cod).toBe("Contra entrega");
    expect(labels.undecided).toBe("Sin definir");
  });

  it("la etiqueta del agente pisa la histórica", () => {
    const labels = buildMethodLabels([
      { paymentMethods: [{ tag: "#cod", label: "Pago al recibir", method: "cod" }] },
    ]);
    expect(labels.cod).toBe("Pago al recibir");
  });
});

describe("methodOptionsFor", () => {
  it("ofrece los métodos del agente + Sin definir", () => {
    const opts = methodOptionsFor([...DEFAULT_PAYMENT_METHODS, LINK], "cod");
    expect(opts.map((o) => o.value)).toEqual(["cod", "addi", "link-de-pago", "undecided"]);
    expect(opts.find((o) => o.value === "link-de-pago")?.label).toBe("Link de Pago");
  });

  it("conserva el método actual aunque ya no esté configurado", () => {
    const opts = methodOptionsFor([LINK], "zelle");
    expect(opts.map((o) => o.value)).toEqual(["link-de-pago", "undecided", "zelle"]);
    expect(opts.at(-1)?.label).toBe("Zelle");
  });

  it("sin agente cae a las claves históricas", () => {
    expect(methodOptionsFor([], "undecided").map((o) => o.value)).toEqual([
      "cod",
      "addi",
      "undecided",
    ]);
  });
});
