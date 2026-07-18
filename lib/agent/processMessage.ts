import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase/server";
import { createOpenAIClient } from "@/lib/openai/client";
import { generateReply } from "@/lib/openai/responses";
import { transcribeAudioUrl } from "@/lib/openai/transcribe";
import { audioCostUsd } from "@/lib/openai/pricing";
import type { OrderDraft } from "@/lib/openai/extractOrder";
import { parseReply } from "@/lib/agent/tags";
import { applyGate } from "@/lib/agent/gate";
import { prependContactContext } from "@/lib/agent/contactContext";
import { kindFromUrl, toDataUrl } from "@/lib/messaging/media";
import { fetchMedia, type MediaAuth } from "@/lib/messaging/mediaFetch";
import type { MessagingProvider } from "@/lib/messaging/types";
import {
  loadAgentForConversation,
  loadPaymentMethods,
  agentMediaAuth,
  agentTeamUuid,
  agentVectorStoreId,
  providerForAgent,
  type Agent,
} from "@/lib/agent/agents";
import { methodLabelMap, UNDECIDED_METHOD } from "@/lib/agent/paymentMethods";
import { extractOrder } from "@/lib/openai/extractOrder";
import { scheduleRetargets, cancelScheduledRetargets } from "@/lib/agent/retarget";
import { sendKeywordVideos } from "@/lib/agent/videos";
import { detectProductCategory } from "@/lib/agent/productCategory";
import { scheduleReactivations, cancelScheduledReactivations } from "@/lib/agent/reactivation";
import { isAgentActiveNow } from "@/lib/agent/schedule";
import {
  buildSaleNotification,
  buildTranscript,
  computeOrderTotal,
  hasOrderData,
  isPurchaseConfirmation,
  normalizeOrderItem,
  resolveFulfillmentMethod,
  type TranscriptMessage,
} from "@/lib/agent/order";
import { buildCallRequestNotification } from "@/lib/agent/callRequest";
import { appendHotmartMarker } from "@/lib/hotmart/flow";
import { loadHotmartReplyContext, prependHotmartContext } from "@/lib/hotmart/context";
import { env } from "@/lib/env";
import type { Database, Json, MessageType } from "@/lib/supabase/types";

type DB = SupabaseClient<Database>;
type ContactUpdate = Database["public"]["Tables"]["contacts"]["Update"];
type ConversationUpdate = Database["public"]["Tables"]["conversations"]["Update"];

interface ProductLookup {
  sku: string;
  image_url: string | null;
  name: string | null;
}

/** Payload normalizado que el webhook extrae del body de Callbell. */
export interface InboundMessage {
  /** Teléfono normalizado E.164 sin '+' (ej: 573001234567). */
  phone: string;
  /** UUID del mensaje en Callbell — clave de idempotencia y del debounce. */
  messageUuid: string;
  /** Agente (marca/número) al que pertenece este inbound. Ver docs/16. */
  agentId: string;
  text: string | null;
  messageType: string | null;
  /** URL del adjunto (imagen/audio/…) si el mensaje trae media. Ver docs/15. */
  mediaUrl: string | null;
  contactName: string | null;
  callbellContactUuid: string | null;
  conversationHref: string | null;
  /** Body crudo del webhook (trazabilidad / refinar el parser). */
  raw: unknown;
  /** epoch ms del inbound (para la ventana de 24h). */
  receivedAt: number;
}

