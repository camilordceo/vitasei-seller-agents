/**
 * Parser de tags del agente (Sprint 3) — lógica PURA, testeable sin I/O.
 *
 * El modelo escribe el mensaje natural y agrega los tags AL FINAL, cada uno en
 * su propia línea (ver docs/03). El backend los quita del texto (`cleanText`,
 * que es lo que ve el cliente) y los devuelve estructurados. El envío de las
 * imágenes de los `#ID` y el gate (validar que el SKU exista en `products`)
 * son del Sprint 4 — acá solo se parsea.
 */

export interface ParsedTags {
  /** SKUs de los `#ID:<sku>`, en orden de aparición y sin duplicados. */
  skus: string[];
  /** `#addi` */
  addi: boolean;
  /** `#compra-contra-entrega` */
  cod: boolean;
  /** `#orden-lista` */
  ordenLista: boolean;
  /** `#humano` */
  humano: boolean;
  /** Tags crudos tal como se emitieron (para `messages.tags`). */
  raw: string[];
}

export interface ParsedReply {
  /** Texto sin las líneas de tags ni líneas en blanco colgantes. */
  cleanText: string;
  tags: ParsedTags;
}

const RE_ID = /^#ID:([A-Za-z0-9-]+)$/;
const RE_ADDI = /^#addi$/;
const RE_COD = /^#compra-contra-entrega$/;
const RE_ORDEN = /^#orden-lista$/;
const RE_HUMANO = /^#humano$/;

/**
 * Separa el texto limpio de los tags. Una línea es tag solo si (tras trim)
 * matchea exactamente uno de los patrones; cualquier otra línea es texto.
 */
export function parseReply(output: string): ParsedReply {
  const lines = (output ?? "").split(/\r?\n/);
  const kept: string[] = [];
  const skus: string[] = [];
  const raw: string[] = [];
  let addi = false;
  let cod = false;
  let ordenLista = false;
  let humano = false;

  for (const line of lines) {
    const t = line.trim();
    const idMatch = t.match(RE_ID);

    if (idMatch) {
      const sku = idMatch[1];
      if (!skus.includes(sku)) skus.push(sku);
      raw.push(t);
    } else if (RE_ADDI.test(t)) {
      addi = true;
      raw.push(t);
    } else if (RE_COD.test(t)) {
      cod = true;
      raw.push(t);
    } else if (RE_ORDEN.test(t)) {
      ordenLista = true;
      raw.push(t);
    } else if (RE_HUMANO.test(t)) {
      humano = true;
      raw.push(t);
    } else {
      kept.push(line);
    }
  }

  // Colapsar saltos múltiples que quedan al remover tags, y recortar bordes.
  const cleanText = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { cleanText, tags: { skus, addi, cod, ordenLista, humano, raw } };
}
