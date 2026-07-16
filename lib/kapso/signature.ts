import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación de la firma del webhook de Kapso.
 *
 * Kapso firma con **HMAC SHA256** (digest hex) usando el `secret_key` que elegimos
 * al registrar el webhook, y manda el resultado en el header `X-Webhook-Signature`.
 *
 * AMBIGÜEDAD DE LA DOC (ver docs/24 §Firma): la página de seguridad dice
 * *"Always verify against the raw JSON payload, not a parsed object"*, pero TODOS
 * sus ejemplos firman `JSON.stringify(req.body)` — que es una re-serialización del
 * objeto ya parseado, NO el cuerpo crudo. Ambas coinciden solo si Kapso serializa
 * exactamente igual que nosotros (mismo orden de claves, sin espacios).
 *
 * Como no se puede saber cuál es sin un webhook real, `verifyKapsoSignature` acepta
 * **cualquiera de las dos**. No debilita la seguridad: las dos variantes exigen
 * conocer el secreto; un atacante sin él no puede producir ninguna. Cuando se
 * confirme cuál usa Kapso contra tráfico real, se puede cerrar a esa sola (queda
 * anotado en docs/24 §Pendientes de verificar).
 */

/** Header donde Kapso manda la firma. */
export const KAPSO_SIGNATURE_HEADER = "x-webhook-signature";

/** Normaliza la firma recibida: hex en minúsculas, sin el prefijo `sha256=` si viniera. */
function normalizeSignature(raw: string): string {
  return raw.trim().replace(/^sha256=/i, "").toLowerCase();
}

/** HMAC-SHA256 en hex de `payload` con `secret`. */
function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Comparación en tiempo constante de dos hex del mismo largo. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * ¿La firma corresponde al cuerpo? Se prueba contra el **cuerpo crudo** y, si no
 * casa, contra la **re-serialización** del JSON parseado (la variante de los
 * ejemplos de la doc). Devuelve false ante cualquier entrada inválida.
 *
 * @param rawBody  el cuerpo TAL CUAL llegó (`await req.text()`), sin re-parsear.
 * @param signature valor del header `X-Webhook-Signature`.
 * @param secret   el `secret_key` con el que se registró el webhook en Kapso.
 */
export function verifyKapsoSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const received = normalizeSignature(signature);
  if (received.length === 0) return false;

  // 1) Cuerpo crudo (lo que dice la prosa de la doc).
  if (safeEqual(received, hmacHex(secret, rawBody))) return true;

  // 2) Re-serialización del JSON parseado (lo que hacen los ejemplos de la doc).
  try {
    const restringified = JSON.stringify(JSON.parse(rawBody));
    if (restringified !== rawBody && safeEqual(received, hmacHex(secret, restringified))) {
      return true;
    }
  } catch {
    // Cuerpo no-JSON: solo aplicaba la variante cruda, ya probada.
  }

  return false;
}
