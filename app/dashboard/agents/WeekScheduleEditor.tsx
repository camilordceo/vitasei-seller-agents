"use client";

import { FULL_DAY, isFullDayWindow, parseTimeToMinutes, type ScheduleWindow } from "@/lib/agent/schedule";

/**
 * Editor de franjas horarias POR día de semana (ADR-0033). Cada día tiene su
 * propia lista de rangos "HH:MM"; un día sin rangos está apagado. Controlado:
 * `days` (longitud 7, índice 0=Dom … 6=Sáb) es la fuente de verdad y cada cambio
 * emite un `onChange` con el array nuevo (inmutable).
 */

/** Se muestran de lunes a domingo (más familiar), pero se guardan por índice 0=Dom. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const chipBtn =
  "rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
const timeCls =
  "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";

/** Nota por franja: vacía (start===end) o cruce de medianoche. */
function franjaNote(w: ScheduleWindow): string | null {
  const s = parseTimeToMinutes(w.start);
  const e = parseTimeToMinutes(w.end);
  if (s == null || e == null) return null;
  if (s === e) return "franja vacía (no aplica)";
  if (e < s) return "cruza la medianoche";
  return null;
}

export function WeekScheduleEditor({
  days,
  onChange,
}: {
  days: ScheduleWindow[][];
  onChange: (days: ScheduleWindow[][]) => void;
}) {
  const clone = () => days.map((d) => d.map((w) => ({ ...w })));

  const addFranja = (d: number) => {
    const n = clone();
    n[d].push({ start: "18:00", end: "22:00" });
    onChange(n);
  };
  const setFullDay = (d: number) => {
    const n = clone();
    n[d] = [{ ...FULL_DAY }];
    onChange(n);
  };
  const clearDay = (d: number) => {
    const n = clone();
    n[d] = [];
    onChange(n);
  };
  const removeFranja = (d: number, i: number) => {
    const n = clone();
    n[d].splice(i, 1);
    onChange(n);
  };
  const setField = (d: number, i: number, field: "start" | "end", value: string) => {
    const n = clone();
    n[d][i] = { ...n[d][i], [field]: value };
    onChange(n);
  };
  const copyToAll = (d: number) => {
    const src = days[d].map((w) => ({ ...w }));
    onChange(days.map(() => src.map((w) => ({ ...w }))));
  };

  return (
    <div className="space-y-2">
      {DISPLAY_ORDER.map((d) => {
        const franjas = days[d] ?? [];
        return (
          <div key={d} className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-24 text-sm font-medium text-slate-700">{DAY_NAMES[d]}</span>
                {franjas.length === 0 ? (
                  <span className="text-xs text-slate-400">Apagado</span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => addFranja(d)} className={chipBtn}>
                  + Franja
                </button>
                <button type="button" onClick={() => setFullDay(d)} className={chipBtn}>
                  Todo el día
                </button>
                {franjas.length > 0 ? (
                  <>
                    <button type="button" onClick={() => copyToAll(d)} className={chipBtn}>
                      Copiar a todos
                    </button>
                    <button
                      type="button"
                      onClick={() => clearDay(d)}
                      className={`${chipBtn} hover:text-rose-600`}
                    >
                      Apagar
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {franjas.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {franjas.map((w, i) => {
                  const note = franjaNote(w);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      {isFullDayWindow(w) ? (
                        <span className="inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-1.5 text-sm font-medium text-emerald-700">
                          Todo el día (24 h)
                        </span>
                      ) : (
                        <>
                          <input
                            type="time"
                            aria-label={`${DAY_NAMES[d]}: enciende a las`}
                            value={w.start}
                            onChange={(e) => setField(d, i, "start", e.target.value)}
                            className={timeCls}
                          />
                          <span className="text-slate-400" aria-hidden="true">
                            –
                          </span>
                          <input
                            type="time"
                            aria-label={`${DAY_NAMES[d]}: apaga a las`}
                            value={w.end}
                            onChange={(e) => setField(d, i, "end", e.target.value)}
                            className={timeCls}
                          />
                        </>
                      )}
                      {note ? <span className="text-xs text-amber-600">{note}</span> : null}
                      <button
                        type="button"
                        onClick={() => removeFranja(d, i)}
                        aria-label="Quitar franja"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M7 7l1 13h8l1-13" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
