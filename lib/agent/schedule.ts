/**
 * Horario de encendido/apagado por agente — lógica PURA (sin I/O, sin `server-only`).
 *
 * Un agente puede programar cuándo está "activo" (respondiendo). El horario se
 * evalúa inline en el flujo (no hay cron que prenda/apague). Modelo UNIÓN: el
 * agente está activo si el momento cae en la ventana diaria O es un día completo
 * activo O es un festivo. `enabled` (columna aparte) sigue siendo el master manual;
 * esto solo gatea DENTRO de `enabled`. Ver ADR-0029.
 *
 * Al ser puro y client-safe, la misma función alimenta el preview "activo ahora"
 * en el editor del dashboard y el gate del backend.
 */

/** Ventana diaria activa. Si `end` < `start`, cruza medianoche (ej. 20:00–08:00 = noche). */
export interface ScheduleWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface AgentSchedule {
  /** Ventana diaria (misma hora todos los días). null = sin ventana. */
  window: ScheduleWindow | null;
  /** Días de semana activos TODO el día (0=Dom … 6=Sáb). Ej. [0] = domingos. */
  fullWeekdays: number[];
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

const EMPTY_SCHEDULE: AgentSchedule = { window: null, fullWeekdays: [], holidays: [] };

/**
 * Normaliza el jsonb `schedule` a `AgentSchedule` con defaults seguros. Nunca lanza:
 * cualquier cosa rara colapsa a campos vacíos (y un schedule vacío ⇒ siempre activo).
 */
export function parseAgentSchedule(raw: unknown): AgentSchedule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_SCHEDULE };
  const o = raw as Record<string, unknown>;

  let window: ScheduleWindow | null = null;
  const w = o.window;
  if (w && typeof w === "object") {
    const start = (w as Record<string, unknown>).start;
    const end = (w as Record<string, unknown>).end;
    if (typeof start === "string" && typeof end === "string" && start.trim() && end.trim()) {
      window = { start: start.trim(), end: end.trim() };
    }
  }

  const fullWeekdays = Array.isArray(o.fullWeekdays)
    ? [...new Set(o.fullWeekdays.filter((n): n is number => typeof n === "number" && n >= 0 && n <= 6))]
    : [];

  const holidays = Array.isArray(o.holidays)
    ? o.holidays
        .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()))
        .map((d) => d.trim())
    : [];

  return { window, fullWeekdays, holidays };
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

/** "HH:MM" → minutos desde medianoche, o null si es inválido. */
export function parseTimeToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** ¿`minutes` cae dentro de la ventana? Soporta cruce de medianoche (end < start). */
function inWindow(window: ScheduleWindow, minutes: number): boolean {
  const start = parseTimeToMinutes(window.start);
  const end = parseTimeToMinutes(window.end);
  if (start == null || end == null || start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * ¿El schedule está activo en `now` (zona `tz`)? Unión: ventana O día completo O
 * festivo. Fail-safe: un schedule vacío (sin nada configurado) ⇒ activo, para
 * nunca silenciar al bot por una configuración incompleta.
 */
export function isScheduleActiveAt(schedule: AgentSchedule, tz: string, now: Date): boolean {
  const configured =
    schedule.window != null || schedule.fullWeekdays.length > 0 || schedule.holidays.length > 0;
  if (!configured) return true;

  let parts: LocalParts;
  try {
    parts = localParts(now, tz || DEFAULT_TIMEZONE);
  } catch {
    return true; // zona horaria inválida ⇒ fail-safe: responder
  }

  if (schedule.holidays.includes(parts.dateKey)) return true;
  if (schedule.fullWeekdays.includes(parts.weekday)) return true;
  if (schedule.window && inWindow(schedule.window, parts.minutes)) return true;
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
