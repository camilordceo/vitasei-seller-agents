import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendVideo, type CallbellCreds } from "@/lib/callbell/sender";
import { matchVideos, type VideoRule } from "./videoMatch";
import type { Database, Json } from "@/lib/supabase/types";

type DB = SupabaseClient<Database>;

/**
 * Videos por palabra clave (docs/20, ADR-0038). Cuando la RESPUESTA del bot
 * menciona una palabra configurada, se envía un video por Callbell después de la
 * respuesta. Best-effort: NADA de esto rompe el flujo de la respuesta.
 */

/** Carga los videos habilitados del agente + los globales (agent_id null). */
export async function loadKeywordVideos(supabase: DB, agentId: string): Promise<VideoRule[]> {
  const { data, error } = await supabase
    .from("videos")
    .select("id, keyword, video_url")
    .eq("enabled", true)
    .or(`agent_id.eq.${agentId},agent_id.is.null`);
  // Si aún no se aplicó la migración 0016 (tabla inexistente, 42P01), no hay
  // videos configurados → no es un error, simplemente no se envía nada.
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`loadKeywordVideos: ${error.message}`);
  }
  return (data ?? []).map((v) => ({ id: v.id, keyword: v.keyword, videoUrl: v.video_url }));
}

/**
 * Si el texto de la respuesta menciona una palabra configurada, envía el/los
 * video(s) correspondiente(s) por Callbell — UNA sola vez por conversación
 * (idempotencia por `media_url`). Best-effort: cualquier fallo se loguea y se
 * sigue (nunca lanza). Se invoca tras enviar la respuesta normal (no en handoff).
 */
export async function sendKeywordVideos(
  supabase: DB,
  creds: CallbellCreds,
  args: {
    conversationId: string;
    phone: string;
    agentId: string;
    /** Texto que vio el cliente (parsed.cleanText). */
    replyText: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { conversationId, phone, agentId, replyText, metadata } = args;
  if (!replyText || !replyText.trim()) return;

  let rules: VideoRule[];
  try {
    rules = await loadKeywordVideos(supabase, agentId);
  } catch (e) {
    console.error("[sendKeywordVideos] load failed:", e instanceof Error ? e.message : String(e));
    return;
  }
  if (rules.length === 0) return;

  const matched = matchVideos(replyText, rules);
  if (matched.length === 0) return;

  for (const v of matched) {
    // Idempotencia: si ya se envió ESTE video en la conversación, no repetir.
    const { data: already } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("type", "video")
      .eq("media_url", v.videoUrl)
      .limit(1)
      .maybeSingle();
    if (already) continue;

    try {
      const sent = await sendVideo(creds, phone, v.videoUrl, { metadata });
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        direction: "outbound",
        role: "assistant",
        type: "video",
        content: null,
        media_url: v.videoUrl,
        tags: [v.keyword] as unknown as Json,
        callbell_message_uuid: sent.uuid,
      });
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "keyword_video_sent",
        payload: { videoId: v.id, keyword: v.keyword, uuid: sent.uuid } as unknown as Json,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[sendKeywordVideos] send failed:", message);
      await supabase
        .from("events_log")
        .insert({
          conversation_id: conversationId,
          type: "keyword_video_failed",
          payload: { videoId: v.id, keyword: v.keyword, error: message } as unknown as Json,
        })
        .then(() => undefined, () => undefined);
    }
  }
}
