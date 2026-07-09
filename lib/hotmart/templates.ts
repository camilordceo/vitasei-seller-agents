import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Plantillas de Hotmart editables desde el dashboard (tabla `hotmart_templates`).
 * Reemplazan el UUID por env + el texto hardcodeado. La resolución elige la mejor
 * plantilla para (agente, evento, producto) con prioridad y cae con gracia si la
 * tabla aún no existe (ventana de migración). Ver docs/17, ADR-0040.
 */

type DB = SupabaseClient<Database>;
export type HotmartTemplateRow = Database["public"]["Tables"]["hotmart_templates"]["Row"];

export const DEFAULT_HOTMART_EVENT = "PURCHASE_OUT_OF_SHOPPING_CART";

/**
 * Elige la mejor plantilla entre las candidatas (habilitadas y del evento). Puro.
 *
 * Prioridad (mayor gana): el **agente** pesa más que el producto porque el
 * `template_uuid` solo existe en la cuenta de Callbell de ese agente — una
 * plantilla de otra marca no serviría. A igual score, la más reciente.
 *   agente+producto (3) > agente+genérica (2) > global+producto (1) > global+genérica (0)
 */
export function pickHotmartTemplate(
  rows: HotmartTemplateRow[],
  opts: { agentId: string; productId: string | null },
): HotmartTemplateRow | null {
  const scored = rows
    .filter((r) => r.enabled)
    .map((r) => {
      // Un agente concreto solo aplica si coincide; una global (null) siempre.
      const agentOk = r.agent_id === null || r.agent_id === opts.agentId;
      // Un producto concreto solo aplica si coincide; genérica (null) siempre.
      const productOk = r.product_id === null || r.product_id === opts.productId;
      if (!agentOk || !productOk) return null;
      const score =
        (r.agent_id === opts.agentId ? 2 : 0) +
        (r.product_id !== null && r.product_id === opts.productId ? 1 : 0);
      return { row: r, score };
    })
    .filter((x): x is { row: HotmartTemplateRow; score: number } => x !== null);

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Desempate: la más reciente.
    return (b.row.created_at ?? "").localeCompare(a.row.created_at ?? "");
  });
  return scored[0].row;
}

/**
 * Interpola {{nombre}} y {{producto}} (y variantes {name}/{product}, en inglés y
 * con una o dos llaves) en el texto de la plantilla. Puro. Si `text` es null/vacío
 * devuelve "".
 */
export function renderHotmartMessage(
  text: string | null | undefined,
  vars: { name: string | null; product: string | null },
): string {
  if (!text) return "";
  const name = (vars.name ?? "").trim();
  const product = (vars.product ?? "").trim();
  return text
    .replace(/\{\{?\s*(nombre|name)\s*\}?\}/gi, name)
    .replace(/\{\{?\s*(producto|product)\s*\}?\}/gi, product);
}

/**
 * Deriva los `template_values` que se mandan a Callbell a partir de los tokens
 * `{{nombre}}`/`{{producto}}` que aparezcan EN ORDEN en el texto de la plantilla.
 * Pura. La cantidad y el orden deben coincidir con las variables `{{1}}`,`{{2}}`…
 * de la plantilla APROBADA en Callbell:
 *
 * - Plantilla de SOLO TEXTO (texto sin tokens) → `[]` → no se manda `template_values`
 *   (así una plantilla sin variables no falla por "parámetros de más").
 * - `{{nombre}}` → nombre del comprador; `{{producto}}` → nombre del producto.
 */
export function extractTemplateValues(
  messageText: string | null | undefined,
  vars: { name: string | null; product: string | null },
): string[] {
  if (!messageText) return [];
  const name = (vars.name ?? "").trim();
  const product = (vars.product ?? "").trim();
  const values: string[] = [];
  const re = /\{\{?\s*(nombre|name|producto|product)\s*\}?\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(messageText)) !== null) {
    const token = m[1].toLowerCase();
    values.push(token === "nombre" || token === "name" ? name : product);
  }
  return values;
}

/**
 * Resuelve la plantilla de Hotmart para (agente, evento, producto) desde la base.
 * Resiliente: si la tabla no existe todavía (42P01, falta la migración 0019),
 * devuelve null y el llamador cae al fallback por env. Cualquier otro error se
 * propaga (es un problema real de la consulta).
 */
export async function resolveHotmartTemplate(
  supabase: DB,
  opts: { agentId: string; eventType?: string; productId: string | null },
): Promise<HotmartTemplateRow | null> {
  const eventType = opts.eventType ?? DEFAULT_HOTMART_EVENT;

  const { data, error } = await supabase
    .from("hotmart_templates")
    .select("*")
    .eq("event_type", eventType)
    .eq("enabled", true);

  if (error) {
    if (error.code === "42P01") return null; // tabla ausente → fallback a env
    throw new Error(`resolveHotmartTemplate: ${error.message}`);
  }

  return pickHotmartTemplate((data ?? []) as HotmartTemplateRow[], {
    agentId: opts.agentId,
    productId: opts.productId,
  });
}