export interface IngestResult {
  conversationId: string;
  contactId: string;
  duplicate: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mapea el `type` de Callbell a nuestro enum `message_type` de Supabase. */
function toMessageType(type: string | null): MessageType {
  switch (type) {
    case "text":
    case "image":
    case "audio":
    case "video":
    case "document":
      return type;
    default:
      return "other";
  }
}

/**
 * Tipo REAL de un mensaje ya guardado, para decidir cómo procesarlo.
 *
 * Red de seguridad contra la deriva de proveedores: si el mensaje quedó como
 * `other` pero tiene adjunto, el `type` del webhook no sirvió (Callbell no manda
 * `type`; Kapso podría mandar `voice`/`ptt`/lo que sea mañana) y sin esto el
 * adjunto se descarta en silencio — que es exactamente el bug que teníamos. La
 * extensión de la URL manda en ese caso.
 *
 * Solo corrige hacia arriba: un `type` que ya es útil nunca se pisa, y un `other`
 * sin adjunto (un texto mal tipado) se queda igual.
 */
function effectiveType(stored: MessageType, mediaUrl: string | null): MessageType {
  if (stored !== "other" || !mediaUrl) return stored;
  const kind = kindFromUrl(mediaUrl);
  return kind === "other" ? stored : kind;
}

/**
 * FASE 1 — ingesta (síncrona, dentro del request del webhook).
 *
 * Idempotencia por `callbell_message_uuid`, get-or-create de contacto y
 * conversación, guarda el inbound y marca la conversación con el uuid del
 * mensaje MÁS reciente (`last_inbound_message_uuid`) — el "quién gana" del
 * debounce. No genera respuesta: eso es la fase 2 (`runDebouncedReply`).
 */
export async function ingestInboundMessage(msg: InboundMessage): Promise<IngestResult> {
  const {
    phone,
    messageUuid,
    agentId,
    text,
    messageType,
    mediaUrl,
    contactName,
    callbellContactUuid,
    conversationHref,
    raw,
    receivedAt,
  } = msg;

  const supabase = createServiceClient();

  // 1) Idempotencia: si ya existe un mensaje con este uuid, no reprocesar.
  const { data: dup, error: dupErr } = await supabase
    .from("messages")
    .select("id, conversation_id")
    .eq("callbell_message_uuid", messageUuid)
    .maybeSingle();
  if (dupErr) throw new Error(`idempotency-check: ${dupErr.message}`);

  // 2) Contact: get-or-create por phone.
  let contactId: string;
  {
    const { data: existing, error: selErr } = await supabase
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (selErr) throw new Error(`upsert-contact select: ${selErr.message}`);

    if (existing) {
      const patch: ContactUpdate = {};
      if (contactName) patch.name = contactName;
      if (callbellContactUuid) patch.callbell_contact_uuid = callbellContactUuid;
      if (Object.keys(patch).length > 0) {
        const { error: updErr } = await supabase
          .from("contacts")
          .update(patch)
          .eq("id", existing.id);
        if (updErr) throw new Error(`upsert-contact update: ${updErr.message}`);
      }
      contactId = existing.id;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("contacts")
        .insert({ phone, name: contactName, callbell_contact_uuid: callbellContactUuid })
        .select("id")
        .single();
      if (insErr) throw new Error(`upsert-contact insert: ${insErr.message}`);
      contactId = inserted.id;
    }
  }

  // 3) Conversación: get-or-create la activa; actualizar last_inbound_at y el
  //    marcador del debounce (último mensaje).
  const nowIso = new Date(receivedAt).toISOString();
  let conversationId: string;
  let conversationIsNew = false;
  {
    // Scope por agente: un mismo teléfono puede hablarle a dos marcas → una
    // conversación activa por (contacto, agente). Ver docs/16.
    const { data: existing, error: selErr } = await supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("agent_id", agentId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selErr) throw new Error(`upsert-conversation select: ${selErr.message}`);

    if (existing) {
      const patch: ConversationUpdate = {
        last_inbound_at: nowIso,
        last_inbound_message_uuid: messageUuid,
      };
      if (conversationHref) patch.callbell_conversation_href = conversationHref;
      const { error: updErr } = await supabase
        .from("conversations")
        .update(patch)
        .eq("id", existing.id);
      if (updErr) throw new Error(`upsert-conversation update: ${updErr.message}`);
      conversationId = existing.id;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("conversations")
        .insert({
          contact_id: contactId,
          agent_id: agentId,
          status: "active",
          last_inbound_at: nowIso,
          last_inbound_message_uuid: messageUuid,
          callbell_conversation_href: conversationHref,
        })
        .select("id")
        .single();
      if (insErr) throw new Error(`upsert-conversation insert: ${insErr.message}`);
      conversationId = inserted.id;
      conversationIsNew = true;
    }
  }

  // Duplicado: ya estaba guardado. Devolvemos la conversación pero sin re-guardar
  // ni re-programar respuesta.
  if (dup) {
    return { conversationId: dup.conversation_id ?? conversationId, contactId, duplicate: true };
  }

  // 4) Guardar el inbound (el unique en callbell_message_uuid respalda idempotencia).
  {
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      direction: "inbound",
      role: "user",
      type: toMessageType(messageType),
      content: text,
      media_url: mediaUrl,
      callbell_message_uuid: messageUuid,
    });
    if (error) throw new Error(`save-inbound-message: ${error.message}`);
  }

  // 5) LOG: webhook_received con el body crudo.
  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "webhook_received",
    payload: { phone, messageUuid, raw } as unknown as Json,
  });

  // 6) Retargeting: el cliente respondió → cancela seguimientos pendientes. La
  //    próxima respuesta del bot reagenda. Best-effort: nunca tumba la ingesta.
  try {
    await cancelScheduledRetargets(supabase, conversationId, "client-replied");
  } catch (e) {
    console.error(
      "[ingestInboundMessage] cancel retargets failed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  // 7) Reactivaciones: primer contacto (conversación nueva) → agenda las
  //    plantillas 7d/15d si el feature está encendido. Best-effort.
  if (conversationIsNew) {
    try {
      await scheduleReactivations(supabase, { conversationId, contactId, phone, fromMs: receivedAt, agentId });
    } catch (e) {
      console.error(
        "[ingestInboundMessage] schedule reactivations failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return { conversationId, contactId, duplicate: false };
}

export interface DebounceArgs {
  conversationId: string;
  contactId: string;
  phone: string;
  /** uuid de ESTE inbound: solo respondemos si sigue siendo el último. */
  messageUuid: string;
  receivedAt: number;
}

/**
 * FASE 2 — respuesta con debounce (en background, vía `waitUntil`).
 *
 * Espera `REPLY_DEBOUNCE_MS` y luego pregunta si este mensaje sigue siendo el
 * último de la conversación. Si llegó otro después, se apaga (esa tarea
 * responderá por todos). Si sigue siendo el último, junta todos los mensajes
 * pendientes y responde en UNA sola llamada a Responses.
 */
export async function runDebouncedReply(args: DebounceArgs): Promise<void> {
  const { conversationId, contactId, phone, messageUuid, receivedAt } = args;

  await sleep(env.REPLY_DEBOUNCE_MS);

  const supabase = createServiceClient();
  try {
    // Estado + "quién gana": ¿sigo siendo el último inbound?
    const { data: convo, error: convoErr } = await supabase
      .from("conversations")
      .select(
        "status, ai_paused, agent_id, last_inbound_message_uuid, openai_previous_response_id, last_inbound_at",
      )
      .eq("id", conversationId)
      .single();
    if (convoErr) throw new Error(`load-conversation-state: ${convoErr.message}`);

    // Llegó otro mensaje después → esa tarea responderá por el lote. Me apago.
    if (convo.last_inbound_message_uuid !== messageUuid) return;

    // Conversación cerrada / handoff → el bot no responde.
    if (convo.status !== "active") return;

    // Modo manual: un agente humano tomó la conversación. La IA calla, pero el
    // inbound ya quedó guardado (se ve en el dashboard). Ver docs/11 y ADR-0018.
    if (convo.ai_paused) {
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "reply_skipped",
        payload: { reason: "manual-mode" } as unknown as Json,
      });
      return;
    }

    // Config de IA + credenciales de ESTE agente (multi-marca). Fallback al
    // agente seed si la conversación no tiene agent_id (datos legados). Ver docs/16.
    const agent = await loadAgentForConversation(supabase, convo.agent_id);
    if (!agent) {
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "reply_skipped",
        payload: { reason: "no-agent" } as unknown as Json,
      });
      return;
    }

    // Horario del agente: fuera de su ventana activa el bot calla (el inbound ya
    // quedó guardado; lo atiende un humano). Con el horario apagado, siempre activo.
    // Ver ADR-0029.
    if (!isAgentActiveNow(agent)) {
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "reply_skipped",
        payload: { reason: "agent-inactive" } as unknown as Json,
      });
      return;
    }

    // Juntar los mensajes pendientes (inbound desde la última respuesta) en un
    // solo turno MULTIMODAL: texto + notas de voz transcritas + imágenes (visión).
    // El `previous_response_id` aporta el contexto previo. Ver docs/15.
    const openai = createOpenAIClient();
    const hotmartFlow = await readHotmartFlow(supabase, conversationId);
    const content = await gatherPendingContent(supabase, openai, conversationId, hotmartFlow, {
      mediaAuth: agentMediaAuth(agent),
    });
    if (!content.hasContent) return; // nada que responder (ni texto ni media legible)

    await generateAndSend({
      supabase,
      openai,
      conversationId,
      contactId,
      phone,
      receivedAt,
      previousResponseId: convo.openai_previous_response_id,
      lastInboundAt: convo.last_inbound_at,
      agent,
      input: content.text,
      imageDataUrls: content.imageDataUrls,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[runDebouncedReply] failed:", message);
    await supabase
      .from("events_log")
      .insert({
        conversation_id: conversationId,
        type: "process_error",
        payload: { phase: "reply", messageUuid, error: message } as unknown as Json,
      })
      .then(() => undefined, () => undefined);
  }
}

