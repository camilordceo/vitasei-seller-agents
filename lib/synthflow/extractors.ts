/**
 * Normalización de los Information Extractors de Synthflow.
 *
 * Módulo PURO (sin I/O) — se testea con los payloads REALES capturados de la
 * cuenta (977 objetos `executed_actions` de llamadas de producción, 2026-07-18).
 *
 * La forma documentada por Synthflow NO es la forma real. Ver ADR-0062 y
 * docs/25 §2.5. Las cuatro trampas que este módulo absorbe:
 *
 *   1. `return_value` es un STRING con JSON adentro, no un objeto:
 *        "return_value": "{\"telefonocelular\": \"387506619\"}"
 *   2. Conviven DOS prefijos de clave: `extract_info_<id>` (histórico) e
 *      `info_extractor_<id>` (el que genera la API hoy).
 *   3. El identifier puede tener ESPACIOS (`info_extractor_nombre y apellido`),
 *      así que no se deduce de la clave externa: se lee la clave de adentro.
 *   4. El valor no siempre es escalar: `{}`, null, string, número, objeto y
 *      objeto anidado en dos niveles, todos observados en datos reales.
 */

/** Prefijos con los que Synthflow nombra las acciones de extracción. */
const KEY_PREFIXES = ["extract_info_", "info_extractor_"] as const;

/** `action_type` que identifica una extracción (el otro visto es custom_function). */
const EXTRACTOR_ACTION_TYPE = "extract_info_action_type";

/** Valor extraído: Synthflow devuelve escalares u objetos anidados. */
export type ExtractedValue = string | number | boolean | null | Record<string, unknown>;

/** Resultado normalizado: `{ identifier: valor }`. */
export type ExtractedData = Record<string, ExtractedValue>;

/** Quita el prefijo de la clave externa. Devuelve null si no tiene ninguno. */
export function stripExtractorPrefix(key: string): string | null {
  for (const prefix of KEY_PREFIXES) {
    if (key.startsWith(prefix)) return key.slice(prefix.length);
  }
  return null;
}

/**
 * `JSON.parse` que nunca lanza. Synthflow manda `return_value` como string;
 * si algún día lo manda como objeto (o manda basura), no debe tumbar el cierre
 * de la llamada.
 */
function parseMaybeJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "object") return raw; // ya viene parseado
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // No es JSON: se conserva el texto crudo, que es mejor que perder el dato.
    return trimmed;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Saca el valor de un `return_value` ya parseado.
 *
 * Se prefiere la clave que coincide con el identifier esperado; si no está
 * (identifier con espacios, mayúsculas, o renombrado en Synthflow), se cae a la
 * ÚNICA clave del objeto. Con 0 claves (`{}` — visto seguido) el dato no se
 * extrajo: se devuelve `undefined` para poder omitirlo.
 */
function readReturnValue(parsed: unknown, identifier: string): ExtractedValue | undefined {
  if (parsed === null) return undefined;
  if (!isPlainObject(parsed)) {
    // Un escalar suelto (no observado, pero barato de tolerar).
    return parsed as ExtractedValue;
  }
  const keys = Object.keys(parsed);
  if (keys.length === 0) return undefined; // `{}` = no se extrajo nada

  // `null` explícito (`{"id": null}`, muy común) significa "no se extrajo" igual
  // que `{}`. Se distingue de `false` y `0`, que SÍ son datos válidos.
  const dataOrUndefined = (v: unknown): ExtractedValue | undefined =>
    v === null || v === undefined ? undefined : (v as ExtractedValue);

  if (identifier in parsed) return dataOrUndefined(parsed[identifier]);

  // Tolerancia a diferencias de forma del identifier (espacios, caso).
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, "");
  const target = norm(identifier);
  const match = keys.find((k) => norm(k) === target);
  if (match) return dataOrUndefined(parsed[match]);

  // Una sola clave: es el valor, aunque el nombre no case.
  if (keys.length === 1) return dataOrUndefined(parsed[keys[0]]);

  // Varias claves y ninguna casa: el objeto entero ES el dato.
  return parsed as ExtractedValue;
}

/**
 * Convierte el `executed_actions` de Synthflow en `{ identifier: valor }`.
 *
 * Se omiten las entradas sin dato (`{}` o `null`) para que `extracted` no se
 * llene de nulls: "no se extrajo" se representa con la ausencia de la clave.
 * Nunca lanza: ante cualquier forma inesperada devuelve lo que pudo rescatar.
 */
export function parseExecutedActions(raw: unknown): ExtractedData {
  const out: ExtractedData = {};
  if (!isPlainObject(raw)) return out;

  for (const [key, action] of Object.entries(raw)) {
    if (!isPlainObject(action)) continue;

    // Solo extracciones: el workspace también tiene custom_function_action_type.
    const actionType = typeof action.action_type === "string" ? action.action_type : "";
    const looksLikeExtractor =
      actionType === EXTRACTOR_ACTION_TYPE || stripExtractorPrefix(key) !== null;
    if (!looksLikeExtractor) continue;

    // El identifier real vive dentro de `parameters_hard_coded` (también string
    // con JSON). La clave externa es el fallback.
    const params = parseMaybeJson(action.parameters_hard_coded);
    const fromParams =
      isPlainObject(params) && typeof params.identifier === "string" ? params.identifier : null;
    const identifier = fromParams ?? stripExtractorPrefix(key) ?? key;

    const value = readReturnValue(parseMaybeJson(action.return_value), identifier);
    if (value === undefined) continue; // no se extrajo nada en esta llamada

    out[identifier] = value;
  }

  return out;
}

/**
 * Aplana un valor extraído a una línea legible para la nota de la conversación
 * y la tabla del dashboard. Los objetos anidados se muestran `clave: valor`.
 */
export function formatExtractedValue(value: ExtractedValue): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() || "—";
  if (isPlainObject(value)) {
    const parts = Object.entries(value).map(
      ([k, v]) => `${k}: ${formatExtractedValue(v as ExtractedValue)}`,
    );
    return parts.join(", ") || "—";
  }
  return String(value);
}

/** Etiqueta legible de un identifier (`metodo_pago` → `Metodo pago`). */
export function humanizeIdentifier(identifier: string): string {
  const clean = identifier.replace(/[_\s]+/g, " ").trim();
  if (!clean) return identifier;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
