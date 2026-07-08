import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendText, sendVideo, type CallbellCreds } from "@/lib/callbell/sender";
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
  const filter = `agent_id.eq.${agentId},agent_id.is.null`;

  const withCaption = await supabase
    .from("videos")
    .select("id, keyword, video_url, caption")
    .eq("enabled", true)
    .or(filter);

  // Resiliencia a la ventana de migración:
  //  - 42P01 (tabla inexistente, falta 0016) → sin videos configurados.
  //  - 42703 (columna caption inexistente, falta 0017) → reintenta sin caption.
  if (withCaption.error && withCaption.error.code === "42P01") return [];
  if (withCaption.error && withCaption.error.code === "42703") {
    const noCaption = await supabase
      .from("videos")
      .select("id, keyword, video_url")
      .eq("enabled", true)
      .or(filter);
    if (noCaption.error) {
      if (noCaption.error.code === "42P01") return [];
      throw new Error(`loadKeywordVideos: ${noCaption.error.message}`);
    }
    return (noCaption.data ?? []).map((v) => ({
      id: v.id,
      keyword: v.keyword,
      videoUrl: v.video_url,
      caption: null,
    }));
  }
  if (withCaption.error) throw new Error(`loadKeywordVideos: ${withCaption.error.message}`);

  return (withCaption.data ?? []).map((v) => ({
    id: v.id,
    keyword: v.keyword,
    videoUrl: v.video_url,
    caption: v.caption,
  }));
}

/**
 * IDs de los videos que YA se enviaron en esta conversación. Es el marcador de
 * "ya se envió", leído del `events_log` (`keyword_video_sent`) en UNA consulta.
 * Se clave por **id de video** (no por URL), así que sobrevive a que se edite la
 * URL del video. Best-effort: ante un error devuelve un set vacío.
 */
async function loadSentVideoIds(supabase: DB, conversationId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("events_log")
    .select("payload")
    .eq("conversation_id", conversationId)
    .eq("type", "keyword_video_sent");
  const ids = new Set<string>();
  if (error) return ids;
  for (const row of data ?? []) {
    const p = row.payload as { videoId?: unknown } | null;
    if (p && typeof p === "object" && typeof p.videoId === "string") ids.add(p.videoId);
  }
  return ids;
}

/**
 * Si el texto de la respuesta menciona una palabra configurada, envía el video
 * correspondiente por Callbell **la PRIMERA vez que la palabra aparece** en una
 * respuesta de la conversación, y **NO** en las siguientes que la mencionen: cada
 * video se manda **una sola vez por conversación** (marcador por id en
 * `events_log.keyword_video_sent`). Best-effort: cualquier fallo se loguea y se
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

  // "Ya se envió": ids de videos mandados antes en esta conversación (1 consulta).
  const sentIds = await loadSentVideoIds(supabase, conversationId);
  // Guarda en memoria por URL: si dos palabras del MISMO turno apuntan al mismo
  // video, no lo mandes dos veces.
  const sentUrls = new Set<string>();

  for (const v of matched) {
    // Idempotencia: si este video YA se envió en la conversación, no repetir.
    if (sentIds.has(v.id) || sentUrls.has(v.videoUrl)) continue;

    try {
      // Caption: Callbell NO admite texto incrustado en video (solo en image), así
      // que va como un mensaje de TEXTO justo antes del video. Best-effort: si el
      // caption falla, igual se manda el video.
      const caption = v.caption?.trim();
      if (caption) {
        try {
          await sendText(creds, phone, caption, { metadata });
        } catch (e) {
          console.error(
            "[sendKeywordVideos] caption failed:",
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      const sent = await sendVideo(creds, phone, v.videoUrl, { metadata });
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        direction: "outbound",
        role: "assistant",
        type: "video",
        content: caption ?? null,
        media_url: v.videoUrl,
        tags: [v.keyword] as unknown as Json,
        callbell_message_uuid: sent.uuid,
      });
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "keyword_video_sent",
        payload: { videoId: v.id, keyword: v.keyword, uuid: sent.uuid } as unknown as Json,
      });
      sentUrls.add(v.videoUrl); // marca este turno (idempotencia intra-turno)
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