/**
 * REINTENTO MANUAL (desde el dashboard) — recupera una conversación donde el bot
 * NO alcanzó a responder (p. ej. un error transitorio de OpenAI/Callbell dejó el
 * primer mensaje del cliente sin contestar). Re-corre el MISMO camino que la
 * respuesta automática (`gatherPendingContent` + `generateAndSend`) sobre los
 * inbound pendientes, pero SIN el `sleep` del debounce ni la guarda de "quién
 * gana": es una acción explícita del operador, se ejecuta ya.
 *
 * A diferencia de `runDebouncedReply` (best-effort, silencioso), **lanza** en cada
 * caso en que no se puede reintentar para que el server action lo propague y el
 * dashboard le muestre el motivo al operador. Ver docs/13, ADR-0027.
 */
export async function regenerateReply(conversationId: string): Promise<void> {
  const supabase = createServiceClient();

  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("status, ai_paused, agent_id, contact_id, openai_previous_response_id, last_inbound_at")
    .eq("id", conversationId)
    .single();
  if (convoErr) throw new Error(`regenerateReply load: ${convoErr.message}`);

  if (convo.status !== "active")
    throw new Error("La conversación no está activa (handoff o cerrada); no se puede reintentar.");
  if (convo.ai_paused)
    throw new Error("La IA está en pausa (modo manual). Reactívala para reintentar.");

  // Teléfono del contacto para el envío por Callbell.
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", convo.contact_id)
    .maybeSingle();
  if (contactErr) throw new Error(`regenerateReply contact: ${contactErr.message}`);
  if (!contact?.phone) throw new Error("El contacto no tiene teléfono.");

  // Config + credenciales del agente de la conversación (fallback al seed).
  const agent = await loadAgentForConversation(supabase, convo.agent_id);
  if (!agent) throw new Error("No hay un agente configurado para esta conversación.");

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "retry_requested",
    payload: { source: "dashboard" } as unknown as Json,
  });

  // Juntar los inbound sin responder (posteriores al último outbound). En el caso
  // típico —el bot nunca respondió— no hay outbound, así que entra todo el hilo.
  const openai = createOpenAIClient();
  const hotmartFlow = await readHotmartFlow(supabase, conversationId);
  const content = await gatherPendingContent(supabase, openai, conversationId, hotmartFlow, {
    mediaAuth: agentMediaAuth(agent),
  });
  if (!content.hasContent)
    throw new Error("No hay mensajes del cliente pendientes por responder.");

  // Reintento = ahora: la ventana de 24h se evalúa contra el momento actual.
  await generateAndSend({
    supabase,
    openai,
    conversationId,
    contactId: convo.contact_id,
    phone: contact.phone,
    receivedAt: Date.now(),
    previousResponseId: convo.openai_previous_response_id,
    lastInboundAt: convo.last_inbound_at,
    agent,
    input: content.text,
    imageDataUrls: content.imageDataUrls,
  });
}

interface PendingContent {
  /** Texto del turno: texto/captions + transcripciones de audio + notas de media. */
  text: string;
  /** Imágenes del turno como data URLs base64 para la visión de Responses. */
  imageDataUrls: string[];
  /** ¿Hay algo que responder? (texto o al menos una imagen). */
  hasContent: boolean;
}

/**
 * Junta los inbound sin responder (posteriores a la última respuesta) en un turno
 * MULTIMODAL: el texto tal cual, las notas de voz **transcritas** (se persisten en
 * `messages.content` — visibles en el dashboard, reutilizables por la orden e
 * idempotentes ante reintentos) y las imágenes **descargadas** como data URLs para
 * la visión. Video/documentos no se procesan (v1): se deja una nota para que el
 * agente pida texto. Ver docs/15, ADR-0022.
 */
