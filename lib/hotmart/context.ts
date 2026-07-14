import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  resolveHotmartTemplate,
  renderHotmartMessage,
  DEFAULT_HOTMART_EVENT,
} from "./templates";

/**
 * Contexto de Hotmart para la IA — la plantilla que YA se le envió al cliente.
 *
 * El problema: la plantilla de carrito abandonado se manda desde el webhook, FUERA
 * de la cadena de Responses (`previous_response_id`). Queda en `messages` (se ve en
 * el panel), pero la IA nunca la vio. Cuando el cliente respondía ("¿cuánto vale?"),
 * el modelo recibía solo esa frase suelta: no sabía qué curso le ofreció ni qué le
 * dijo, y arrancaba de cero.
 *
 * La solución (mismo patrón que `prependContactContext`): antes de generar, se
 * **antepone** al texto del turno un bloque con el curso (id + nombre de Hotmart) y
 * el texto EXACTO de la plantilla enviada. Ese bloque viaja en el `input` de la
 * llamada a Responses, así que a partir de ese momento queda dentro de la cadena y
 * no hace falta reinyectarlo. NO se guarda en `messages`: el hilo del panel y la
 * extracción de la orden quedan limpios.
 *
 * Ver: docs/17-hotmart-carritos.md, ADR-0051.
 */

type DB = SupabaseClient<Database>;

/** Tag con el que se guarda el outbound de la plantilla (fuente única de verdad). */
export const HOTMART_RECOVERY_TAG = "hotmart-recovery";

/**
 * Texto de respaldo que `sendHotmartTemplate` guarda cuando la plantilla no trae
 * texto configurado (envío por env, legado). No sirve como contexto: si el mensaje
 * guardado empieza así, se re-resuelve la plantilla por producto.
 */
const PLACEHOLDER_PREFIX = "[Plantilla Hotmart:";

export interface HotmartSentTemplate {
  /** ID del producto en Hotmart (el `data.product.id` del webhook). */
  productId: string | null;
  /** Nombre del curso en Hotmart. */
  productName: string | null;
  /** Texto EXACTO que se le envió al cliente (ya interpolado). */
  sentText: string;
}

/**
 * ¿Este outbound es la plantilla de recuperación de Hotmart? `tags` es jsonb, así
 * que puede venir como array, null o (defensivo) un string suelto. Pura.
 */
export function hasRecoveryTag(tags: unknown): boolean {
  if (typeof tags === "string") return tags === HOTMART_RECOVERY_TAG;
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => typeof t === "string" && t === HOTMART_RECOVERY_TAG);
}

/**
 * Bloque de contexto que se antepone al turno del cliente. Cadena vacía si no hay
 * nada que aportar (ni curso ni texto). Pura y sin IO.
 *
 * Es contexto interno: se le pide a la IA que no lo mencione y que NO repita la
 * plantilla (el cliente ya la recibió y está respondiendo a ella).
 */
export function formatHotmartContext(sent: HotmartSentTemplate): string {
  const name = (sent.productName ?? "").trim();
  const id = (sent.productId ?? "").trim();
  const text = sent.sentText.trim();
  if (!name && !id && !text) return "";

  const course = name
    ? `del curso "${name}"${id ? ` (id de Hotmart ${id})` : ""}`
    : id
      ? `del curso con id de Hotmart ${id}`
      : "de un curso";

  const parts = [
    `[Contexto interno (no lo menciones ni digas que lo recibiste): esta ` +
      `conversación viene de un carrito abandonado de Hotmart ${course}.`,
  ];
  if (text) {
    parts.push(
      `Tú ya le enviaste ESTE mensaje por WhatsApp y el cliente te está ` +
        `respondiendo a él:\n"""\n${text}\n"""\nNo lo repitas ni vuelvas a ` +
        `presentarte: continúa la conversación desde ahí.`,
    );
  }
  parts.push(
    `El curso de esta conversación es ese; no ofrezcas otro salvo que el cliente lo pida.]`,
  );
  return parts.join("\n");
}

/**
 * Antepone el bloque de contexto de Hotmart al texto del turno. Pura.
 * - Bloque vacío → texto tal cual.
 * - Texto vacío (turno de solo imagen) → solo el bloque.
 */
export function prependHotmartContext(text: string, block: string): string {
  if (!block) return text;
  if (text.trim().length === 0) return block;
  return `${block}\n\n${text}`;
}

/**
 * Lee de la base la plantilla de Hotmart que se le envió al cliente y devuelve el
 * bloque de contexto listo para anteponer. Cadena vacía si no aplica.
 *
 * Solo inyecta cuando el ÚLTIMO outbound de la conversación es la plantilla (tag
 * `hotmart-recovery`): eso significa que la IA todavía no ha respondido desde que se
 * envió y, por lo tanto, el texto NO está en la cadena de Responses. En cuanto la IA
 * responde una vez, el bloque ya viajó en el `input` y quedó encadenado, así que
 * dejamos de inyectarlo (no se duplica ni se gastan tokens de más).
 *
 * El gate es el TAG, no `conversations.hotmart_flow`: así funciona aunque la
 * migración 0019 no esté aplicada.
 */
export async function loadHotmartReplyContext(
  supabase: DB,
  opts: { conversationId: string; agentId: string },
): Promise<string> {
  const { data: lastOut, error: outErr } = await supabase
    .from("messages")
    .select("content, tags")
    .eq("conversation_id", opts.conversationId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (outErr) throw new Error(`loadHotmartReplyContext outbound: ${outErr.message}`);
  // Sin outbound, o el último no es la plantilla → ya respondimos: está en la cadena.
  if (!lastOut || !hasRecoveryTag(lastOut.tags)) return "";

  // El curso sale del evento de Hotmart más reciente de esta conversación (si el
  // cliente abandona otro carrito, el nuevo evento manda). Ver ADR-0051.
  const { data: event, error: evErr } = await supabase
    .from("hotmart_events")
    .select("product_id, product_name, buyer_name")
    .eq("conversation_id", opts.conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (evErr) throw new Error(`loadHotmartReplyContext event: ${evErr.message}`);

  const productId = event?.product_id ?? null;
  const productName = event?.product_name ?? null;

  // Texto enviado: el que quedó guardado en `messages`. Si es el respaldo (envío por
  // env sin texto configurado), se re-resuelve la plantilla POR PRODUCTO —la misma
  // búsqueda del webhook: `data.product.id` → `hotmart_templates.product_id`— para
  // que el contexto sea la plantilla real de ESE curso.
  let sentText = (lastOut.content ?? "").trim();
  if (!sentText || sentText.startsWith(PLACEHOLDER_PREFIX)) {
    const tpl = await resolveHotmartTemplate(supabase, {
      agentId: opts.agentId,
      eventType: DEFAULT_HOTMART_EVENT,
      productId,
    });
    sentText = renderHotmartMessage(tpl?.message_text, {
      name: event?.buyer_name ?? null,
      product: productName,
    }).trim();
  }

  return formatHotmartContext({ productId, productName, sentText });
}
