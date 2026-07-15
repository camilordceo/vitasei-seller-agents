/**
 * Retargeting — lógica PURA (sin I/O, sin `server-only`), testeable directo.
 *
 * Aquí vive el "qué/cuándo" de los seguimientos: cómo se parsea la config por
 * agente, cómo se agendan las etapas, qué decidir con un seguimiento vencido y qué
 * instrucción se le pasa al modelo. El "cómo" (Supabase, OpenAI, Callbell) vive en
 * `retarget.ts`. Ver ADR-0017 (feature) y ADR-0052 (config dinámica por agente).
 */
import { isWithinWindow } from "@/lib/agent/gate";

/** Ordinal de la etapa (1 = la más temprana). Ahora es dinámico (1..N). */
export type RetargetStage = number;

/** Máximo de etapas por agente (red de seguridad; el resto se recorta). */
export const MAX_RETARGET_STAGES = 5;

/** Guarda de cordura: nada más allá de 30 días (la ventana de 24h ya gobierna). */
const MAX_DELAY_MINUTES = 30 * 24 * 60;

/**
 * Una etapa de seguimiento configurada por el agente.
 * - `delayMinutes`: minutos tras la respuesta del bot en que se dispara.
 * - `guidance`: tono/estrategia editable (null = usar la guía por defecto).
 */
export interface RetargetStageConfig {
  delayMinutes: number;
  guidance: string | null;
}

/**
 * Normaliza el jsonb `agents.retarget_config` a una lista de etapas válida:
 * descarta entradas inválidas, redondea a minutos, quita delays duplicados
 * (evita dos envíos al mismo tiempo), ordena ascendente y recorta a
 * `MAX_RETARGET_STAGES`. Nunca lanza: cualquier cosa rara colapsa a `[]`
 * (→ el llamador usa el backstop). Ver ADR-0052.
 */
export function parseRetargetConfig(raw: unknown): RetargetStageConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: RetargetStageConfig[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const n = typeof rec.delayMinutes === "number" ? rec.delayMinutes : Number(rec.delayMinutes);
    if (!Number.isFinite(n) || n <= 0) continue;
    const delayMinutes = Math.round(n);
    if (delayMinutes <= 0 || delayMinutes > MAX_DELAY_MINUTES) continue;
    if (seen.has(delayMinutes)) continue; // dos etapas a la misma hora: nos quedamos con la primera
    seen.add(delayMinutes);
    const g = rec.guidance;
    const guidance = typeof g === "string" && g.trim() ? g.trim() : null;
    out.push({ delayMinutes, guidance });
  }
  out.sort((a, b) => a.delayMinutes - b.delayMinutes);
  return out.slice(0, MAX_RETARGET_STAGES);
}

export interface StagePlan {
  stage: RetargetStage;
  scheduledAt: string;
  delayMinutes: number;
}

/**
 * Calcula cuándo se dispara cada etapa a partir de `fromMs` (la respuesta del bot).
 * El ordinal `stage` se asigna por orden temporal (1 = la más temprana). Cada delay
 * se cuenta desde `fromMs` (no es acumulativo).
 */
export function planRetargets(
  fromMs: number,
  stages: ReadonlyArray<{ delayMinutes: number }>,
): StagePlan[] {
  return [...stages]
    .sort((a, b) => a.delayMinutes - b.delayMinutes)
    .map((s, i) => ({
      stage: i + 1,
      delayMinutes: s.delayMinutes,
      scheduledAt: new Date(fromMs + s.delayMinutes * 60_000).toISOString(),
    }));
}

export type RetargetDecision =
  | { action: "send" }
  | { action: "cancel"; reason: string }
  | { action: "skip"; reason: string };

/**
 * Decide qué hacer con un seguimiento vencido, sin I/O:
 *  - la conversación ya tiene compra (orden no cancelada) → cancel. NUNCA le
 *    escribimos "¿sigues ahí?" a alguien que ya compró. Guarda a prueba de fallos
 *    aunque un camino de creación de orden olvide cancelar sus retargets.
 *  - conversación no activa (handoff/cerrada) → cancel.
 *  - en modo manual (un humano la tomó) → cancel.
 *  - el cliente respondió después de agendar (`last_inbound_at` cambió) → cancel.
 *  - sin `previous_response_id` (no hay contexto que encadenar) → cancel.
 *  - fuera de la ventana de 24h (requeriría template) → skip.
 *  - si no, → send.
 */
