/**
 * Normalización de teléfonos — compartida por todos los proveedores. Pura.
 *
 * Vivía en `lib/callbell/types.ts`; se movió acá con ADR-0056 para que el
 * adaptador de Kapso no tenga que importar de Callbell (`lib/callbell/types.ts`
 * la re-exporta, así nada de lo existente cambió).
 */

/**
 * Normaliza un teléfono a E.164 sin '+' → solo dígitos (ej: 573001234567).
 * Devuelve null si no quedan dígitos.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
