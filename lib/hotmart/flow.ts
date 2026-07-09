/**
 * Marca del flujo de Hotmart (cursos) para la IA.
 *
 * Cuando un cliente que entró por un carrito abandonado de Hotmart responde, se
 * anexa esta marca al texto que ve la IA (NO al mensaje que se guarda en la base:
 * el hilo del panel y la extracción de la orden quedan limpios). Con la marca en
 * su input, el agente identifica el caso y ejecuta el flujo de cursos definido en
 * su system prompt. Ver docs/17-hotmart-carritos.md, ADR-0040.
 */

/** Frase exacta que la IA reconoce como "esta conversación es del flujo Hotmart". */
export const HOTMART_FLOW_MARKER = "Es flujo hotmart";

/**
 * Anexa la marca del flujo Hotmart al texto del turno del cliente. Pura y sin IO.
 *
 * - Si `active` es false, devuelve el texto tal cual.
 * - Idempotente: si el texto ya termina con la marca, no la duplica.
 * - Si el texto viene vacío (p. ej. un turno de solo imagen), devuelve la marca sola.
 *
 * La garantía de "no forzar una respuesta a un turno vacío" se maneja en el call
 * site: solo se llama cuando el turno ya tiene contenido (texto o imagen).
 */
export function appendHotmartMarker(text: string, active: boolean): string {
  if (!active) return text;
  const trimmed = text.trim();
  if (trimmed.endsWith(HOTMART_FLOW_MARKER)) return text; // idempotente
  if (trimmed.length === 0) return HOTMART_FLOW_MARKER;
  return `${text}\n\n${HOTMART_FLOW_MARKER}`;
}
