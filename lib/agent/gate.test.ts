import { describe, expect, it } from "vitest";
import { applyGate, isWithinWindow } from "./gate";

const NOW = Date.parse("2026-06-30T12:00:00Z");

describe("applyGate", () => {
  it("separa SKUs válidos de los inventados", () => {
    const r = applyGate(
      ["VITA-001", "VITA-999", "VITA-002"],
      ["VITA-001", "VITA-002"],
      "2026-06-30T11:59:00Z",
      NOW,
    );
    expect(r.validSkus).toEqual(["VITA-001", "VITA-002"]);
    expect(r.blockedSkus).toEqual(["VITA-999"]); // no existe → gate_blocked
  });

  it("acepta un Set como knownSkus", () => {
    const r = applyGate(["A"], new Set(["A", "B"]), null, NOW);
    expect(r.validSkus).toEqual(["A"]);
    expect(r.blockedSkus).toEqual([]);
  });

  it("sin SKUs no bloquea nada", () => {
    const r = applyGate([], ["A"], "2026-06-30T11:59:00Z", NOW);
    expect(r.validSkus).toEqual([]);
    expect(r.blockedSkus).toEqual([]);
  });

  it("marca fuera de ventana si el inbound fue hace > 24h", () => {
    const r = applyGate(["A"], ["A"], "2026-06-29T11:00:00Z", NOW); // 25h antes
    expect(r.withinWindow).toBe(false);
  });
});

describe("isWithinWindow", () => {
  it("dentro de 24h → true", () => {
    expect(isWithinWindow("2026-06-30T11:00:00Z", NOW)).toBe(true); // 1h
    expect(isWithinWindow("2026-06-29T12:00:00Z", NOW)).toBe(true); // justo 24h
  });

  it("más de 24h → false", () => {
    expect(isWithinWindow("2026-06-29T11:59:00Z", NOW)).toBe(false);
  });

  it("null o fecha inválida → true (best-effort)", () => {
    expect(isWithinWindow(null, NOW)).toBe(true);
    expect(isWithinWindow("no-es-fecha", NOW)).toBe(true);
  });
});
