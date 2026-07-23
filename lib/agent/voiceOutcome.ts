import type { OrderDraft } from "@/lib/openai/extractOrder";
import type { OrderField, VoiceExtractor } from "@/lib/synthflow/types";
import {
  formatExtractedValue,
  humanizeIdentifier,
  type ExtractedData,
  type ExtractedValue,
} from "@/lib/synthflow/extractors";

/**
 * Del resultado de una llamada a una ORDEN. Módulo PURO (sin I/O). Ver ADR-0083.
 *
 * Antes la llamada dejaba los datos extraídos como texto suelto en el detalle:
 * hubo llamadas que cerraron compra y solo se descubrían abriéndolas una por
 * una. Ahora un extractor puede marcarse como **resultado de la llamada**
 * (`resultado_llamada` → compra / no interesada / volver a llamar) y, cuando cae
 * en una de las opciones de compra, el resto de extractores se mapean a los
 * campos de la orden.
 *
 * Dos decisiones que valen la pena decir en voz alta:
 *
 *  · **La comparación es EXACTA** (normalizada: sin tildes, minúsculas). Nada de
 *    "contiene": con `includes`, un resultado `"no compra"` dispararía una venta
 *    porque contiene la palabra `compra`. Aquí una orden de más es plata y
 *    logística movidas por un falso positivo.
 *  · **Lo que no se mapea NO se pierde**: cae en las notas de la orden. Un dato
 *    que el cliente dictó por teléfono y desaparece es peor que uno mal ubicado.
 */

/** Quita tildes, baja a minúsculas y colapsa espacios/underscores. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/[.,;:!¡?¿]+$/g, "")
    .trim();
}

/**
 * El extractor que define el resultado de la llamada. Solo puede haber uno:
 * si el operador marcó varios, gana el primero (y la UI lo dice).
 */
export function findOutcomeExtractor(
  extractors: ReadonlyArray<VoiceExtractor>,
): VoiceExtractor | null {
  return extractors.find((e) => e.outcome === true) ?? null;
}

/**
 * Valor del resultado tal como lo dijo la llamada (`"compra"`), o null si no hay
 * extractor de resultado o esa llamada no lo extrajo.
 */
export function readOutcome(
  extracted: ExtractedData,
  outcomeExtractor: VoiceExtractor | null,
): string | null {
  if (!outcomeExtractor) return null;
  const raw = extracted[outcomeExtractor.identifier];
  if (raw === undefined) return null;
  const text = formatExtractedValue(raw).trim();
  if (!text || text === "—") return null;
  return text;
}

/** ¿Ese resultado es una VENTA? Comparación exacta normalizada (ver arriba). */
export function isSaleOutcome(
  outcome: string | null,
  saleValues: ReadonlyArray<string> | undefined | null,
): boolean {
  if (!outcome || !saleValues || saleValues.length === 0) return false;
  const target = normalize(outcome);
  if (!target) return false;
  return saleValues.some((v) => normalize(String(v ?? "")) === target);
}

/**
 * Heurística de mapeo cuando el operador no eligió campo: se deduce del nombre
 * del extractor. El orden importa — `nombre_producto` es producto, no nombre.
 */
const FIELD_HINTS: Array<{ field: OrderField; words: string[] }> = [
  { field: "qty", words: ["cantidad", "unidades", "qty", "cuantos"] },
  { field: "product", words: ["producto", "product", "articulo", "item", "referencia"] },
  { field: "payment", words: ["pago", "payment", "metodo", "medio de pago"] },
  { field: "address", words: ["direccion", "address", "domicilio", "envio"] },
  { field: "city", words: ["ciudad", "city", "municipio", "localidad"] },
  { field: "phone", words: ["telefono", "celular", "movil", "phone", "whatsapp", "contacto"] },
  { field: "notes", words: ["nota", "observacion", "comentario", "detalle"] },
  { field: "name", words: ["nombre", "name", "cliente", "apellido"] },
];

/** Campo de la orden de un extractor: el elegido a mano, o el deducido. */
export function resolveOrderField(extractor: VoiceExtractor): OrderField | null {
  if (extractor.orderField) return extractor.orderField;
  if (extractor.outcome) return null; // el resultado no es un dato de la orden
  const id = normalize(extractor.identifier);
  for (const hint of FIELD_HINTS) {
    if (hint.words.some((w) => id.includes(w))) return hint.field;
  }
  return null;
}

/** Cantidad legible → entero >= 1. `"dos"` no se adivina: cae en 1. */
function parseQty(text: string): number {
  const digits = text.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 999) : 1;
}

