import { describe, expect, it } from "vitest";
import {
  describeCampaignDuration,
  evaluateCampaignPace,
  normalizeInterval,
  planCampaignSchedule,
} from "./voiceCampaignPlan";

/**
 * El ritmo es la feature. Si esto falla, 100 llamadas salen a la vez.
 */

const T0 = Date.parse("2026-07-23T14:00:00.000Z");

describe("normalizeInterval", () => {
  it("acota y redondea", () => {
    expect(normalizeInterval(2)).toBe(2);
    expect(normalizeInterval("3")).toBe(3);
    expect(normalizeInterval(0)).toBe(1);
    expect(normalizeInterval(99999)).toBe(1440);
    expect(normalizeInterval("hola")).toBe(2);
  });
});

describe("planCampaignSchedule", () => {
  it("reparte una llamada cada N minutos desde el arranque", () => {
    expect(planCampaignSchedule(T0, 3, 2)).toEqual([
      "2026-07-23T14:00:00.000Z",
      "2026-07-23T14:02:00.000Z",
      "2026-07-23T14:04:00.000Z",
    ]);
  });

  it("la primera sale de inmediato", () => {
    expect(planCampaignSchedule(T0, 1, 30)[0]).toBe("2026-07-23T14:00:00.000Z");
  });
});

describe("evaluateCampaignPace", () => {
  const base = {
    status: "running" as const,
    intervalMinutes: 2,
    startsAtMs: T0,
    nowMs: T0,
    lastPlacedMs: null as number | null,
  };

  it("la primera llamada sale apenas arranca", () => {
    expect(evaluateCampaignPace(base).action).toBe("place");
  });

  it("espera si no ha pasado el intervalo desde la anterior", () => {
    const d = evaluateCampaignPace({
      ...base,
      lastPlacedMs: T0,
      nowMs: T0 + 60_000, // 1 min de 2
    });
    expect(d).toEqual({ action: "wait", reason: "pacing" });
  });

  it("coloca cuando el intervalo se cumplió", () => {
    expect(
      evaluateCampaignPace({ ...base, lastPlacedMs: T0, nowMs: T0 + 120_000 }).action,
    ).toBe("place");
  });

  it("tolera los milisegundos de desfase del cron", () => {
    // 1:59.7 desde la anterior: el cron nunca dispara al milisegundo exacto y
    // sin margen la campaña perdería un ciclo entero cada vez.
    expect(
      evaluateCampaignPace({ ...base, lastPlacedMs: T0, nowMs: T0 + 119_700 }).action,
    ).toBe("place");
  });

  it("una campaña atrasada NO dispara la cola de golpe", () => {
    // El cron estuvo caído una hora: hay 30 llamadas vencidas, pero la última
    // colocada fue hace 30 s → solo se espera.
    const d = evaluateCampaignPace({
      ...base,
      lastPlacedMs: T0 + 3_600_000 - 30_000,
      nowMs: T0 + 3_600_000,
    });
    expect(d.action).toBe("wait");
  });

  it("pausada espera; cancelada tumba la fila", () => {
    expect(evaluateCampaignPace({ ...base, status: "paused" }).action).toBe("wait");
    expect(evaluateCampaignPace({ ...base, status: "cancelled" }).action).toBe("cancel");
    expect(evaluateCampaignPace({ ...base, status: "completed" }).action).toBe("cancel");
  });

  it("una campaña programada a futuro no arranca antes", () => {
    const d = evaluateCampaignPace({ ...base, startsAtMs: T0 + 3_600_000 });
    expect(d).toEqual({ action: "wait", reason: "campaign_not_started" });
  });
});

describe("describeCampaignDuration", () => {
  it("dice cuánto va a durar la cola", () => {
    expect(describeCampaignDuration(1, 2)).toBe("0 min");
    expect(describeCampaignDuration(11, 2)).toBe("20 min");
    expect(describeCampaignDuration(100, 2)).toBe("3.3 h");
  });
});
