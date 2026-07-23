/**
 * Variables de una llamada: `{producto}` en el saludo, en el prompt o en el
 * objetivo. Módulo PURO (sin I/O), como `voiceCallPlan`.
 *
 * Por qué resolvemos las llaves NOSOTROS y no Synthflow:
 * Synthflow acepta `custom_variables` y su documentación dice que se referencian
 * con llaves (`{producto}`), pero **solo lo documenta para el prompt** — del
 * saludo no dice nada. Y el saludo es justo donde el negocio las quiere:
 * "Hola, soy Vanessa de Vitasei. Te llamaba porque estabas interesado en
 * {producto}, ¿tienes un minuto?". Como el saludo y el prompt viajan por llamada
 * (ADR-0060), aquí los dejamos ya resueltos y el `custom_variables` va igual,
 * por si el assistant referencia algo en SU propio prompt. Ver ADR-0086.
 *
 * La otra razón es más dura: si Synthflow no reemplaza, el bot **lee la llave en
 * voz alta** ("estabas interesado en llave producto"). Eso no se descubre en una
 * prueba: se descubre cuando ya llamaste a 300 personas.
 */

/** Tope de una variable: nombres y productos, no párrafos. */
const MAX_VALUE_LENGTH = 200;

/**
 * Nombre de variable → clave canónica. Sin tildes, minúsculas y `_`, para que
 * la columna "Producto Interesado" del Excel y el `{producto interesado}` que
 * el operador escribió en el saludo sean la MISMA variable.
 */
export function normalizeVariableKey(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * Placeholders de un texto. Acepta `{producto}` y `{{producto}}` (la gente
 * escribe las dos), y tolera espacios adentro. Devuelve las claves canónicas,
 * sin repetir y en orden de aparición.
 */
export function templateVariables(text: string): string[] {
  const out: string[] = [];
  const source = String(text ?? "");
  const re = /\{\{?\s*([^{}]+?)\s*\}?\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const key = normalizeVariableKey(match[1]);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Mapa de variables con las claves canónicas y los valores recortados. */
export function normalizeVariables(vars: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(vars ?? {})) {
    const key = normalizeVariableKey(rawKey);
    if (!key) continue;
    const value = String(rawValue ?? "").trim();
    if (!value) continue; // una variable vacía es una variable que falta
    out[key] = value.slice(0, MAX_VALUE_LENGTH);
  }
  return out;
}

/** Variables que el texto usa y NADIE llenó. Es lo que bloquea una campaña. */
export function missingVariables(text: string, vars: Record<string, unknown>): string[] {
  const values = normalizeVariables(vars);
  return templateVariables(text).filter((key) => !values[key]);
}

/**
 * Reemplaza `{variable}` por su valor.
 *
 * Lo que falta se BORRA (no se deja la llave cruda) y después se limpian los
 * dobles espacios y la puntuación que queda huérfana: "interesado en  , ¿tienes"
 * → "interesado en, ¿tienes". Es una red de seguridad, no el camino normal: el
 * dashboard valida antes de lanzar. Entre un saludo con una frase corta y un bot
 * diciendo "llave producto llave", gana el primero.
 */
export function renderTemplate(
  text: string,
  vars: Record<string, unknown>,
  opts?: { onMissing?: "blank" | "keep" },
): string {
  const source = String(text ?? "");
  if (!source) return "";
  const values = normalizeVariables(vars);
  const keep = opts?.onMissing === "keep";

  const replaced = source.replace(/\{\{?\s*([^{}]+?)\s*\}?\}/g, (whole, name: string) => {
    const key = normalizeVariableKey(name);
    const value = key ? values[key] : undefined;
    if (value != null) return value;
    return keep ? whole : "";
  });

  return replaced
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([¿¡])\s+/g, "$1")
    .replace(/ +\n/g, "\n")
    .trim();
}