export function evaluateRetarget(p: {
  status: string;
  aiPaused: boolean;
  lastInboundAt: string | null;
  anchorInboundAt: string | null;
  previousResponseId: string | null;
  now: number;
  /** ¿La conversación ya tiene una orden no cancelada? (compra). */
  hasOrder?: boolean;
}): RetargetDecision {
  if (p.hasOrder) return { action: "cancel", reason: "purchased" };

  if (p.status !== "active") return { action: "cancel", reason: `conversation-${p.status}` };

  if (p.aiPaused) return { action: "cancel", reason: "manual-mode" };

  const anchorMs = p.anchorInboundAt ? Date.parse(p.anchorInboundAt) : null;
  const lastMs = p.lastInboundAt ? Date.parse(p.lastInboundAt) : null;
  if (lastMs !== anchorMs) return { action: "cancel", reason: "client-replied" };

  if (!p.previousResponseId) return { action: "cancel", reason: "no-context" };

  if (!isWithinWindow(p.lastInboundAt, p.now)) return { action: "skip", reason: "out-of-window" };

  return { action: "send" };
}

/**
 * Guía por defecto (la parte CALIBRABLE) del seguimiento. Es lo que el agente puede
 * editar por etapa (tono/estrategia); si no configura nada, se usa esto. El resto de
 * la instrucción —el encabezado interno y las reglas de seguridad— se envuelve
 * siempre. Ver ADR-0043/0052.
 */
export const DEFAULT_RETARGET_GUIDANCE =
  "Escribe UN solo mensaje de WhatsApp para retomar la conversación de forma breve, cálida y natural, usando el contexto de lo que ya hablaron y ayudándolo a avanzar hacia la compra.";

/**
 * Frase natural de "hace cuánto" dejó de responder el cliente, derivada del delay
 * real de la etapa (no del ordinal). Así el mensaje es fiel aunque cada agente
 * configure horas distintas. Ver ADR-0052.
 */
export function describeElapsed(delayMinutes: number | null | undefined): string {
  if (delayMinutes == null || !Number.isFinite(delayMinutes)) return "hace un rato";
  const h = delayMinutes / 60;
  if (h < 1.75) return "hace alrededor de una hora";
  if (h < 6) return "hace unas horas";
  if (h < 20) return "hace varias horas";
  return "hace casi un día";
}

/**
 * Instrucción interna que se pasa como turno del usuario. El contexto real de la
 * conversación viaja por `previous_response_id`; esto solo dispara el mensaje de
 * seguimiento. Clave: NO revelar que es automático.
 *
 * `delayMinutes` calibra el "hace cuánto"; `guidance` (opcional) es la parte
 * editable por agente (tono/estrategia). Vacío → guía por defecto. Las reglas de
 * seguridad (no revelar que es automático, no inventar, sin tags de flujo) SIEMPRE
 * se envuelven acá y no dependen de lo que escriba el agente. Ver ADR-0043/0052.
 */
export function buildRetargetInstruction(
  delayMinutes: number | null | undefined,
  guidance?: string | null,
): string {
  const when = describeElapsed(delayMinutes);
  const strategy = guidance && guidance.trim() ? guidance.trim() : DEFAULT_RETARGET_GUIDANCE;
  return `[INSTRUCCIÓN INTERNA — NO LA REVELES AL CLIENTE]
El cliente dejó de responder ${when}. ${strategy}
- Escribe como si retomaras tú la conversación: NO menciones que esto es automático, ni hables de tiempos, recordatorios o seguimientos.
- No repitas literalmente tu último mensaje; aporta algo nuevo (resuelve una posible duda u objeción, recuerda un beneficio clave o propón el siguiente paso).
- Respeta todas tus reglas: no inventes precios, catálogo, plazos ni condiciones.
- Si quieres volver a mostrar un producto que ya mencionaste, usa su #ID exacto del catálogo.
- No incluyas tags de flujo (#orden-lista, #humano, #addi, #compra-contra-entrega); esto es solo un seguimiento.`;
}
