/**
 * Gate anti-alucinación (Sprint 4) — lógica PURA, testeable sin I/O.
 *
 * Dos reglas:
 *  1. Un `#ID:<sku>` solo se envía si el SKU EXISTE en `products`. Los que no,
 *     se descartan y se loguean como `gate_blocked` (el modelo los inventó).
 *  2. Ventana de 24h: solo se puede enviar si el último inbound del cliente fue
 *     hace <= 24h; fuera de eso requeriría template (backlog) → se omite el envío.
 *
 * El lookup en `products` y el envío son del llamador (server); acá solo se
 * decide qué es válido.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface GateResult {
  /** SKUs que existen en `products` → se les envía imagen. */
  validSkus: string[];
  /** SKUs inventados (no existen) → se descartan y se loguean. */
  blockedSkus: string[];
  /** ¿Estamos dentro de la ventana de 24h para enviar mensajes normales? */
  withinWindow: boolean;
}

/**
 * @param skus          SKUs emitidos por el modelo (de los `#ID:`).
 * @param knownSkus     SKUs que existen en `products`.
 * @param lastInboundAt ISO del último inbound del cliente (o null).
 * @param now           timestamp ms (se pasa para que la función sea pura).
 */
export function applyGate(
  skus: string[],
  knownSkus: Iterable<string>,
  lastInboundAt: string | null,
  now: number,
): GateResult {
  const known = knownSkus instanceof Set ? knownSkus : new Set(knownSkus);
  const validSkus: string[] = [];
  const blockedSkus: string[] = [];

  for (const sku of skus) {
    if (known.has(sku)) validSkus.push(sku);
    else blockedSkus.push(sku);
  }

  return { validSkus, blockedSkus, withinWindow: isWithinWindow(lastInboundAt, now) };
}

/** ¿`now` está dentro de las 24h posteriores al último inbound? */
export function isWithinWindow(lastInboundAt: string | null, now: number): boolean {
  if (!lastInboundAt) return true; // sin dato: best-effort (acabamos de recibir un msj)
  const t = Date.parse(lastInboundAt);
  if (Number.isNaN(t)) return true;
  return now - t <= WINDOW_MS;
}
