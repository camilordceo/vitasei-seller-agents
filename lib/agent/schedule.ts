/**
 * Horario de encendido/apagado por agente — lógica PURA (sin I/O, sin `server-only`).
 *
 * Un agente puede programar cuándo está "activo" (respondiendo). El horario se
 * evalúa inline en el flujo (no hay cron que prenda/apague). Modelo POR DÍA: cada
 * día de semana tiene su propia lista de franjas horarias (ej. lunes 20:00–23:00).
 * El agente está activo si el momento cae en alguna franja del día O es un festivo.
 * `enabled` (columna aparte) sigue siendo el master manual; esto solo gatea DENTRO
 * de `enabled`. Ver ADR-0029 y ADR-0033.
 *
 * Al ser puro y client-safe, la misma función alimenta el preview "activo ahora"
 * en el editor del dashboard y el gate del backend.
 */

/** Franja horaria "HH:MM"–"HH:MM". Si `end` < `start`, cruza medianoche (ej. 20:00–08:00). */
export interface ScheduleWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface AgentSchedule {
  /**
   * Franjas activas POR día de semana. Índice 0=Dom … 6=Sáb (como `Date.getDay()`).
   * Cada día es una lista de rangos "HH:MM". Lista vacía = ese día apagado.
   * Siempre tiene longitud 7 (lo garantiza `parseAgentSchedule`).
   */
  days: ScheduleWindow[][];
  /** Fechas activas TODO el día, "YYYY-MM-DD" (festivos). */
  holidays: string[];
}

/** Interfaz mínima que necesita el gate; la fila `agents` la satisface por estructura. */
export interface ScheduledAgent {
  schedule_enabled: boolean;
  schedule_timezone: string;
  schedule: unknown;
}

export const DEFAULT_TIMEZONE = "America/Bogota";

/** Franja de día completo (medianoche a medianoche). `24:00` = fin del día. */
export const FULL_DAY: ScheduleWindow = { start: "00:00", end: "24:00" };

/** Semana vacía (7 días sin franjas) — punto de partida para el editor. */
export function emptyWeek(): ScheduleWindow[][] {
  return [[], [], [], [], [], [], []];
}

/** ¿La franja es un día completo (00:00–24:00)? Útil para el editor. */
export function isFullDayWindow(w: ScheduleWindow): boolean {
  return parseTimeToMinutes(w.start) === 0 && parseTimeToMinutes(w.end) === 1440;
}

/** Valida y normaliza un objeto suelto a `ScheduleWindow`, o null si es inválido. */
function parseWindow(raw: unknown): ScheduleWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const start = (raw as Record<string, unknown>).start;
  const end = (raw as Record<string, unknown>).end;
  if (typeof start !== "string" || typeof end !== "string") return null;
  const s = start.trim();
  const e = end.trim();
  if (!s || !e || parseTimeToMinutes(s) == null || parseTimeToMinutes(e) == null) return null;
  return { start: s, end: e };
}

/** Normaliza las fechas de festivos ("YYYY-MM-DD"). */
function parseHolidays(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()))
        .map((d) => d.trim())
    : [];
}

/**
 * Normaliza el jsonb `schedule` a `AgentSchedule` con defaults seguros. Nunca lanza:
 * cualquier cosa rara colapsa a campos vacíos (y un schedule vacío ⇒ siempre activo).
 *
 * Compatible hacia atrás: si el jsonb trae el formato LEGACY (`window` global +
 * `fullWeekdays`), lo MIGRA al modelo por día — la ventana global se aplica a todos
 * los días y los `fullWeekdays` quedan como día completo. Ver ADR-0033.
 */
