import { describe, expect, it } from "vitest";
import {
  emptyWeek,
  FULL_DAY,
  isAgentActiveNow,
  isScheduleActiveAt,
  parseAgentSchedule,
  parseTimeToMinutes,
  type AgentSchedule,
  type ScheduleWindow,
} from "./schedule";

/**
 * Zona America/Bogota = UTC-5 (sin DST). Los instantes se dan en UTC (`...Z`) y el
 * comentario indica la hora/día local en Bogota. En julio 2026: 05 = domingo,
 * 07 = martes, 13 = lunes, 20 = lunes (festivo Independencia).
 */
const TZ = "America/Bogota";

/** Construye la semana (7 días) a partir de un mapa {índiceDía: franjas}. */
function week(map: Record<number, ScheduleWindow[]>): ScheduleWindow[][] {
  const d = emptyWeek();
  for (const k of Object.keys(map)) d[Number(k)] = map[Number(k)];
  return d;
}

// Noche 20:00–08:00 TODOS los días + domingo completo + un festivo (20 jul).
const night: AgentSchedule = {
  days: week({
    0: [{ ...FULL_DAY }], // domingo completo
    1: [{ start: "20:00", end: "08:00" }],
    2: [{ start: "20:00", end: "08:00" }],
    3: [{ start: "20:00", end: "08:00" }],
    4: [{ start: "20:00", end: "08:00" }],
    5: [{ start: "20:00", end: "08:00" }],
    6: [{ start: "20:00", end: "08:00" }],
  }),
  holidays: ["2026-07-20"],
};

