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
 * Los tags de flujo (`#addi`, `#compra-contra-entrega`, `#orden-lista`,
 * `#humano`) siguen yendo en su propia línea al final. El envío de imágenes y
 * el gate son del Sprint 4; acá solo se parsea. Ver ADR-0014.
 */

export interface ParsedTags {
  /**
   * SKUs de los `#ID<dígitos>` en orden de aparición y sin duplicados. El SKU
   * es el token COMPLETO (incluye el prefijo `#ID`), igual que `products.sku`.
   */
  skus: string[];
  /** `#addi` */
  addi: boolean;
  /** `#compra-contra-entrega` */
  cod: boolean;
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

/** `#ID` seguido de dígitos, EN CUALQUIER PARTE del texto (inline). */
const RE_ID_INLINE = /#ID\d+/g;
/** Igual, pero comiéndose el espacio previo, para limpiar el texto sin dobles espacios. */
const RE_ID_STRIP = /[ \t]*#ID\d+/g;
const RE_ADDI = /^#addi$/;
const RE_COD = /^#compra-contra-entrega$/;
const RE_ORDEN = /^#orden-lista$/;
const RE_HUMANO = /^#humano$/;
const RE_LLAMADA = /^#llamada$/;

/**
 * Extrae los `#ID` inline y los tags de flujo, y devuelve el texto limpio que
 * ve el cliente. Los `#ID` se sacan de cualquier parte; los tags de flujo solo
 * si (tras trim) la línea matchea exactamente uno de los patrones.
 */
export function parseReply(output: string): ParsedReply {
  const src = output ?? "";

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

  // 3) Tags de flujo por línea + construir el texto limpio.
  const kept: string[] = [];
  let addi = false;
  let cod = false;
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
    if (RE_ADDI.test(norm)) {
      addi = true;
      raw.push(norm);
    } else if (RE_COD.test(norm)) {
      cod = true;
      raw.push(norm);
    } else if (RE_ORDEN.test(norm)) {
      ordenLista = true;
      raw.push(norm);
    } else if (RE_HUMANO.test(norm)) {
      humano = true;
      raw.push(norm);
    } else if (RE_LLAMADA.test(norm)) {
      llamada = true;
      raw.push(norm);
    } else {
      kept.push(line);
    }
  }

  // Limpieza: quitar espacios colgantes por línea (los deja el strip del #ID y
  // los saltos de markdown), colapsar líneas en blanco y recortar bordes.
  const cleanText = kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanText, tags: { skus, addi, cod, ordenLista, humano, llamada, raw } };
}
