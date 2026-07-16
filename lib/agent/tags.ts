/**
 * Parser de tags del agente (Sprint 3) — lógica PURA, testeable sin I/O.
 *
 * El modelo recomienda productos escribiendo el `#ID` del catálogo (formato
 * `#ID<dígitos>`, p. ej. `#ID7948237144230`) **inline** en el mensaje — igual
 * que el regex que corría en Bubble. El backend:
 *   1) extrae esos `#ID` (el token COMPLETO es el `sku` en `products`),
 *   2) los QUITA del texto que ve el cliente (`cleanText`),
 *   3) por cada `#ID` válido (gate: existe en `products`) manda la imagen.
 *
 * Los tags de flujo universales (`#orden-lista`, `#humano`, `#llamada`) van en su
 * propia línea al final. Los tags de PAGO (`#compra-contra-entrega`, `#addi`,
 * `#zelle`…) son POR AGENTE: se pasan en `opts.paymentMethods` y el que matchee
 * fija `paymentMethod`. Ver ADR-0014 (tags) y ADR-0055 (métodos por agente).
 */

import { matchPaymentMethod, type PaymentMethodConfig } from "@/lib/agent/paymentMethods";

export interface ParsedTags {
  /**
   * SKUs de los `#ID<dígitos>` en orden de aparición y sin duplicados. El SKU
   * es el token COMPLETO (incluye el prefijo `#ID`), igual que `products.sku`.
   */
  skus: string[];
  /** Clave del método de pago elegido (por un tag configurado del agente), o null. */
  paymentMethod: string | null;
  /** Tag de pago que matcheó (p. ej. `#zelle`), o null. */
  paymentTag: string | null;
  /** `#orden-lista` */
  ordenLista: boolean;
  /** `#humano` */
  humano: boolean;
  /** `#llamada` — el cliente pidió que lo llamen. */
  llamada: boolean;
  /** Tags crudos tal como se emitieron (para `messages.tags`). */
  raw: string[];
}

export interface ParsedReply {
  /** Texto sin los `#ID` ni las líneas de tags ni líneas en blanco colgantes. */
  cleanText: string;
  tags: ParsedTags;
}

export interface ParseReplyOptions {
  /** Métodos de pago configurados del agente (sus tags se reconocen y se quitan). */
  paymentMethods?: ReadonlyArray<PaymentMethodConfig>;
}

/** `#ID` seguido de dígitos, EN CUALQUIER PARTE del texto (inline). */
const RE_ID_INLINE = /#ID\d+/g;
/** Igual, pero comiéndose el espacio previo, para limpiar el texto sin dobles espacios. */
const RE_ID_STRIP = /[ \t]*#ID\d+/g;
const RE_ORDEN = /^#orden-lista$/;
const RE_HUMANO = /^#humano$/;
const RE_LLAMADA = /^#llamada$/;

/**
 * Extrae los `#ID` inline y los tags (flujo universal + pago del agente), y
 * devuelve el texto limpio que ve el cliente. Los `#ID` se sacan de cualquier
 * parte; los tags solo si (tras trim) la línea matchea exactamente uno.
 */
export function parseReply(output: string, opts: ParseReplyOptions = {}): ParsedReply {
  const src = output ?? "";
  const paymentMethods = opts.paymentMethods ?? [];

  // 1) `#ID` inline → skus (token completo, dedup, en orden) + raw.
  const skus: string[] = [];
  const raw: string[] = [];
  for (const m of src.matchAll(RE_ID_INLINE)) {
    const sku = m[0];
    if (!skus.includes(sku)) skus.push(sku);
    raw.push(sku);
  }

  // 2) Quitar los `#ID` del texto (con el espacio previo para no dejar huecos).
  const withoutIds = src.replace(RE_ID_STRIP, "");

  // 3) Tags por línea + construir el texto limpio.
  const kept: string[] = [];
  let paymentMethod: string | null = null;
  let paymentTag: string | null = null;
  let ordenLista = false;
  let humano = false;
  let llamada = false;

  for (const line of withoutIds.split(/\r?\n/)) {
    // Normaliza la línea para tolerar markdown: viñetas (-, *, •) y énfasis
    // (*, _, `, ~) alrededor del tag. Los guiones INTERNOS del tag se conservan
    // (solo se quitan viñetas al inicio), así `- **#orden-lista**` sí matchea.
    const norm = line
      .replace(/[*_`~]/g, "")
      .replace(/^[\s>*_~•-]+/, "")
      .trim();
    // Flujo universal primero (gana ante un tag de pago que coincida por error).
    if (RE_ORDEN.test(norm)) {
      ordenLista = true;
      raw.push(norm);
    } else if (RE_HUMANO.test(norm)) {
      humano = true;
      raw.push(norm);
    } else if (RE_LLAMADA.test(norm)) {
      llamada = true;
      raw.push(norm);
    } else {
      // Tag de pago del agente (el primero que matchee gana).
      const pm = matchPaymentMethod(norm, paymentMethods);
      if (pm) {
        if (paymentMethod == null) {
          paymentMethod = pm.method;
          paymentTag = pm.tag;
        }
        raw.push(norm);
      } else {
        kept.push(line);
      }
    }
  }

  // Limpieza: quitar espacios colgantes por línea (los deja el strip del #ID y
  // los saltos de markdown), colapsar líneas en blanco y recortar bordes.
  const cleanText = kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    cleanText,
    tags: { skus, paymentMethod, paymentTag, ordenLista, humano, llamada, raw },
  };
}
