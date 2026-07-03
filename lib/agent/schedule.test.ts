import { describe, expect, it } from "vitest";
import {
  isAgentActiveNow,
  isScheduleActiveAt,
  parseAgentSchedule,
  parseTimeToMinutes,
  type AgentSchedule,
} from "./schedule";

/**
 * Zona America/Bogota = UTC-5 (sin DST). Los instantes se dan en UTC (`...Z`) y el
 * comentario indica la hora/día local en Bogota. En julio 2026: 05 = domingo,
 * 07 = martes, 13 = lunes, 20 = lunes (festivo Independencia).
 */
const TZ = "America/Bogota";

// Noche 20:00–08:00 todos los días + domingos completos + un festivo (20 jul).
const night: AgentSchedule = {
  window: { start: "20:00", end: "08:00" },
  fullWeekdays: [0], // domingo
  holidays: ["2026-07-20"],
};

describe("isScheduleActiveAt", () => {
  it("ventana nocturna con cruce de medianoche", () => {
    expect(isScheduleActiveAt(night, TZ, new Date("2026-07-08T02:00:00Z"))).toBe(true); // mar 21:00
    expect(isScheduleActiveAt(night, TZ, new Date("2026-07-07T08:00:00Z"))).toBe(true); // mar 03:00
    expect(isScheduleActiveAt(night, TZ, new Date("2026-07-07T17:00:00Z"))).toBe(false); // mar 12:00
  });

  it("día completo activo (domingo)", () => {
    expect(isScheduleActiveAt(night, TZ, new Date("2026-07-05T17:00:00Z"))).toBe(true); // dom 12:00
  });

  it("festivo activo todo el día; lunes normal inactivo al mediodía", () => {
    expect(isScheduleActiveAt(night, TZ, new Date("2026-07-20T17:00:00Z"))).toBe(true); // lun festivo 12:00
    expect(isScheduleActiveAt(night, TZ, new Date("2026-07-13T17:00:00Z"))).toBe(false); // lun normal 12:00
  });

  it("límites de la ventana: inicio inclusivo, fin exclusivo", () => {
    const w: AgentSchedule = { window: { start: "20:00", end: "08:00" }, fullWeekdays: [], holidays: [] };
    expect(isScheduleActiveAt(w, TZ, new Date("2026-07-08T01:00:00Z"))).toBe(true); // 20:00 exacto
    expect(isScheduleActiveAt(w, TZ, new Date("2026-07-07T13:00:00Z"))).toBe(false); // 08:00 exacto
  });

  it("ventana de longitud cero (start===end) no aporta", () => {
    const zero: AgentSchedule = { window: { start: "08:00", end: "08:00" }, fullWeekdays: [], holidays: [] };
    expect(isScheduleActiveAt(zero, TZ, new Date("2026-07-07T13:00:00Z"))).toBe(false); // 08:00
  });

  it("schedule vacío ⇒ activo (fail-safe: nunca silenciar por config vacía)", () => {
    const empty: AgentSchedule = { window: null, fullWeekdays: [], holidays: [] };
    expect(isScheduleActiveAt(empty, TZ, new Date("2026-07-07T17:00:00Z"))).toBe(true);
  });

  it("zona horaria inválida ⇒ activo (fail-safe)", () => {
    expect(isScheduleActiveAt(night, "Not/AZone", new Date("2026-07-07T17:00:00Z"))).toBe(true);
  });
});

describe("isAgentActiveNow", () => {
  const now = new Date("2026-07-07T17:00:00Z"); // martes 12:00 Bogota (fuera de la ventana)

  it("schedule_enabled=false ⇒ siempre activo", () => {
    expect(
      isAgentActiveNow({ schedule_enabled: false, schedule_timezone: TZ, schedule: night }, now),
    ).toBe(true);
  });

  it("schedule_enabled=true respeta el horario", () => {
    expect(
      isAgentActiveNow({ schedule_enabled: true, schedule_timezone: TZ, schedule: night }, now),
    ).toBe(false);
    expect(
      isAgentActiveNow(
        { schedule_enabled: true, schedule_timezone: TZ, schedule: night },
        new Date("2026-07-08T02:00:00Z"), // martes 21:00
      ),
    ).toBe(true);
  });
});

describe("parseAgentSchedule", () => {
  it("tolera basura y normaliza", () => {
    expect(parseAgentSchedule(null)).toEqual({ window: null, fullWeekdays: [], holidays: [] });
    expect(parseAgentSchedule("x")).toEqual({ window: null, fullWeekdays: [], holidays: [] });
    // window sin `end` ⇒ null
    expect(parseAgentSchedule({ window: { start: "20:00" } }).window).toBeNull();
    const p = parseAgentSchedule({
      window: { start: "20:00", end: "08:00" },
      fullWeekdays: [0, 7, "x", 3],
      holidays: ["2026-07-20", "bad", " 2026-01-01 "],
    });
    expect(p.window).toEqual({ start: "20:00", end: "08:00" });
    expect(p.fullWeekdays).toEqual([0, 3]);
    expect(p.holidays).toEqual(["2026-07-20", "2026-01-01"]);
  });
});

describe("parseTimeToMinutes", () => {
  it("convierte HH:MM y rechaza inválidos", () => {
    expect(parseTimeToMinutes("20:00")).toBe(1200);
    expect(parseTimeToMinutes("08:30")).toBe(510);
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(parseTimeToMinutes("8")).toBeNull();
  });
});