export function parseAgentSchedule(raw: unknown): AgentSchedule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { days: emptyWeek(), holidays: [] };
  }
  const o = raw as Record<string, unknown>;
  const holidays = parseHolidays(o.holidays);

  // Formato NUEVO: `days` = array de 7 listas de franjas.
  if (Array.isArray(o.days)) {
    const days = emptyWeek();
    for (let d = 0; d < 7; d++) {
      const list = o.days[d];
      if (Array.isArray(list)) {
        for (const w of list) {
          const win = parseWindow(w);
          if (win) days[d].push(win);
        }
      }
    }
    return { days, holidays };
  }

  // Formato LEGACY: ventana global + fullWeekdays → migrar a `days`.
  const window = parseWindow(o.window);
  const fullWeekdays = Array.isArray(o.fullWeekdays)
    ? new Set(o.fullWeekdays.filter((n): n is number => typeof n === "number" && n >= 0 && n <= 6))
    : new Set<number>();

  const days = emptyWeek();
  for (let d = 0; d < 7; d++) {
    if (fullWeekdays.has(d)) days[d].push({ ...FULL_DAY });
    else if (window) days[d].push(window);
  }
  return { days, holidays };
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface LocalParts {
  weekday: number; // 0=Dom … 6=Sáb
  minutes: number; // minutos desde medianoche local (0–1439)
  dateKey: string; // "YYYY-MM-DD" local
}

/** Hora/día/fecha locales en la zona `tz`. Lanza si `tz` es inválida (lo maneja el caller). */
function localParts(now: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  return {
    weekday,
    minutes: hour * 60 + minute,
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** "HH:MM" → minutos desde medianoche. Acepta "24:00" (1440 = fin del día). null si es inválido. */
export function parseTimeToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 1440; // fin del día (límite superior de una franja)
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** ¿`minutes` cae dentro de la franja? Soporta cruce de medianoche (end < start). */
function inWindow(window: ScheduleWindow, minutes: number): boolean {
  const start = parseTimeToMinutes(window.start);
  const end = parseTimeToMinutes(window.end);
  if (start == null || end == null || start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * ¿El schedule está activo en `now` (zona `tz`)? Activo si el momento cae en alguna
 * franja del día correspondiente O es un festivo. Fail-safe: un schedule vacío (sin
 * ninguna franja ni festivo) ⇒ activo, para nunca silenciar al bot por config incompleta.
 */
export function isScheduleActiveAt(schedule: AgentSchedule, tz: string, now: Date): boolean {
  const hasDays = schedule.days.some((d) => d.length > 0);
  const configured = hasDays || schedule.holidays.length > 0;
  if (!configured) return true;

  let parts: LocalParts;
  try {
    parts = localParts(now, tz || DEFAULT_TIMEZONE);
  } catch {
    return true; // zona horaria inválida ⇒ fail-safe: responder
  }

  if (schedule.holidays.includes(parts.dateKey)) return true;

  const windows = schedule.days[parts.weekday] ?? [];
  for (const w of windows) {
    if (inWindow(w, parts.minutes)) return true;
  }
  return false;
}

/**
 * ¿El agente debe responder AHORA según su horario? Si el horario está apagado
 * (`schedule_enabled=false`), siempre true (comportamiento histórico). Es el gate
 * que se usa inline en respuestas, retargets y reactivaciones.
 */
export function isAgentActiveNow(agent: ScheduledAgent, now: Date = new Date()): boolean {
  if (!agent.schedule_enabled) return true;
  return isScheduleActiveAt(
    parseAgentSchedule(agent.schedule),
    agent.schedule_timezone || DEFAULT_TIMEZONE,
    now,
  );
}

/**
 * Festivos de Colombia 2026 (prefill para el editor). Editable por el operador —
 * VERIFICAR contra el calendario oficial antes de confiar ciegamente.
 */
export const COLOMBIA_HOLIDAYS_2026: string[] = [
  "2026-01-01", // Año Nuevo
  "2026-01-12", // Reyes Magos
  "2026-03-23", // San José
  "2026-04-02", // Jueves Santo
  "2026-04-03", // Viernes Santo
  "2026-05-01", // Día del Trabajo
  "2026-05-18", // Ascensión
  "2026-06-08", // Corpus Christi
  "2026-06-15", // Sagrado Corazón
  "2026-06-29", // San Pedro y San Pablo
  "2026-07-20", // Independencia
  "2026-08-07", // Batalla de Boyacá
  "2026-08-17", // Asunción de la Virgen
  "2026-10-12", // Día de la Raza
  "2026-11-02", // Todos los Santos
  "2026-11-16", // Independencia de Cartagena
  "2026-12-08", // Inmaculada Concepción
  "2026-12-25", // Navidad
];
