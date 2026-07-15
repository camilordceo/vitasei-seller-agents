import { describe, expect, it } from "vitest";
import {
  buildRetargetInstruction,
  DEFAULT_RETARGET_GUIDANCE,
  describeElapsed,
  evaluateRetarget,
  MAX_RETARGET_STAGES,
  parseRetargetConfig,
  planRetargets,
} from "./retargetPlan";

const NOW = Date.parse("2026-06-30T12:00:00Z");
const ANCHOR = "2026-06-30T11:30:00Z"; // último inbound: 30 min antes

describe("parseRetargetConfig", () => {
  it("normaliza, ordena por tiempo y trimea la guía", () => {
    expect(
      parseRetargetConfig([
        { delayMinutes: 480, guidance: "  cierra hoy  " },
        { delayMinutes: 60, guidance: "" },
      ]),
    ).toEqual([
      { delayMinutes: 60, guidance: null },
      { delayMinutes: 480, guidance: "cierra hoy" },
    ]);
  });

  it("descarta entradas inválidas (no-número, <= 0, no-objeto)", () => {
    expect(
      parseRetargetConfig([
        { delayMinutes: 0 },
        { delayMinutes: -5 },
        { delayMinutes: "x" },
        "nope",
        null,
        { delayMinutes: 120, guidance: "ok" },
      ]),
    ).toEqual([{ delayMinutes: 120, guidance: "ok" }]);
  });

  it("elimina delays duplicados (evita dos envíos al mismo tiempo)", () => {
    expect(parseRetargetConfig([{ delayMinutes: 60 }, { delayMinutes: 60 }])).toEqual([
      { delayMinutes: 60, guidance: null },
    ]);
  });

  it("recorta a MAX_RETARGET_STAGES etapas", () => {
    const many = Array.from({ length: MAX_RETARGET_STAGES + 3 }, (_, i) => ({
      delayMinutes: (i + 1) * 30,
    }));
    expect(parseRetargetConfig(many)).toHaveLength(MAX_RETARGET_STAGES);
  });

  it("cualquier cosa que no sea array → []", () => {
    expect(parseRetargetConfig(null)).toEqual([]);
    expect(parseRetargetConfig(undefined)).toEqual([]);
    expect(parseRetargetConfig({ delayMinutes: 60 })).toEqual([]);
  });
});

describe("planRetargets", () => {
  it("agenda N etapas dinámicas, ordenadas, con delay y ordinal", () => {
    const from = Date.parse("2026-06-30T12:00:00Z");
    const plan = planRetargets(from, [{ delayMinutes: 480 }, { delayMinutes: 60 }]);
    expect(plan).toEqual([
      { stage: 1, delayMinutes: 60, scheduledAt: "2026-06-30T13:00:00.000Z" },
      { stage: 2, delayMinutes: 480, scheduledAt: "2026-06-30T20:00:00.000Z" },
    ]);
  });

  it("soporta una sola etapa (agente que solo quiere 1 seguimiento)", () => {
    const from = Date.parse("2026-06-30T12:00:00Z");
    expect(planRetargets(from, [{ delayMinutes: 120 }])).toEqual([
      { stage: 1, delayMinutes: 120, scheduledAt: "2026-06-30T14:00:00.000Z" },
    ]);
  });
});

describe("describeElapsed", () => {
  it("mapea el delay a una frase natural", () => {
    expect(describeElapsed(60)).toBe("hace alrededor de una hora");
    expect(describeElapsed(180)).toBe("hace unas horas");
    expect(describeElapsed(480)).toBe("hace varias horas");
    expect(describeElapsed(1380)).toBe("hace casi un día"); // 23h
    expect(describeElapsed(null)).toBe("hace un rato");
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
  it("nunca revela que es automático y calibra el 'hace cuánto' con el delay", () => {
    const s1 = buildRetargetInstruction(60);
    const s2 = buildRetargetInstruction(480);
    const s3 = buildRetargetInstruction(1380);
    expect(s1).toContain("NO LA REVELES");
    expect(s1).toContain("una hora");
    expect(s2).toContain("varias horas");
    expect(s3).toContain("casi un día");
    // No debe pedir tags de flujo en un seguimiento.
    expect(s1).toContain("No incluyas tags de flujo");
  });

  it("sin guía usa la guía por defecto", () => {
    expect(buildRetargetInstruction(60)).toContain(DEFAULT_RETARGET_GUIDANCE);
  });

  it("con guía del agente la usa y mantiene las reglas de seguridad", () => {
    const guia = "Sé directo: propón cerrar hoy y menciona el envío gratis.";
    const s1 = buildRetargetInstruction(60, guia);
    expect(s1).toContain(guia);
    expect(s1).not.toContain(DEFAULT_RETARGET_GUIDANCE);
    expect(s1).toContain("NO LA REVELES");
    expect(s1).toContain("No incluyas tags de flujo");
    expect(s1).toContain("no inventes precios");
  });

  it("guía vacía o solo espacios → guía por defecto", () => {
    expect(buildRetargetInstruction(480, "   ")).toContain(DEFAULT_RETARGET_GUIDANCE);
    expect(buildRetargetInstruction(480, null)).toContain(DEFAULT_RETARGET_GUIDANCE);
  });
});