export interface VoiceOrderDraft {
  /** Forma de `OrderDraft` para reusar el aviso de venta y el total. */
  draft: OrderDraft;
  /**
   * Método de pago tal como lo dijo el cliente (`"contra entrega"`). El backend
   * lo homologa contra los métodos del agente — son texto libre (ADR-0055).
   */
  paymentText: string | null;
  /** Nombre del producto dicho en la llamada, para resolver el SKU en la base. */
  productText: string | null;
}

/**
 * Convierte los datos extraídos en un borrador de orden. Puro: no resuelve SKU
 * (eso necesita la tabla `products`) ni el método (necesita el agente).
 */
export function buildOrderDraftFromCall(
  extractors: ReadonlyArray<VoiceExtractor>,
  extracted: ExtractedData,
): VoiceOrderDraft {
  const byField = new Map<OrderField, string>();
  const leftovers: string[] = [];

  for (const [identifier, value] of Object.entries(extracted)) {
    const extractor = extractors.find((e) => e.identifier === identifier);
    const text = formatExtractedValue(value as ExtractedValue).trim();
    if (!text || text === "—") continue;
    if (extractor?.outcome) continue; // el resultado ya se leyó aparte

    const field = extractor ? resolveOrderField(extractor) : guessFieldFromIdentifier(identifier);
    if (!field) {
      leftovers.push(`${humanizeIdentifier(identifier)}: ${text}`);
      continue;
    }
    // Si dos extractores apuntan al mismo campo, manda el primero y el otro
    // queda en notas (perder el dato sería peor que repetirlo).
    if (byField.has(field)) {
      leftovers.push(`${humanizeIdentifier(identifier)}: ${text}`);
      continue;
    }
    byField.set(field, text);
  }

  const product = byField.get("product") ?? null;
  const qty = byField.has("qty") ? parseQty(byField.get("qty")!) : 1;
  const notesParts = [byField.get("notes"), ...leftovers].filter(
    (s): s is string => Boolean(s && s.trim()),
  );

  return {
    draft: {
      items: product ? [{ sku: null, name: product, qty, unit_price: null }] : [],
      shipping: {
        name: byField.get("name") ?? null,
        address: byField.get("address") ?? null,
        city: byField.get("city") ?? null,
        phone: byField.get("phone") ?? null,
      },
      fulfillment_method: null,
      notes: notesParts.length > 0 ? notesParts.join(" · ") : null,
      total: null,
    },
    paymentText: byField.get("payment") ?? null,
    productText: product,
  };
}

/** Igual que `resolveOrderField`, pero para un identifier sin extractor configurado. */
function guessFieldFromIdentifier(identifier: string): OrderField | null {
  const id = normalize(identifier);
  for (const hint of FIELD_HINTS) {
    if (hint.words.some((w) => id.includes(w))) return hint.field;
  }
  return null;
}

/**
 * Homologa el método de pago dicho en la llamada contra los métodos del agente
 * (ADR-0055): compara con la etiqueta, la clave y el tag. Sin coincidencia
 * devuelve null → la orden queda `undecided` y se ve en el dashboard, en vez de
 * inventar un método que después cuadra mal en los reportes por método.
 */
export function matchPaymentText(
  paymentText: string | null,
  methods: ReadonlyArray<{ tag: string; label: string; method: string }>,
): string | null {
  if (!paymentText) return null;
  const target = normalize(paymentText);
  if (!target) return null;
  for (const m of methods) {
    const candidates = [m.label, m.method, m.tag.replace(/^#/, "").replace(/-/g, " ")];
    if (candidates.some((c) => normalize(String(c ?? "")) === target)) return m.method;
  }
  // Segundo intento, más flojo pero acotado a los métodos que el agente SÍ tiene:
  // "pago contra entrega" contra el método "contra entrega".
  for (const m of methods) {
    const label = normalize(m.label);
    if (label && (target.includes(label) || label.includes(target))) return m.method;
  }
  return null;
}

/** Extractor de resultado por defecto: lo que pidió el negocio. */
export function defaultOutcomeExtractor(): VoiceExtractor {
  return {
    identifier: "resultado_llamada",
    type: "SINGLE_CHOICE",
    condition:
      "En que termino la llamada: si el cliente confirmo la compra, si no le intereso, " +
      "si pidio que lo llamaran despues o si no se pudo hablar con el.",
    choices: ["compra", "no interesada", "volver a llamar", "no contesta"],
    examples: [],
    actionId: null,
    outcome: true,
    saleValues: ["compra"],
    orderField: null,
  };
}
