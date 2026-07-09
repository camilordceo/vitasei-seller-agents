import { describe, expect, it } from "vitest";
import { appendHotmartMarker, HOTMART_FLOW_MARKER } from "./flow";

describe("appendHotmartMarker", () => {
  it("no toca el texto si el flujo no está activo", () => {
    expect(appendHotmartMarker("hola", false)).toBe("hola");
  });

  it("anexa la marca en una línea aparte cuando está activo", () => {
    expect(appendHotmartMarker("¿tienen envío?", true)).toBe(
      `¿tienen envío?\n\n${HOTMART_FLOW_MARKER}`,
    );
  });

  it("es idempotente: no duplica la marca si el texto ya la tiene al final", () => {
    const once = appendHotmartMarker("hola", true);
    expect(appendHotmartMarker(once, true)).toBe(once);
  });

  it("devuelve solo la marca si el texto viene vacío (turno de solo imagen)", () => {
    expect(appendHotmartMarker("", true)).toBe(HOTMART_FLOW_MARKER);
    expect(appendHotmartMarker("   ", true)).toBe(HOTMART_FLOW_MARKER);
  });
});