async function gatherPendingContent(
  supabase: DB,
  openai: OpenAI,
  conversationId: string,
  /** ¿La conversación entró por el flujo de Hotmart? Anexa la marca al input de la IA. */
  hotmartFlow: boolean,
  /** Credencial para bajar los adjuntos — depende del proveedor del agente (ADR-0056). */
  opts: { mediaAuth: MediaAuth },
): Promise<PendingContent> {
  const { data: lastOut } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let q = supabase
    .from("messages")
    .select("id, type, content, media_url, created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: true });
  if (lastOut?.created_at) q = q.gt("created_at", lastOut.created_at);

  const { data, error } = await q;
  if (error) throw new Error(`gather-pending-content: ${error.message}`);

  const mediaOn = env.MEDIA_UNDERSTANDING_ENABLED;
  const textParts: string[] = [];
  const imageDataUrls: string[] = [];

  for (const m of data ?? []) {
    const type = effectiveType(m.type as MessageType, m.media_url);
    const content = (m.content ?? "").trim();

    if (type === "audio") {
      // Nota de voz: transcribir (si no está ya) y usar el texto como del cliente.
      // En Kapso el `content` suele venir lleno desde la ingesta (su webhook trae la
      // transcripción hecha), así que esta rama no llama a Whisper. Ver ADR-0057.
      let transcript = content;
      if (!transcript && m.media_url && mediaOn) {
        transcript = await transcribeAudioAndPersist(
          supabase,
          openai,
          conversationId,
          m.id,
          m.media_url,
          opts.mediaAuth,
        );
      }
      if (transcript) textParts.push(transcript);
      else if (m.media_url)
        textParts.push(
          "(El cliente envió una nota de voz que no se pudo entender; pídele amablemente que la reenvíe o la escriba.)",
        );
    } else if (type === "image") {
      // Imagen: caption (si vino) + la imagen como visión.
      if (content) textParts.push(content);
      if (m.media_url && mediaOn) {
        const dataUrl = await fetchImageDataUrl(supabase, conversationId, m.media_url, opts.mediaAuth);
        if (dataUrl) imageDataUrls.push(dataUrl);
        else
          textParts.push(
            "(El cliente envió una imagen que no se pudo procesar; pídele que la reenvíe.)",
          );
      }
    } else if (type === "video" || type === "document") {
      if (content) textParts.push(content);
      textParts.push(
        `(El cliente envió un ${type} que no puedo ver; pídele que te cuente por texto lo que necesita.)`,
      );
    } else {
      // text | other
      if (content) textParts.push(content);
    }
  }

  const baseText = textParts.join("\n");
  const hasContent = baseText.length > 0 || imageDataUrls.length > 0;
  // Flujo Hotmart (cursos): anexa "Es flujo hotmart" al texto que ve la IA (no al
  // mensaje guardado) para que identifique el caso y ejecute el flujo. Solo cuando
  // el turno ya tiene contenido (texto o imagen); nunca fuerza una respuesta vacía.
  const text = hasContent ? appendHotmartMarker(baseText, hotmartFlow) : baseText;
  return { text, imageDataUrls, hasContent };
}

/**
 * Lee la marca `hotmart_flow` de la conversación. Best-effort: si falta la columna
 * (42703, migración 0019 sin aplicar) o la consulta falla, devuelve false — el
 * marcador es un plus y no debe romper la respuesta. Ver ADR-0040.
 */
async function readHotmartFlow(supabase: DB, conversationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("conversations")
    .select("hotmart_flow")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) return false;
  return data?.hotmart_flow === true;
}

/**
 * Transcribe una nota de voz y persiste el texto en `messages.content`. Best-effort:
 * ante un fallo loguea y devuelve "" (el turno sigue con una nota). Idempotente: si
 * ya había `content` no se llama (lo decide `gatherPendingContent`).
 */
async function transcribeAudioAndPersist(
  supabase: DB,
  openai: OpenAI,
  conversationId: string,
  messageId: string,
  url: string,
  mediaAuth: MediaAuth,
): Promise<string> {
  try {
    const result = await transcribeAudioUrl(openai, url, mediaAuth);
    const transcript = result?.text ?? "";
    if (transcript) {
      await supabase.from("messages").update({ content: transcript }).eq("id", messageId);
      // Costo real del audio (whisper por minuto) → suma al "Costo IA" del dashboard.
      const costUsd = result?.durationSec != null ? audioCostUsd(result.durationSec) : null;
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "audio_transcribed",
        payload: {
          messageId,
          chars: transcript.length,
          durationSec: result?.durationSec ?? null,
          costUsd,
        } as unknown as Json,
      });
      return transcript;
    }
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "audio_transcribe_failed",
      payload: { messageId, reason: "empty-or-unfetchable" } as unknown as Json,
    });
    return "";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[gatherPendingContent] transcription failed:", message);
    await supabase
      .from("events_log")
      .insert({
        conversation_id: conversationId,
        type: "audio_transcribe_failed",
        payload: { messageId, error: message } as unknown as Json,
      })
      .then(() => undefined, () => undefined);
    return "";
  }
}

/**
 * Descarga una imagen inbound y la vuelve data URL base64 para la visión.
 * Best-effort: null si no se pudo bajar o no es imagen (se loguea).
 */
async function fetchImageDataUrl(
  supabase: DB,
  conversationId: string,
  url: string,
  mediaAuth: MediaAuth,
): Promise<string | null> {
  try {
    const media = await fetchMedia(url, { auth: mediaAuth });
    if (!media || media.kind !== "image") {
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "image_fetch_failed",
        payload: { kind: media?.kind ?? null } as unknown as Json,
      });
      return null;
    }
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "image_received",
      payload: { bytes: media.bytes.length, contentType: media.contentType } as unknown as Json,
    });
    return toDataUrl(media.bytes, media.contentType);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[gatherPendingContent] image fetch failed:", message);
    return null;
  }
}

interface GenerateContext {
  supabase: DB;
  openai: OpenAI;
  conversationId: string;
  contactId: string;
  phone: string;
  receivedAt: number;
  previousResponseId: string | null;
  lastInboundAt: string | null;
  /** Agente (marca) que responde: config de IA + credenciales de Callbell. */
  agent: Agent;
  /** Texto del turno (con las notas de voz ya transcritas). */
  input: string;
  /** Imágenes del turno como data URLs para la visión (input_image). */
  imageDataUrls: string[];
}

/**
 * Generar (1× Responses) → parsear tags → gate → enviar por el proveedor del
 * agente (Callbell o Kapso) → S5 (método/orden/handoff). El envío de imágenes de
 * los `#ID` válidos depende de que el SKU exista en `products`.
 */
