/**
 * Reactivaciones por plantilla — lógica PURA (sin I/O, sin `server-only`).
 *
 * El "qué/cuándo" de los envíos de plantilla a 7 y 15 días: cómo se agendan las
 * etapas y qué decidir con una reactivación vencida. El "cómo" (Supabase,
 * Callbell) vive en `reactivation.ts`. Ver ADR-0021.
 */

export type ReactivationStage = 1 | 2;

export interface ReactivationStagePlan {
  stage: ReactivationStage;
  scheduledAt: string;
}

/** Días para cada etapa desde `fromMs` (ISO). Delays configurables por env. */
export function planReactivations(
  fromMs: number,
  stage1Ms: number,
  stage2Ms: number,
): ReactivationStagePlan[] {
  return [
    { stage: 1, scheduledAt: new Date(fromMs + stage1Ms).toISOString() },
    { stage: 2, scheduledAt: new Date(fromMs + stage2Ms).toISOString() },
  ];
}

export type ReactivationDecision =
  | { action: "send" }
  | { action: "cancel"; reason: string }
  | { action: "skip"; reason: string };

/** Si el cliente escribió hace menos de esto, está activo → no reactivar. */
export const DORMANT_MS = 24 * 60 * 60 * 1000;
/** Si la reactivación venció hace más de esto, ya no tiene sentido enviarla. */
export const STALE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Decide qué hacer con una reactivación vencida, sin I/O:
 *  - la persona compró (tiene orden no cancelada) → cancel.
 *  - no hay plantilla configurada para la etapa → skip.
 *  - el cliente escribió hace poco (< dormantMs) → skip (está activo).
 *  - venció hace mucho (> staleMs, p. ej. tras un apagón del feature) → skip.
 *  - si no, → send.
 *
 * El ON/OFF global se evalúa antes, en el worker (si está apagado no procesa).
 */
export function evaluateReactivation(p: {
  converted: boolean;
  templateConfigured: boolean;
  lastInboundAt: string | null;
  scheduledAt: string;
  now: number;
  dormantMs?: number;
  staleMs?: number;
}): ReactivationDecision {
  const dormantMs = p.dormantMs ?? DORMANT_MS;
  const staleMs = p.staleMs ?? STALE_MS;

  if (p.converted) return { action: "cancel", reason: "converted" };
  if (!p.templateConfigured) return { action: "skip", reason: "no-template" };

  const lastMs = p.lastInboundAt ? Date.parse(p.lastInboundAt) : null;
  if (lastMs != null && p.now - lastMs < dormantMs) {
    return { action: "skip", reason: "recently-active" };
  }

  const scheduledMs = Date.parse(p.scheduledAt);
  if (Number.isFinite(scheduledMs) && p.now - scheduledMs > staleMs) {
    return { action: "skip", reason: "stale" };
  }

  return { action: "send" };
}
