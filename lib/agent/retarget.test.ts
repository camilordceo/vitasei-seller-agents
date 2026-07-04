import { describe, expect, it } from "vitest";
import {
  buildRetargetInstruction,
  evaluateRetarget,
  planRetargets,
} from "./retargetPlan";

const NOW = Date.parse("2026-06-30T12:00:00Z");
const ANCHOR = "2026-06-30T11:30:00Z"; // último inbound: 30 min antes

describe("planRetargets", () => {
  it("agenda dos etapas con los delays dados", () => {
    const from = Date.parse("2026-06-30T12:00:00Z");
    const plan = planRetargets(from, 60 * 60 * 1000, 8 * 60 * 60 * 1000);
    expect(plan).toEqual([
      { stage: 1, scheduledAt: "2026-06-30T13:00:00.000Z" },
      { stage: 2, scheduledAt: "2026-06-30T20:00:00.000Z" },
    ]);
  });
});

describe("evaluateRetarget", () => {
  const base = {
    status: "active",
    aiPaused: false,
    lastInboundAt: ANCHOR,
    anchorInboundAt: ANCHOR,
    previousResponseId: "resp_123",
    now: NOW,
  };

  it("envía cuando la conversación sigue activa y el cliente no respondió", () => {
    expect(evaluateRetarget(base)).toEqual({ action: "send" });
  });

  it("cancela si la conversación ya tiene compra (orden no cancelada)", () => {
    expect(evaluateRetarget({ ...base, hasOrder: true })).toEqual({
      action: "cancel",
      reason: "purchased",
    });
  });

  it("la guarda de compra manda: cancela aunque todo lo demás diga 'send'", () => {
    // `base` es un caso de "send"; con compra debe cancelar igual.
    expect(evaluateRetarget(base)).toEqual({ action: "send" });
    expect(evaluateRetarget({ ...base, hasOrder: true }).action).toBe("cancel");
  });

  it("cancela si la conversación ya no está activa (handoff/cerrada)", () => {
    expect(evaluateRetarget({ ...base, status: "handed_off" })).toEqual({
      action: "cancel",
      reason: "conversation-handed_off",
    });
  });

  it("cancela si la conversación está en modo manual (humano al mando)", () => {
    expect(evaluateRetarget({ ...base, aiPaused: true })).toEqual({
      action: "cancel",
      reason: "manual-mode",
    });
  });

  it("cancela si el cliente respondió después de agendar (ancla cambió)", () => {
    expect(
      evaluateRetarget({ ...base, lastInboundAt: "2026-06-30T11:45:00Z" }),
    ).toEqual({ action: "cancel", reason: "client-replied" });
  });

  it("cancela si no hay previous_response_id que encadenar", () => {
    expect(evaluateRetarget({ ...base, previousResponseId: null })).toEqual({
      action: "cancel",
      reason: "no-context",
    });
  });

  it("salta (skip) si el último inbound fue hace > 24h (fuera de ventana)", () => {
    const old = "2026-06-29T11:00:00Z"; // 25h antes de NOW
    expect(
      evaluateRetarget({ ...base, lastInboundAt: old, anchorInboundAt: old }),
    ).toEqual({ action: "skip", reason: "out-of-window" });
  });
});

describe("buildRetargetInstruction", () => {
  it("nunca revela que es automático y distingue la etapa", () => {
    const s1 = buildRetargetInstruction(1);
    const s2 = buildRetargetInstruction(2);
    expect(s1).toContain("NO LA REVELES");
    expect(s1).toContain("una hora");
    expect(s2).toContain("varias horas");
    // No debe pedir tags de flujo en un seguimiento.
    expect(s1).toContain("No incluyas tags de flujo");
  });
});
