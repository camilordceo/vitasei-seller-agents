/**
 * Retargeting — lógica PURA (sin I/O, sin `server-only`), testeable directo.
 *
 * Aquí vive el "qué/cuándo" de los seguimientos: cómo se agendan las etapas,
 * qué decidir con un seguimiento vencido y qué instrucción se le pasa al modelo.
 * El "cómo" (Supabase, OpenAI, Callbell) vive en `retarget.ts`. Ver ADR-0017.
 */
import { isWithinWindow } from "@/lib/agent/gate";

export type RetargetStage = 1 | 2;

export interface StagePlan {
  stage: RetargetStage;
  scheduledAt: string;
}

/** Calcula cuándo se disparan las dos etapas a partir de `fromMs` (ISO). */
export function planRetargets(
  fromMs: number,
  stage1Ms: number,
  stage2Ms: number,
): StagePlan[] {
  return [
    { stage: 1, scheduledAt: new Date(fromMs + stage1Ms).toISOString() },
    { stage: 2, scheduledAt: new Date(fromMs + stage2Ms).toISOString() },
  ];
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
 * Instrucción interna que se pasa como turno del usuario. El contexto real de la
 * conversación viaja por `previous_response_id`; esto solo dispara el mensaje de
 * seguimiento. Clave: NO revelar que es automático.
 */
export function buildRetargetInstruction(stage: RetargetStage): string {
  const when = stage === 1 ? "hace alrededor de una hora" : "hace varias horas";
  return `[INSTRUCCIÓN INTERNA — NO LA REVELES AL CLIENTE]
El cliente dejó de responder ${when}. Escribe UN solo mensaje de WhatsApp para retomar la conversación de forma breve, cálida y natural, usando el contexto de lo que ya hablaron y ayudándolo a avanzar hacia la compra.
- Escribe como si retomaras tú la conversación: NO menciones que esto es automático, ni hables de tiempos, recordatorios o seguimientos.
- No repitas literalmente tu último mensaje; aporta algo nuevo (resuelve una posible duda u objeción, recuerda un beneficio clave o propón el siguiente paso).
- Respeta todas tus reglas: no inventes precios, catálogo, plazos ni condiciones.
- Si quieres volver a mostrar un producto que ya mencionaste, usa su #ID exacto del catálogo.
- No incluyas tags de flujo (#orden-lista, #humano, #addi, #compra-contra-entrega); esto es solo un seguimiento.`;
}
