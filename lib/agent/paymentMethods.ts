/**
 * Métodos de pago POR AGENTE — lógica PURA (sin I/O), testeable directo.
 *
 * Cada agente define qué tags representan una compra según su mercado
 * (Colombia: `#compra-contra-entrega`, `#addi`; EE.UU.: `#zelle`; etc.). El backend
 * solo usa el tag para: quitarlo del texto que ve el cliente, fijar el método en la
 * conversación y generar la orden internamente — NO envía ninguna info extra. Los
 * tags de flujo universales (`#orden-lista`, `#humano`, `#llamada`) siguen cableados
 * en `lib/agent/tags.ts`. Ver ADR-0055.
 */

/** Método de pago configurado por un agente. */
export interface PaymentMethodConfig {
  /** Tag normalizado que emite el modelo, p. ej. `#zelle`. */
  tag: string;
  /** Nombre visible (aviso al dueño + reporte "por método"), p. ej. `Zelle`. */
  label: string;
  /** Clave estable guardada en `fulfillment_method`, p. ej. `zelle`. */
  method: string;
}

/** Valor sentinela: aún no se eligió método. NUNCA puede ser una clave de método. */
export const UNDECIDED_METHOD = "undecided";

/** Tope de métodos por agente (red de seguridad; el resto se recorta). */
export const MAX_PAYMENT_METHODS = 8;

/**
 * Métodos por defecto (Colombia). Se usan como valor inicial al crear un agente y
 * como seed de los agentes existentes en la migración 0025. Las claves `cod`/`addi`
 * coinciden con el histórico previo (enum) para no partir los reportes.
 */
export const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = [
  { tag: "#compra-contra-entrega", label: "Contra entrega", method: "cod" },
  { tag: "#addi", label: "Addi", method: "addi" },
];

/** Quita acentos y baja a minúsculas. */
function deburr(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** slug: minúsculas sin acentos, solo `[a-z0-9-]`, sin guiones colgantes. */
function slugify(raw: string): string {
  return deburr(raw)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normaliza un tag de pago: minúsculas, sin acentos, con un solo `#` inicial y solo
 * `[a-z0-9-]`. `"#Contra Entrega"` → `"#contra-entrega"`. Devuelve `""` si no queda
 * nada válido (para descartarlo).
 */
export function normalizePaymentTag(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const slug = slugify(raw.replace(/^#+/, ""));
  return slug ? `#${slug}` : "";
}

/** Clave de método (sin `#`) derivada de un texto. */
export function slugMethod(raw: unknown): string {
  return typeof raw === "string" ? slugify(raw.replace(/^#+/, "")) : "";
}

/** Etiqueta por defecto a partir del tag: `#contra-entrega` → `Contra entrega`. */
function defaultLabel(tag: string): string {
  const words = tag.replace(/^#/, "").split("-").filter(Boolean);
  if (words.length === 0) return "";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Normaliza el jsonb `agents.payment_methods` a una lista válida: descarta entradas
 * inválidas, normaliza el tag, deriva la `method` del tag si no viene explícita,
 * deduplica por tag y por método, y recorta a `MAX_PAYMENT_METHODS`. Nunca lanza:
 * cualquier cosa rara colapsa a `[]` (→ el agente queda sin métodos configurados).
 */
export function parsePaymentMethods(raw: unknown): PaymentMethodConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: PaymentMethodConfig[] = [];
  const seenTag = new Set<string>();
  const seenMethod = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const tag = normalizePaymentTag(rec.tag);
    if (!tag || seenTag.has(tag)) continue;
    const method =
      typeof rec.method === "string" && rec.method.trim() ? slugMethod(rec.method) : slugMethod(tag);
    // `undecided` es reservado; sin método no hay entrada. Método duplicado → se ignora.
    if (!method || method === UNDECIDED_METHOD || seenMethod.has(method)) continue;
    const label =
      typeof rec.label === "string" && rec.label.trim() ? rec.label.trim() : defaultLabel(tag);
    seenTag.add(tag);
    seenMethod.add(method);
    out.push({ tag, label, method });
  }
  return out.slice(0, MAX_PAYMENT_METHODS);
}

/**
 * ¿La línea (ya normalizada por el parser: sin viñetas ni markdown) es uno de los
 * tags de pago del agente? Compara sin distinguir mayúsculas. Devuelve el método que
 * matcheó o null.
 */
export function matchPaymentMethod(
  normalizedLine: string,
  methods: ReadonlyArray<PaymentMethodConfig>,
): PaymentMethodConfig | null {
  const line = normalizedLine.trim().toLowerCase();
  if (!line.startsWith("#")) return null;
  for (const m of methods) {
    if (m.tag === line) return m;
  }
  return null;
}

/** Mapa `method → label` a partir de una lista de métodos (para reportes/avisos). */
export function methodLabelMap(
  methods: ReadonlyArray<PaymentMethodConfig>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of methods) map[m.method] = m.label;
  return map;
}
