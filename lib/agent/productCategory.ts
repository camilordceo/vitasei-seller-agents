import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadKeywordVideos } from "./videos";
import { matchVideos } from "./videoMatch";
import type { Database, Json } from "@/lib/supabase/types";

type DB = SupabaseClient<Database>;

/**
 * Autodetecta el PRODUCTO/fuente de la conversación (docs/21). Busca palabras
 * clave (reutiliza el catálogo de `videos`, ej. "magnesio", "colageno") en el
 * texto del cliente + la respuesta del bot y fija `conversations.product_category`
 * con la PRIMERA que aparezca — solo si la conversación aún NO tiene categoría (no
 * pisa una asignada a mano). Best-effort: nunca lanza. Resiliente si falta la
 * migración 0018 (columna) o si no hay videos configurados.
 */
export async function detectProductCategory(
  supabase: DB,
  args: { conversationId: string; agentId: string; clientText: string; replyText: string },
): Promise<void> {
  const { conversationId, agentId, clientText, replyText } = args;
  try {
    // ¿Ya tiene categoría? Si la columna no existe (falta 0018), 42703 → salir.
    const { data: convo, error } = await supabase
      .from("conversations")
      .select("product_category")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) return; // best-effort (incluye 42703)
    if (convo?.product_category && convo.product_category.trim()) return; // no pisar

    const rules = await loadKeywordVideos(supabase, agentId); // catálogo de palabras
    if (rules.length === 0) return;

    const matched = matchVideos(`${clientText}\n${replyText}`, rules);
    const category = matched[0]?.keyword.trim();
    if (!category) return;

    const { error: updErr } = await supabase
      .from("conversations")
      .update({ product_category: category })
      .eq("id", conversationId);
    if (updErr) return; // 42703 u otro → best-effort

    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "product_category_detected",
      payload: { category } as unknown as Json,
    });
  } catch (e) {
    console.error("[detectProductCategory]", e instanceof Error ? e.message : String(e));
  }
}