async function generateAndSend(ctx: GenerateContext): Promise<void> {
  const {
    supabase,
    openai,
    conversationId,
    contactId,
    phone,
    receivedAt,
    previousResponseId,
    lastInboundAt,
    agent,
    input,
    imageDataUrls,
  } = ctx;

  // Adaptador de ESTE agente: Callbell o Kapso. De acá para abajo el flujo no sabe
  // por cuál de los dos sale (ADR-0056).
  const messaging = providerForAgent(agent);

  // Métodos de pago del agente (tags de compra por mercado: contra-entrega/addi en
  // CO, Zelle en EE.UU., etc.). Resiliente a que falte la columna. Ver ADR-0055.
  const paymentMethods = await loadPaymentMethods(supabase, agent.id);
  const methodLabels = methodLabelMap(paymentMethods);

  // Contexto del contacto: su nombre (de Callbell, en `contacts.name`) se antepone
  // al texto del turno para que la IA lo salude/trate por su nombre y adecúe el
  // género. Best-effort: si la lectura falla, se genera sin el contexto (nunca
  // rompe la respuesta). NO se guarda en `messages`: el hilo del panel queda limpio.
  // `input` (crudo) se conserva para `detectProductCategory`. Ver ADR-0047.
  let inputForModel = input;
  try {
    const { data: contact } = await supabase
      .from("contacts")
      .select("name")
      .eq("id", contactId)
      .maybeSingle();
    inputForModel = prependContactContext(input, contact?.name ?? null);
  } catch (e) {
    console.error(
      "[generateAndSend] load contact name failed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  // Contexto de Hotmart: la plantilla de carrito abandonado se envía desde el webhook,
  // FUERA de la cadena de Responses, así que la IA nunca la vio. Si el último outbound
  // sigue siendo esa plantilla (aún no hemos respondido), se antepone al turno el curso
  // + el texto EXACTO que se le envió, para que el modelo continúe desde ahí en vez de
  // arrancar de cero. Va en el `input`, así que a partir de esta llamada queda dentro de
  // la cadena y no se reinyecta. Best-effort: un fallo aquí NUNCA tumba la respuesta.
  // NO se guarda en `messages` (el hilo del panel queda limpio). Ver ADR-0051.
  try {
    const hotmartContext = await loadHotmartReplyContext(supabase, {
      conversationId,
      agentId: agent.id,
    });
    if (hotmartContext) {
      inputForModel = prependHotmartContext(inputForModel, hotmartContext);
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "hotmart_context_injected",
        payload: { chars: hotmartContext.length } as unknown as Json,
      });
    }
  } catch (e) {
    console.error(
      "[generateAndSend] hotmart context failed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  // GENERAR: una sola llamada a Responses (file_search hosted). El vector store
  // sale del agente o, si no, de OPENAI_VECTOR_STORE_ID. Las imágenes del cliente
  // entran como visión en esta MISMA llamada (input_image). Ver docs/15 y docs/16.
  const gen = await generateReply(openai, {
    model: agent.model,
    systemPrompt: agent.system_prompt,
    input: inputForModel,
    imageDataUrls,
    vectorStoreId: agentVectorStoreId(agent),
    previousResponseId,
    maxNumResults: env.FILE_SEARCH_MAX_RESULTS,
  });

  // La cadena (`previous_response_id`) se rompió y se regeneró sin encadenar
  // —típico al migrar la API key a otra cuenta—. Lo dejamos trazado; el
  // `openai_previous_response_id` se sobrescribe abajo con el id nuevo (válido),
  // así que la conversación se recupera sola desde el próximo turno. Ver ADR-0025.
  if (gen.chainReset) {
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "chain_reset",
      payload: { staleResponseId: previousResponseId } as unknown as Json,
    });
  }

  // Parsear tags + cleanText (puro) y guardar el outbound + encadenar. Los tags de
  // pago se reconocen según los métodos configurados de ESTE agente.
  const parsed = parseReply(gen.text, { paymentMethods });

  const { data: outbound, error: outErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      role: "assistant",
      type: "text",
      content: parsed.cleanText,
      tags: parsed.tags.raw as unknown as Json,
      openai_response_id: gen.responseId,
    })
    .select("id")
    .single();
  if (outErr) throw new Error(`save-outbound-message: ${outErr.message}`);
  const outboundMessageId = outbound.id;

  {
    const { error: updErr } = await supabase
      .from("conversations")
      .update({ openai_previous_response_id: gen.responseId })
      .eq("id", conversationId);
    if (updErr) throw new Error(`update previous_response_id: ${updErr.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "reply_generated",
    payload: {
      responseId: gen.responseId,
      skus: parsed.tags.skus,
      tags: parsed.tags.raw,
      usage: gen.usage, // tokens para el KPI de costo del dashboard
      images: imageDataUrls.length, // # de imágenes (visión) para repartir el costo
    } as unknown as Json,
  });

  // Fuente de producto: categoriza la conversación por la primera palabra clave
  // (magnesio, colageno…) que aparezca en el mensaje del cliente o la respuesta.
  // Best-effort, no pisa una categoría ya asignada. Ver docs/21.
  await detectProductCategory(supabase, {
    conversationId,
    agentId: agent.id,
    clientText: input,
    replyText: parsed.cleanText,
  });

  // --- S4: gate + envío por Callbell --------------------------------------
  let found: ProductLookup[] = [];
  if (parsed.tags.skus.length > 0) {
    const { data, error } = await supabase
      .from("products")
      .select("sku, image_url, name")
      .eq("agent_id", agent.id) // catálogo por marca
      .in("sku", parsed.tags.skus);
    if (error) throw new Error(`load-products-for-skus: ${error.message}`);
    found = data as ProductLookup[];
  }

  const productBySku = new Map(found.map((p) => [p.sku, p]));
  const gate = applyGate(parsed.tags.skus, productBySku.keys(), lastInboundAt, receivedAt);

  if (gate.blockedSkus.length > 0) {
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "gate_blocked",
      payload: { blockedSkus: gate.blockedSkus } as unknown as Json,
    });
  }

  // Fuera de ventana de 24h: no se envía (requeriría template). Se registra.
  if (!gate.withinWindow) {
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "out_of_window",
      payload: { lastInboundAt } as unknown as Json,
    });
    return;
  }

  // --- S5: flujos de compra + handoff -------------------------------------
  const isHandoff = parsed.tags.ordenLista || parsed.tags.humano;

  // Tag de pago del agente (contra-entrega/addi/zelle/…) → fijar el método elegido
  // en la conversación. La clave `method` viene de la config del agente. Ver ADR-0055.
  if (parsed.tags.paymentMethod) {
    await supabase
      .from("conversations")
      .update({ fulfillment_method: parsed.tags.paymentMethod })
      .eq("id", conversationId);
  }

  // #llamada → el cliente pidió que lo llamen. Crea la solicitud + avisa al dueño.
  // Best-effort e INDEPENDIENTE del resto del flujo: no fuerza handoff ni apaga el
  // bot (solo es una solicitud); un fallo aquí NUNCA rompe la respuesta. Ver ADR-0034.
  if (parsed.tags.llamada) {
    try {
      await createCallRequestAndNotify(supabase, messaging, {
        conversationId,
        contactId,
        phone,
        agentId: agent.id,
        brand: agent.brand ?? agent.name,
      });
    } catch (e) {
      console.error(
        "[generateAndSend] call request failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // RED DE SEGURIDAD (ADR-0031 → mejorada en ADR-0039): a veces el modelo CIERRA
  // la venta pero olvida `#orden-lista` y solo emite el tag de pago. Antes la orden
  // solo se inferían con una frase de confirmación MUY estrecha, así que muchos
  // cierres se perdían (no se creaba orden ni se avisaba). Ahora se infiere el cierre
  // cuando el método está decidido Y hay señal: se acaba de elegir el método (tag de
  // pago) O el texto confirma. El gate de "hay datos reales" (abajo, tras la
  // extracción) evita crear órdenes vacías al elegir método antes de recolectar
  // datos. NO fuerza handoff (menor radio si falla).
  const { data: convMethodRow } = await supabase
    .from("conversations")
    .select("fulfillment_method")
    .eq("id", conversationId)
    .single();
  const convMethod = convMethodRow?.fulfillment_method ?? UNDECIDED_METHOD;
  const methodDecided = convMethod !== UNDECIDED_METHOD && convMethod !== "";
  const inferClose =
    !parsed.tags.ordenLista &&
    !parsed.tags.humano &&
    methodDecided &&
    (parsed.tags.paymentMethod != null || isPurchaseConfirmation(parsed.cleanText));

  // Intentar cerrar orden: explícito (`#orden-lista`) o inferido.
  const shouldCreateOrder = parsed.tags.ordenLista || inferClose;

  // Extraer la orden (completion aparte) y crearla. Idempotente por ORDEN ACTIVA:
  // reutilizamos una orden existente solo si NO está cancelada (no duplicamos ni
  // re-avisamos). Si el cliente canceló una compra previa y hoy vuelve a pedir, la
  // orden cancelada NO bloquea la nueva: se crea otra (deja la cancelada como está
  // y avisa al dueño de la nueva venta). Ver ADR-0059.
  let orderId: string | null = null;
  if (shouldCreateOrder) {
    const { data: existingOrder, error: existErr } = await supabase
      .from("orders")
      .select("id")
      .eq("conversation_id", conversationId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existErr) throw new Error(`create-order existing check: ${existErr.message}`);
    if (existingOrder) orderId = existingOrder.id;
  }
  if (shouldCreateOrder && !orderId) {
    const { data: msgs, error: msgsErr } = await supabase
      .from("messages")
      .select("direction, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(40);
    if (msgsErr) throw new Error(`create-order load messages: ${msgsErr.message}`);

    const transcript = buildTranscript((msgs ?? []) as TranscriptMessage[]);
    const { draft, usage: extractUsage } = await extractOrder(openai, transcript, agent.model);

    // Gate de datos: una orden INFERIDA (sin `#orden-lista`) solo se crea si la
    // extracción trae datos reales (ítems o algún dato de envío) — así elegir el
    // método antes de dar datos NO crea una orden vacía. `#orden-lista` (explícito)
    // ignora el gate. Ver ADR-0039.
    if (inferClose && !hasOrderData(draft)) {
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "order_inferred_skipped",
        payload: { method: convMethod, reason: "method-without-data" } as unknown as Json,
      });
    } else {
      const method = resolveFulfillmentMethod(convMethod, draft.fulfillment_method);
      const total = draft.total ?? computeOrderTotal(draft.items);

      const { data: order, error: ordErr } = await supabase
        .from("orders")
        .insert({
          conversation_id: conversationId,
          contact_id: contactId,
          status: "pending_handoff",
          fulfillment_method: method,
          shipping_name: draft.shipping.name,
          shipping_address: draft.shipping.address,
          shipping_city: draft.shipping.city,
          shipping_phone: draft.shipping.phone,
          notes: draft.notes,
          total,
        })
        .select("id")
        .single();
      if (ordErr) throw new Error(`create-order insert: ${ordErr.message}`);
      orderId = order.id;

      if (draft.items.length > 0) {
        const rows = draft.items.map((it) => {
          const n = normalizeOrderItem(it);
          return {
            order_id: order.id,
            sku: n.sku,
            name: n.name,
            qty: n.qty,
            unit_price: n.unit_price,
          };
        });
        const { error: itErr } = await supabase.from("order_items").insert(rows);
        if (itErr) throw new Error(`create-order items: ${itErr.message}`);
      }

      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "order_created",
        payload: {
          orderId: order.id,
          method,
          items: draft.items.length,
          total,
          inferred: inferClose, // creada por la red de seguridad (sin #orden-lista)
          usage: extractUsage, // tokens de la extracción → costo real del dashboard
        } as unknown as Json,
      });

      // Compró → cancela seguimientos (1h/8h) y reactivaciones (7/15d) pendientes.
      // No queremos "¿sigues ahí?" tras una venta. Best-effort: un fallo aquí NUNCA
      // rompe el flujo del pedido (y el worker igual cancela por la guarda de compra).
      try {
        await cancelScheduledRetargets(supabase, conversationId, "converted");
      } catch (e) {
        console.error(
          "[generateAndSend] cancel retargets failed:",
          e instanceof Error ? e.message : String(e),
        );
      }
      try {
        await cancelScheduledReactivations(supabase, conversationId, "converted");
      } catch (e) {
        console.error(
          "[generateAndSend] cancel reactivations failed:",
          e instanceof Error ? e.message : String(e),
        );
      }

      // Aviso al dueño: nueva venta con cliente + resumen de la orden. Best-effort:
      // un fallo aquí NUNCA rompe el flujo del pedido (se loguea y sigue).
      await notifyOwnerOfSale(supabase, messaging, conversationId, {
        clientPhone: phone,
        orderId: order.id,
        method,
        methodLabel: methodLabels[method] ?? null,
        brand: agent.brand ?? agent.name,
        total,
        draft,
      });
    }
  }

  // Texto del agente. En handoff va con team_uuid + bot_end (reasigna + apaga bot).
  const textToSend =
    parsed.cleanText.length > 0
      ? parsed.cleanText
      : isHandoff
        ? "¡Listo! Te paso con el equipo que confirma tu pedido y la entrega."
        : "";

  const meta = { metadata: { conversation_id: conversationId } };

  if (isHandoff) {
    // Handoff: solo texto (reasigna + apaga el bot). Sin imágenes: se cierra.
    // `teamUuid`/`botStatus` solo los honra Callbell; Kapso no tiene equipos y los
    // ignora. Lo que de verdad calla a NUESTRA IA es el `status = 'handed_off'` que
    // se escribe más abajo, así que el handoff funciona igual en los dos. Ver ADR-0056.
    if (textToSend.length > 0) {
      const sent = await messaging.sendText(phone, textToSend, {
        ...meta,
        teamUuid: agentTeamUuid(agent),
        botStatus: "bot_end",
      });
      await supabase
        .from("messages")
        .update({ callbell_message_uuid: sent.uuid })
        .eq("id", outboundMessageId);
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "text_sent",
        payload: { uuid: sent.uuid, status: sent.status } as unknown as Json,
      });
    }
  } else {
    // Imágenes válidas (SKU existe en `products` y tiene image_url).
    const validImages: Array<{ sku: string; imageUrl: string; name: string | null }> = [];
    for (const sku of gate.validSkus) {
      const product = productBySku.get(sku);
      if (!product?.image_url) {
        await supabase.from("events_log").insert({
          conversation_id: conversationId,
          type: "image_missing",
          payload: { sku } as unknown as Json,
        });
        continue;
      }
      validImages.push({ sku, imageUrl: product.image_url, name: product.name ?? null });
    }

    // Caption de WhatsApp: límite ~1024 chars. Si el texto cabe, va JUNTO con la
    // primera imagen (una sola llamada a Callbell = un mensaje con foto + texto).
    // Si el texto es muy largo o no hay imagen, van por separado.
    const CAPTION_MAX = 1024;
    const combine =
      validImages.length > 0 && textToSend.length > 0 && textToSend.length <= CAPTION_MAX;

    if (combine) {
      const [first, ...rest] = validImages;
      // La primera imagen lleva el texto como caption → reutilizamos el mensaje
      // outbound (que ya guardaba el texto) marcándolo como imagen.
      const sent = await messaging.sendImage(phone, first.imageUrl, textToSend, meta);
      await supabase
        .from("messages")
        .update({ type: "image", media_url: first.imageUrl, callbell_message_uuid: sent.uuid })
        .eq("id", outboundMessageId);
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "image_sent",
        payload: {
          sku: first.sku,
          uuid: sent.uuid,
          status: sent.status,
          withCaption: true,
        } as unknown as Json,
      });
      // Imágenes adicionales: mensajes aparte con el nombre del producto.
      for (const img of rest) {
        await sendProductImage(supabase, messaging, conversationId, phone, img, meta);
      }
    } else {
      // Texto (si hay) como su propio mensaje.
      if (textToSend.length > 0) {
        const sent = await messaging.sendText(phone, textToSend, meta);
        await supabase
          .from("messages")
          .update({ callbell_message_uuid: sent.uuid })
          .eq("id", outboundMessageId);
        await supabase.from("events_log").insert({
          conversation_id: conversationId,
          type: "text_sent",
          payload: { uuid: sent.uuid, status: sent.status } as unknown as Json,
        });
      }
      // Imágenes por separado (con el nombre del producto como caption).
      for (const img of validImages) {
        await sendProductImage(supabase, messaging, conversationId, phone, img, meta);
      }
    }

    // Método Addi → enviar el link/instrucciones si está configurado (v1 sin API
    // Addi). Es específico de Colombia (método `addi`); los demás métodos no envían
    // info extra (solo marcan el pago y generan la orden). Ver ADR-0055.
    if (parsed.tags.paymentMethod === "addi" && env.ADDI_LINK) {
      const addiLink = env.ADDI_LINK;
      const sent = await messaging.sendText(
        phone,
        `Puedes financiar tu compra con Addi aquí: ${addiLink}`,
        meta,
      );
      await supabase.from("events_log").insert({
        conversation_id: conversationId,
        type: "addi_info_sent",
        payload: { uuid: sent.uuid } as unknown as Json,
      });
    }

    // Videos por palabra clave: si la respuesta del bot menciona una palabra
    // configurada (ej. "magnesio"), enviar el video correspondiente tras la
    // respuesta — una sola vez por conversación. Best-effort (no rompe nada).
    // Ver docs/20, ADR-0038.
    await sendKeywordVideos(supabase, messaging, {
      conversationId,
      phone,
      agentId: agent.id,
      replyText: parsed.cleanText,
      metadata: meta.metadata,
    });
  }

  // Handoff: apagar el bot en nuestra DB y cerrar la orden.
  if (isHandoff) {
    await supabase
      .from("conversations")
      .update({
        status: "handed_off",
        assigned_team_uuid: agentTeamUuid(agent),
      })
      .eq("id", conversationId);
    if (orderId) {
      await supabase.from("orders").update({ status: "handed_off" }).eq("id", orderId);
    }
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "handoff",
      payload: {
        reason: parsed.tags.ordenLista ? "orden-lista" : "humano",
        orderId,
      } as unknown as Json,
    });
  } else if (!orderId) {
    // Sin handoff, sin orden capturada y dentro de ventana (si no, ya habríamos
    // vuelto arriba): agenda los seguimientos del agente (config propia o backstop)
    // anclados al último inbound. Si ya hay orden (cierre inferido), NO se agenda:
    // la venta está cerrada. Best-effort: un fallo aquí NO debe afectar la respuesta.
    try {
      await scheduleRetargets(supabase, {
        conversationId,
        contactId,
        phone,
        agentId: agent.id,
        anchorInboundAt: lastInboundAt,
        fromMs: Date.now(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await supabase
        .from("events_log")
        .insert({
          conversation_id: conversationId,
          type: "retarget_schedule_error",
          payload: { error: message } as unknown as Json,
        })
        .then(() => undefined, () => undefined);
    }
  }
}

/**
 * Envía UNA imagen de producto en su propio mensaje (con el nombre como caption),
 * guarda la fila `messages` (type image) y loguea `image_sent`. Se usa para las
 * imágenes adicionales cuando hay varios `#ID` (la primera va junto al texto).
 */
async function sendProductImage(
  supabase: DB,
  messaging: MessagingProvider,
  conversationId: string,
  phone: string,
  img: { sku: string; imageUrl: string; name: string | null },
  opts: { metadata?: Record<string, unknown> },
): Promise<void> {
  const sent = await messaging.sendImage(phone, img.imageUrl, img.name, opts);
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    role: "assistant",
    type: "image",
    content: img.name,
    media_url: img.imageUrl,
    tags: [img.sku] as unknown as Json,
    callbell_message_uuid: sent.uuid,
  });
  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "image_sent",
    payload: { sku: img.sku, uuid: sent.uuid, status: sent.status } as unknown as Json,
  });
}