describe("isScheduleActiveAt — franjas por día", () => {
  it("una franja SOLO en su día: lunes 20:00–23:00", () => {
    const monEve: AgentSchedule = { days: week({ 1: [{ start: "20:00", end: "23:00" }] }), holidays: [] };
    expect(isScheduleActiveAt(monEve, TZ, new Date("2026-07-14T02:00:00Z"))).toBe(true); // lun 21:00
    expect(isScheduleActiveAt(monEve, TZ, new Date("2026-07-14T01:00:00Z"))).toBe(true); // lun 20:00 exacto (inclusivo)
    expect(isScheduleActiveAt(monEve, TZ, new Date("2026-07-13T17:00:00Z"))).toBe(false); // lun 12:00
    expect(isScheduleActiveAt(monEve, TZ, new Date("2026-07-14T04:00:00Z"))).toBe(false); // lun 23:00 exacto (fin exclusivo)
    expect(isScheduleActiveAt(monEve, TZ, new Date("2026-07-15T02:00:00Z"))).toBe(false); // mar 21:00 (martes vacío)
  });

  it("franjas distintas por día (fin de semana en la noche)", () => {
    const wknd: AgentSchedule = {
      days: week({
        5: [{ start: "18:00", end: "23:59" }], // viernes noche
        6: [{ start: "10:00", end: "23:59" }], // sábado casi todo
        0: [{ ...FULL_DAY }], // domingo completo
      }),
      holidays: [],
    };
    expect(isScheduleActiveAt(wknd, TZ, new Date("2026-07-05T09:00:00Z"))).toBe(true); // dom 04:00 (completo)
    expect(isScheduleActiveAt(wknd, TZ, new Date("2026-07-07T17:00:00Z"))).toBe(false); // mar 12:00 (sin franja)
  });

  it("ventana nocturna con cruce de medianoche (misma franja todos los días)", () => {
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

  it("límites de la franja: inicio inclusivo, fin exclusivo", () => {
    const w: AgentSchedule = { days: week({ 2: [{ start: "20:00", end: "08:00" }] }), holidays: [] };
    expect(isScheduleActiveAt(w, TZ, new Date("2026-07-08T01:00:00Z"))).toBe(true); // mar 20:00 exacto
    // 08:00 exacto NO está (fin exclusivo). 08:00 martes = 13:00Z martes.
    const w2: AgentSchedule = { days: week({ 2: [{ start: "06:00", end: "08:00" }] }), holidays: [] };
    expect(isScheduleActiveAt(w2, TZ, new Date("2026-07-07T13:00:00Z"))).toBe(false); // mar 08:00 exacto
  });

  it("franja de longitud cero (start===end) no aporta", () => {
    const zero: AgentSchedule = { days: week({ 2: [{ start: "08:00", end: "08:00" }] }), holidays: [] };
    expect(isScheduleActiveAt(zero, TZ, new Date("2026-07-07T13:00:00Z"))).toBe(false); // mar 08:00
  });

  it("schedule vacío ⇒ activo (fail-safe: nunca silenciar por config vacía)", () => {
    const empty: AgentSchedule = { days: emptyWeek(), holidays: [] };
    expect(isScheduleActiveAt(empty, TZ, new Date("2026-07-07T17:00:00Z"))).toBe(true);
  });

  it("con franjas configuradas, un día sin franja está apagado", () => {
    const monOnly: AgentSchedule = { days: week({ 1: [{ start: "08:00", end: "18:00" }] }), holidays: [] };
    expect(isScheduleActiveAt(monOnly, TZ, new Date("2026-07-07T17:00:00Z"))).toBe(false); // martes vacío
  });

  it("zona horaria inválida ⇒ activo (fail-safe)", () => {
    expect(isScheduleActiveAt(night, "Not/AZone", new Date("2026-07-07T17:00:00Z"))).toBe(true);
  });
});

describe("isAgentActiveNow", () => {
  const now = new Date("2026-07-07T17:00:00Z"); // martes 12:00 Bogota (fuera de la franja)

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

describe("parseAgentSchedule — formato nuevo (days)", () => {
  it("parsea days, descarta franjas y días basura, y garantiza longitud 7", () => {
    const p = parseAgentSchedule({
      days: [
        [],
        [{ start: "20:00", end: "23:00" }, { start: "bad", end: "x" }],
        "junk",
        [{ start: "09:00", end: "12:00" }],
      ],
      holidays: ["2026-07-20", "bad", " 2026-01-01 "],
    });
    expect(p.days).toHaveLength(7);
    expect(p.days[1]).toEqual([{ start: "20:00", end: "23:00" }]); // se cae la franja inválida
    expect(p.days[2]).toEqual([]); // "junk" → vacío
    expect(p.days[3]).toEqual([{ start: "09:00", end: "12:00" }]);
    expect(p.days[6]).toEqual([]);
    expect(p.holidays).toEqual(["2026-07-20", "2026-01-01"]);
  });

  it("tolera basura y devuelve semana vacía", () => {
    expect(parseAgentSchedule(null)).toEqual({ days: emptyWeek(), holidays: [] });
    expect(parseAgentSchedule("x")).toEqual({ days: emptyWeek(), holidays: [] });
  });
});

describe("parseAgentSchedule — migración de formato LEGACY", () => {
  it("ventana global + fullWeekdays → franjas por día equivalentes", () => {
    const p = parseAgentSchedule({
      window: { start: "20:00", end: "08:00" },
      fullWeekdays: [0, 7, "x", 3], // 7 y 'x' se descartan
      holidays: ["2026-07-20"],
    });
    expect(p.days).toHaveLength(7);
    expect(p.days[0]).toEqual([{ start: "00:00", end: "24:00" }]); // domingo completo
    expect(p.days[3]).toEqual([{ start: "00:00", end: "24:00" }]); // miércoles completo
    expect(p.days[1]).toEqual([{ start: "20:00", end: "08:00" }]); // resto: ventana global
    expect(p.days[2]).toEqual([{ start: "20:00", end: "08:00" }]);
    expect(p.holidays).toEqual(["2026-07-20"]);
  });

  it("el schedule migrado se comporta igual que el legacy", () => {
    const migrated = parseAgentSchedule({
      window: { start: "20:00", end: "08:00" },
      fullWeekdays: [0],
      holidays: ["2026-07-20"],
    });
    expect(isScheduleActiveAt(migrated, TZ, new Date("2026-07-05T17:00:00Z"))).toBe(true); // dom 12:00 (completo)
    expect(isScheduleActiveAt(migrated, TZ, new Date("2026-07-07T17:00:00Z"))).toBe(false); // mar 12:00
    expect(isScheduleActiveAt(migrated, TZ, new Date("2026-07-08T02:00:00Z"))).toBe(true); // mar 21:00
    expect(isScheduleActiveAt(migrated, TZ, new Date("2026-07-20T17:00:00Z"))).toBe(true); // festivo
  });
});

describe("parseTimeToMinutes", () => {
  it("convierte HH:MM y acepta 24:00 como fin del día", () => {
    expect(parseTimeToMinutes("20:00")).toBe(1200);
    expect(parseTimeToMinutes("08:30")).toBe(510);
    expect(parseTimeToMinutes("24:00")).toBe(1440);
    expect(parseTimeToMinutes("25:00")).toBeNull();
    expect(parseTimeToMinutes("24:30")).toBeNull();
    expect(parseTimeToMinutes("8")).toBeNull();
  });
});
