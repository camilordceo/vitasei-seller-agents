import type { VoiceCampaignStatus } from "@/lib/supabase/types";

/**
 * Ritmo de una campaña de llamadas masivas. Módulo PURO (sin I/O). ADR-0084.
 *
 * El corazón de la feature es una sola idea: **el reloj manda dos veces**. La
 * primera al cargar el archivo (cada número queda agendado con su hueco), y la
 * segunda en el worker (no se coloca la siguiente hasta que pasó el intervalo
 * desde la anterior REAL).
 *
 * La segunda es la que importa: sin ella, un cron caído una hora convierte 30
 * llamadas "vencidas" en 30 llamadas simultáneas — que es exactamente lo que
 * una campaña con ritmo intenta evitar (y lo que quema un número saliente).
 */

/** Rango razonable del intervalo: de 1 minuto a un día. */
export const MIN_CAMPAIGN_INTERVAL = 1;
export const MAX_CAMPAIGN_INTERVAL = 1440;

/** Normaliza el intervalo que llega del formulario. */
export function normalizeInterval(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.min(MAX_CAMPAIGN_INTERVAL, Math.max(MIN_CAMPAIGN_INTERVAL, Math.round(n)));
}

/**
 * Reparte N llamadas desde `startMs`, una cada `intervalMinutes`. La primera
 * sale al arrancar (offset 0): quien pulsa "Lanzar" espera ver la primera ya.
 */
export function planCampaignSchedule(
  startMs: number,
  count: number,
  intervalMinutes: number,
): string[] {
  const step = normalizeInterval(intervalMinutes) * 60_000;
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(new Date(startMs + i * step).toISOString());
  return out;
}

export interface CampaignPaceContext {
  status: VoiceCampaignStatus;
  /** Epoch ms de la última llamada REALMENTE colocada de esta campaña. */
  lastPlacedMs: number | null;
  intervalMinutes: number;
  /** Epoch ms del inicio programado (una campaña puede lanzarse a futuro). */
  startsAtMs: number;
  nowMs: number;
}

export type CampaignPaceAction = "place" | "wait" | "cancel";

export interface CampaignPaceDecision {
  action: CampaignPaceAction;
  reason: string;
}

/**
 * ¿Le toca a esta campaña colocar una llamada AHORA? Se evalúa una vez por
 * campaña y por corrida del cron: pasa como mucho una llamada por ciclo.
 */
export function evaluateCampaignPace(ctx: CampaignPaceContext): CampaignPaceDecision {
  if (ctx.status === "cancelled") return { action: "cancel", reason: "campaign_cancelled" };
  if (ctx.status === "completed") return { action: "cancel", reason: "campaign_completed" };
  if (ctx.status === "paused") return { action: "wait", reason: "campaign_paused" };
  if (ctx.nowMs < ctx.startsAtMs) return { action: "wait", reason: "campaign_not_started" };

  if (ctx.lastPlacedMs != null) {
    const elapsed = ctx.nowMs - ctx.lastPlacedMs;
    const step = normalizeInterval(ctx.intervalMinutes) * 60_000;
    // Margen de 5 s: el cron no dispara en el mismo milisegundo cada vez y sin
    // esto una campaña "cada 2 min" se salta un ciclo entero por 300 ms.
    if (elapsed + 5_000 < step) return { action: "wait", reason: "pacing" };
  }
  return { action: "place", reason: "ok" };
}

/** Cuánto dura, en texto, colocar `pending` llamadas al ritmo dado. */
export function describeCampaignDuration(pending: number, intervalMinutes: number): string {
  if (pending <= 0) return "—";
  const minutes = Math.max(0, pending - 1) * normalizeInterval(intervalMinutes);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

/** Etiqueta en español del estado de una campaña. */
export function describeCampaignStatus(status: string): string {
  switch (status) {
    case "running":
      return "En curso";
    case "paused":
      return "Pausada";
    case "completed":
      return "Terminada";
    case "cancelled":
      return "Cancelada";
    default:
      return status;
  }
}