/**
 * Crea una `call_requests` (cola de trabajo del equipo) y avisa al dueño por
 * WhatsApp (`CALLS_NOTIFY_PHONE`) por el MISMO Callbell del agente. Idempotente:
 * si la conversación ya tiene una solicitud PENDING, no crea otra ni re-avisa
 * (respalda el índice parcial único de la migración 0012). Best-effort: loguea el
 * desenlace y JAMÁS lanza (el llamador ya lo envuelve en try/catch). Ver ADR-0034.
 */
async function createCallRequestAndNotify(
  supabase: DB,
  messaging: MessagingProvider,
  info: {
    conversationId: string;
    contactId: string;
    phone: string;
    agentId: string;
    brand: string | null;
  },
): Promise<void> {
  const { conversationId, contactId, phone, agentId, brand } = info;

  // Idempotencia: a lo sumo una solicitud viva (pending) por conversación.
  const { data: existing } = await supabase
    .from("call_requests")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (existing) return; // ya hay una pendiente → no duplicar ni re-avisar

  const { data: created, error: insErr } = await supabase
    .from("call_requests")
    .insert({ conversation_id: conversationId, contact_id: contactId, agent_id: agentId, phone })
    .select("id")
    .single();
  if (insErr) {
    // Carrera con el índice único (dos ráfagas casi simultáneas): otra ya la creó.
    console.error("[createCallRequestAndNotify] insert failed:", insErr.message);
    return;
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "call_requested",
    payload: { callRequestId: created.id, phone } as unknown as Json,
  });

  // Aviso al dueño (mismo caveat de ventana 24h que el aviso de venta).
  const ownerPhone = env.CALLS_NOTIFY_PHONE;
  if (!ownerPhone) return; // feature de aviso apagado (la solicitud igual quedó registrada)

  const { data: contact } = await supabase
    .from("contacts")
    .select("name")
    .eq("id", contactId)
    .maybeSingle();

  const text = buildCallRequestNotification({
    clientPhone: phone,
    contactName: contact?.name ?? null,
    brand,
  });
  const sent = await messaging.sendText(ownerPhone, text, {
    metadata: { conversation_id: conversationId, call_request_notification: true },
  });
  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "call_request_notification_sent",
    payload: { ownerPhone, callRequestId: created.id, uuid: sent.uuid } as unknown as Json,
  });
}

