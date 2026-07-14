import { describe, expect, it } from "vitest";
import {
  formatHotmartContext,
  hasRecoveryTag,
  prependHotmartContext,
  HOTMART_RECOVERY_TAG,
} from "./context";

describe("hasRecoveryTag", () => {
  it("reconoce el tag en el array de tags del outbound", () => {
    expect(hasRecoveryTag([HOTMART_RECOVERY_TAG])).toBe(true);
    expect(hasRecoveryTag(["otro", HOTMART_RECOVERY_TAG])).toBe(true);
  });

  it("es falso para un outbound normal de la IA", () => {
    expect(hasRecoveryTag(["VITA-001"])).toBe(false);
    expect(hasRecoveryTag([])).toBe(false);
  });

  it("tolera jsonb raro (null, string suelto, objeto)", () => {
    expect(hasRecoveryTag(null)).toBe(false);
    expect(hasRecoveryTag(undefined)).toBe(false);
    expect(hasRecoveryTag(HOTMART_RECOVERY_TAG)).toBe(true);
    expect(hasRecoveryTag({ tag: HOTMART_RECOVERY_TAG })).toBe(false);
    expect(hasRecoveryTag([1, 2])).toBe(false);
  });
});

describe("formatHotmartContext", () => {
  it("incluye el curso, su id de Hotmart y el texto EXACTO enviado", () => {
    const block = formatHotmartContext({
      productId: "5312345",
      productName: "Curso de Excel Avanzado",
      sentText: "Hola Camilo, vi que dejaste pendiente el Curso de Excel Avanzado.",
    });
    expect(block).toContain("Curso de Excel Avanzado");
    expect(block).toContain("5312345");
    expect(block).toContain("Hola Camilo, vi que dejaste pendiente");
    // Contexto interno: la IA no debe mencionarlo ni repetir la plantilla.
    expect(block).toContain("no lo menciones");
    expect(block).toContain("No lo repitas");
  });

  it("funciona sin id (solo nombre del curso)", () => {
    const block = formatHotmartContext({
      productId: null,
      productName: "Curso de Excel",
      sentText: "texto",
    });
    expect(block).toContain("Curso de Excel");
    expect(block).not.toContain("id de Hotmart");
  });

  it("funciona sin nombre (solo id)", () => {
    const block = formatHotmartContext({
      productId: "999",
      productName: null,
      sentText: "texto",
    });
    expect(block).toContain("id de Hotmart 999");
  });

  it("omite el bloque del mensaje si no hay texto enviado, pero conserva el curso", () => {
    const block = formatHotmartContext({
      productId: "999",
      productName: "Curso X",
      sentText: "",
    });
    expect(block).toContain("Curso X");
    expect(block).not.toContain("ya le enviaste");
  });

  it("devuelve cadena vacía si no hay nada que aportar", () => {
    expect(formatHotmartContext({ productId: null, productName: null, sentText: "" })).toBe("");
    expect(formatHotmartContext({ productId: " ", productName: " ", sentText: "  " })).toBe("");
  });
});

describe("prependHotmartContext", () => {
  it("antepone el bloque al turno del cliente", () => {
    const out = prependHotmartContext("¿cuánto vale?", "[Contexto]");
    expect(out).toBe("[Contexto]\n\n¿cuánto vale?");
  });

  it("sin bloque, devuelve el texto tal cual", () => {
    expect(prependHotmartContext("¿cuánto vale?", "")).toBe("¿cuánto vale?");
  });

  it("con turno vacío (solo imagen), devuelve solo el bloque", () => {
    expect(prependHotmartContext("   ", "[Contexto]")).toBe("[Contexto]");
  });
});
