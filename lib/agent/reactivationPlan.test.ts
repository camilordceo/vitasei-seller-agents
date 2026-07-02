import { describe, expect, it } from "vitest";
import {
  DORMANT_MS,
  evaluateReactivation,
  planReactivations,
  STALE_MS,
} from "./reactivationPlan";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-20T12:00:00Z");

describe("planReactivations", () => {
  it("agenda etapa 1 y 2 sumando los delays", () => {
    const from = Date.parse("2026-07-01T00:00:00Z");
    const plan = planReactivations(from, 7 * DAY, 15 * DAY);
    expect(plan).toEqual([
      { stage: 1, scheduledAt: "2026-07-08T00:00:00.000Z" },
      { stage: 2, scheduledAt: "2026-07-16T00:00:00.000Z" },
    ]);
  });
});

describe("evaluateReactivation", () => {
  const base = {
    converted: false,
    templateConfigured: true,
    lastInboundAt: new Date(NOW - 10 * DAY).toISOString(), // inactivo hace 10 días
    scheduledAt: new Date(NOW - 60 * 1000).toISOString(), // recién vencida
    now: NOW,
  };

  it("envía cuando cliente inactivo, no compró y hay plantilla", () => {
    expect(evaluateReactivation(base)).toEqual({ action: "send" });
  });

  it("cancela si la persona compró", () => {
    expect(evaluateReactivation({ ...base, converted: true })).toEqual({
      action: "cancel",
      reason: "converted",
    });
  });

  it("salta si no hay plantilla configurada", () => {
    expect(evaluateReactivation({ ...base, templateConfigured: false })).toEqual({
      action: "skip",
      reason: "no-template",
    });
  });

  it("salta si el cliente escribió hace poco (activo)", () => {
    const recent = { ...base, lastInboundAt: new Date(NOW - DORMANT_MS / 2).toISOString() };
    expect(evaluateReactivation(recent)).toEqual({ action: "skip", reason: "recently-active" });
  });

  it("salta si venció hace demasiado (stale)", () => {
    const old = { ...base, scheduledAt: new Date(NOW - STALE_MS - DAY).toISOString() };
    expect(evaluateReactivation(old)).toEqual({ action: "skip", reason: "stale" });
  });

  it("comprar tiene prioridad sobre todo", () => {
    const buyingButActive = {
      ...base,
      converted: true,
      lastInboundAt: new Date(NOW - 60 * 1000).toISOString(),
    };
    expect(evaluateReactivation(buyingButActive)).toEqual({ action: "cancel", reason: "converted" });
  });
});
