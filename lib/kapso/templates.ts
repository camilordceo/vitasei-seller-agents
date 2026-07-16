/**
 * Plantillas de WhatsApp en Kapso — lógica PURA (sin I/O), testeable.
 *
 * Diferencia clave con Callbell: Callbell referencia una plantilla por su `uuid`;
 * Kapso (proxy de Meta) la referencia por **nombre + idioma**. Para no agregar una
 * columna por proveedor, el campo que ya existe en la base
 * (`hotmart_templates.template_uuid`, `agents.reactivation_template_7d/15d`) pasa a
 * ser "la referencia de plantilla DEL PROVEEDOR": un uuid en Callbell, un nombre en
 * Kapso. Ver ADR-0056 §Reuso de columnas.
 */

/** Idioma por defecto si el agente no configuró ninguno. */
export const DEFAULT_TEMPLATE_LANGUAGE = "es";

export interface ParsedTemplateRef {
  /** Nombre de la plantilla aprobada en Meta. */
  name: string;
  /** Código de idioma (`es`, `es_CO`, `en_US`). */
  language: string;
}

/**
 * Interpreta la referencia guardada en la base. Puro.
 *
 * - `carrito_abandonado` → usa el idioma del agente.
 * - `carrito_abandonado:es_CO` → fuerza ese idioma (una plantilla puntual puede
 *   estar aprobada en otro idioma que el resto de las del agente).
 *
 * El separador es `:` porque Meta solo admite `[a-z0-9_]` en los nombres, así que
 * nunca puede aparecer dentro del nombre.
 */
export function parseTemplateRef(ref: string, defaultLanguage?: string | null): ParsedTemplateRef {
  const fallback = (defaultLanguage ?? "").trim() || DEFAULT_TEMPLATE_LANGUAGE;
  const raw = (ref ?? "").trim();
  const sep = raw.indexOf(":");
  if (sep === -1) return { name: raw, language: fallback };

  const name = raw.slice(0, sep).trim();
  const language = raw.slice(sep + 1).trim();
  return { name, language: language || fallback };
}

/** Un componente de plantilla con la forma de la Cloud API de Meta. */
export type TemplateComponent = Record<string, unknown>;

/**
 * Arma los `components` de la plantilla. Puro.
 *
 * - `imageUrl` → componente `header` con un parámetro de imagen (ADR-0044: las
 *   plantillas de reactivación pueden llevar header de imagen).
 * - `values` → componente `body` con las variables **posicionales** ({{1}}, {{2}}…),
 *   en el mismo orden en que `extractTemplateValues` las derivó del texto. Es el
 *   equivalente exacto de los `template_values` de Callbell, así que una plantilla
 *   migrada de un proveedor al otro conserva el orden de sus variables.
 *
 * Sin imagen ni variables devuelve `[]` → el envío va sin `components` (una plantilla
 * sin variables falla si se le mandan parámetros de más).
 */
export function buildTemplateComponents(opts: {
  values: readonly string[];
  imageUrl?: string | null;
}): TemplateComponent[] {
  const components: TemplateComponent[] = [];

  if (opts.imageUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: opts.imageUrl } }],
    });
  }

  if (opts.values.length > 0) {
    components.push({
      type: "body",
      parameters: opts.values.map((text) => ({ type: "text", text })),
    });
  }

  return components;
}