/**
 * Envía el aviso de venta al dueño (`SALES_NOTIFY_PHONE`) por el MISMO proveedor
 * del agente que hizo la venta. Best-effort: loguea el desenlace y JAMÁS lanza.
 *
 * OJO (WhatsApp): es un mensaje libre → solo se ENTREGA dentro de la ventana de
 * 24h desde que el dueño le escribió al número del negocio. Para entrega
 * garantizada a cualquier hora, migrar a una plantilla aprobada (`sendTemplate`).
 */
async function notifyOwnerOfSale(
  supabase: DB,
  messaging: MessagingProvider,
  conversationId: string,
  info: {
    clientPhone: string;
    orderId: string;
    method: string;
    /** Nombre visible del método (config del agente); fallback al `method` crudo. */
    methodLabel: string | null;
    /** Marca del agente para el encabezado del aviso. */
    brand: string;
    total: number | null;
    draft: OrderDraft;
  },
): Promise<void> {
  const ownerPhone = env.SALES_NOTIFY_PHONE;
  if (!ownerPhone) return; // feature apagado (env vacío)
  try {
    const text = buildSaleNotification(info);
    const sent = await messaging.sendText(ownerPhone, text, {
      metadata: { conversation_id: conversationId, sales_notification: true },
    });
    await supabase.from("events_log").insert({
      conversation_id: conversationId,
      type: "sales_notification_sent",
      payload: { ownerPhone, orderId: info.orderId, uuid: sent.uuid } as unknown as Json,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[notifyOwnerOfSale] failed:", message);
    await supabase
      .from("events_log")
      .insert({
        conversation_id: conversationId,
        type: "sales_notification_failed",
        payload: { ownerPhone, orderId: info.orderId, error: message } as unknown as Json,
      })
      .then(() => undefined, () => undefined);
  }
}
