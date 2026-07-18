import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma del post-call webhook de Synthflow.
 *
 * Dos particularidades que la doc deja ambiguas y que aquí se blindan:
 *
 * 1. **Se firma el `call_id`, NO el cuerpo.** Textual de su doc: *"Synthflow
 *    signs the `call_id` with that key"*. Eso autentica al emisor pero **no da
 *    integridad del payload** → por eso el webhook solo se usa como aviso y los
 *    datos se releen por API (ADR-0061).
 * 2. **El nombre del header es incierto.** La doc lo escribe
 *    `HTTP_SYNTHFLOW_SIGNATURE`, que es la grafía WSGI/Django de una variable de
 *    entorno, no un header de red. Probamos varias grafías, case-insensitive.
 *
 * El algoritmo es HMAC-SHA256 en **base64** (no hex, a diferencia de Kapso).
 */

/** Grafías posibles del header, en orden de probabilidad. */
const SIGNATURE_HEADERS = [
  "synthflow-signature",
  "x-synthflow-signature",
  "http-synthflow-signature",
  "http_synthflow_signature",
] as const;

/** Lee la firma del request probando todas las grafías conocidas. */
export function readSignatureHeader(headers: Headers): string | null {
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name);
    if (value && value.trim().length > 0) return value.trim();
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * ¿La firma corresponde al `call_id`? Se compara en base64 y, por si acaso,
 * también en hex (su doc muestra base64, pero el ejemplo en Python es lo único
 * que lo fija; aceptar hex no debilita nada porque ambas exigen el secreto).
 */
export function verifySynthflowSignature(
  callId: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret || !callId) return false;
  const received = signature.trim();
  if (received.length === 0) return false;

  const mac = createHmac("sha256", secret).update(callId).digest();
  if (safeEqual(received, mac.toString("base64"))) return true;
  if (safeEqual(received.toLowerCase(), mac.toString("hex"))) return true;
  return false;
}
