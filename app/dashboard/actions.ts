"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { cancelScheduledRetargets } from "@/lib/agent/retarget";
import { computeOrderTotal, normalizeQty } from "@/lib/agent/order";
import { sendText, credsFromEnv } from "@/lib/callbell/sender";
import { loadAgentForConversation, agentCallbellCreds } from "@/lib/agent/agents";
import { regenerateReply } from "@/lib/agent/processMessage";
import { runCatalogImport, type CatalogImportResult } from "@/lib/openai/catalogLoader";
import type { Json } from "@/lib/supabase/types";
import type { OrderEditInput } from "./orders/types";
import type { AgentEditInput, AgentCatalogInput } from "./agents/types";

/**
 * Server Actions del dashboard.
 *
 * Corren server-side con el cliente service-role (nunca llega al browser) y
 * quedan protegidas por el Basic Auth del dashboard (middleware). Ver docs/11.
 */

/**
 * Pasa una conversación a modo manual (IA en silencio) o la reactiva. Al pausar,
 * cancela también los retargets pendientes (no queremos nudges mientras un humano
 * la atiende). Loguea `manual_on`/`manual_off` para auditoría.
 */
export async function setConversationManual(
  conversationId: string,
  paused: boolean,
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("conversations")
    .update({ ai_paused: paused })
    .eq("id", conversationId);
  if (error) throw new Error(`setConversationManual: ${error.message}`);

  if (paused) {
    // Best-effort: si falla el cancel, el worker igual descarta por `manual-mode`.
    try {
      await cancelScheduledRetargets(supabase, conversationId, "manual-mode");
    } catch {
      // no-op
    }
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: paused ? "manual_on" : "manual_off",
    payload: {} as unknown as Json,
  });

  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard");
}

/**
 * Reintenta la respuesta de la IA para una conversación donde el bot no alcanzó a
 * responder (p. ej. un error transitorio de OpenAI/Callbell). Re-corre el MISMO
 * flujo automático sobre los mensajes pendientes del cliente (`regenerateReply`).
 * Propaga el error a la UI si no se puede (conversación inactiva, en pausa o sin
 * nada pendiente) para que el operador vea el motivo. Corre server-side con
 * service-role, protegida por el Basic Auth del dashboard. Ver docs/13, ADR-0027.
 */
export async function retryReply(conversationId: string): Promise<void> {
  await regenerateReply(conversationId);

  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard");
}

/** Convierte un texto de formulario a string limpio o null si queda vacío. */
function textOrNull(v: string): string | null {
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Edita una orden: corrige la cabecera (estado, método, envío, notas, total) y
 * REEMPLAZA sus ítems por los enviados. Sirve para arreglar lo que la IA marcó
 * mal al cerrar la venta. Corre server-side con service-role (protegida por el
 * Basic Auth del dashboard). Loguea `order_edited` para auditoría. Ver docs/12.
 */
export async function saveOrder(orderId: string, input: OrderEditInput): Promise<void> {
  const supabase = createServiceClient();

  // Necesitamos la conversación para revalidar su detalle y anclar el evento.
  const { data: existing, error: findErr } = await supabase
    .from("orders")
    .select("conversation_id")
    .eq("id", orderId)
    .maybeSingle();
  if (findErr) throw new Error(`saveOrder find: ${findErr.message}`);
  if (!existing) throw new Error("saveOrder: la orden no existe");
  const conversationId = existing.conversation_id;

  // Normalizar ítems: descartar filas vacías (sin sku ni nombre); qty entero >= 1.
  const items = input.items
    .map((it) => ({
      sku: it.sku.trim(),
      name: textOrNull(it.name),
      qty: normalizeQty(it.qty),
      unit_price:
        it.unitPrice != null && Number.isFinite(it.unitPrice) ? Number(it.unitPrice) : null,
    }))
    .filter((it) => it.sku.length > 0 || it.name != null);

  const total = input.recomputeTotal
    ? computeOrderTotal(items)
    : input.total != null && Number.isFinite(input.total)
      ? Number(input.total)
      : null;

  // 1) Cabecera.
  const { error: updErr } = await supabase
    .from("orders")
    .update({
      status: input.status,
      fulfillment_method: input.method,
      shipping_name: textOrNull(input.shippingName),
      shipping_address: textOrNull(input.shippingAddress),
      shipping_city: textOrNull(input.shippingCity),
      shipping_phone: textOrNull(input.shippingPhone),
      notes: textOrNull(input.notes),
      total,
    })
    .eq("id", orderId);
  if (updErr) throw new Error(`saveOrder update: ${updErr.message}`);

  // 2) Reemplazar ítems (borrar + insertar). Volumen bajo; sin transacción cross-statement.
  const { error: delErr } = await supabase.from("order_items").delete().eq("order_id", orderId);
  if (delErr) throw new Error(`saveOrder delete items: ${delErr.message}`);

  if (items.length > 0) {
    const rows = items.map((it) => ({ order_id: orderId, ...it }));
    const { error: insErr } = await supabase.from("order_items").insert(rows);
    if (insErr) throw new Error(`saveOrder insert items: ${insErr.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "order_edited",
    payload: {
      orderId,
      status: input.status,
      method: input.method,
      items: items.length,
      total,
      source: "dashboard",
    } as unknown as Json,
  });

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/conversations/${conversationId}`);
}

/**
 * Actualiza la config de reactivaciones de UN AGENTE (ON/OFF + UUID de plantilla
 * día 7 y día 15). Las plantillas son por agente porque viven en su cuenta de
 * Callbell. Service-role, protegida por el Basic Auth. Ver docs/14, ADR-0030.
 */
export async function updateReactivationSettings(
  agentId: string,
  input: {
    enabled: boolean;
    template7d: string;
    template15d: string;
  },
): Promise<void> {
  const supabase = createServiceClient();
  const clean = (s: string): string | null => {
    const t = s.trim();
    return t.length > 0 ? t : null;
  };

  const { error } = await supabase
    .from("agents")
    .update({
      reactivation_enabled: input.enabled,
      reactivation_template_7d: clean(input.template7d),
      reactivation_template_15d: clean(input.template15d),
    })
    .eq("id", agentId);
  if (error) throw new Error(`updateReactivationSettings: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "reactivation_settings_updated",
    payload: {
      agentId,
      enabled: input.enabled,
      has7d: clean(input.template7d) != null,
      has15d: clean(input.template15d) != null,
    } as unknown as Json,
  });

  revalidatePath("/dashboard/retargets");
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
}

/** Normaliza la temperatura a [0, 2] (default 0.3 si viene inválida). */
function cleanTemperature(t: number): number {
  if (!Number.isFinite(t)) return 0.3;
  return Math.min(2, Math.max(0, t));
}

/**
 * Construye el patch de columnas de un agente a partir del formulario. La API key
 * es write-only: solo se incluye si se pegó una nueva (vacío = no cambiar), para
 * no borrar el secreto sin querer. Ver docs/16, ADR-0023.
 */
function agentPatch(input: AgentEditInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: input.name.trim(),
    brand: textOrNull(input.brand),
    country: textOrNull(input.country),
    whatsapp_number: textOrNull(input.whatsappNumber),
    callbell_channel_uuid: textOrNull(input.callbellChannelUuid),
    logistics_team_uuid: textOrNull(input.logisticsTeamUuid),
    vector_store_id: textOrNull(input.vectorStoreId),
    model: textOrNull(input.model) ?? "gpt-5.1",
    temperature: cleanTemperature(input.temperature),
    system_prompt: input.systemPrompt,
    enabled: input.enabled,
    // Horario (encendido/apagado por agente). Las columnas de reactivación NO se
    // tocan aquí: se editan en la página de Retargets (ADR-0030).
    schedule_enabled: input.scheduleEnabled,
    schedule_timezone: textOrNull(input.scheduleTimezone) ?? "America/Bogota",
    schedule: input.schedule as unknown as Json,
  };
  const newKey = input.callbellApiKey.trim();
  if (newKey.length > 0) patch.callbell_api_key = newKey;
  return patch;
}

/**
 * Edita un agente (marca/número): config de IA + credenciales de Callbell. La API
 * key solo se actualiza si se pega una nueva. Service-role, protegida por el Basic
 * Auth del dashboard. Loguea `agent_saved`. Ver docs/16.
 */
export async function saveAgent(agentId: string, input: AgentEditInput): Promise<void> {
  if (input.name.trim().length === 0) throw new Error("El nombre es obligatorio.");
  if (input.systemPrompt.trim().length === 0) throw new Error("El prompt es obligatorio.");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("agents")
    .update(agentPatch(input) as never)
    .eq("id", agentId);
  if (error) throw new Error(`saveAgent: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "agent_saved",
    payload: { agentId, name: input.name.trim(), enabled: input.enabled } as unknown as Json,
  });

  revalidatePath(`/dashboard/agents/${agentId}`);
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
}

/**
 * Crea un agente nuevo. Devuelve su id para redirigir al detalle. Service-role,
 * protegida por el Basic Auth. Loguea `agent_created`. Ver docs/16.
 */
export async function createAgent(input: AgentEditInput): Promise<string> {
  if (input.name.trim().length === 0) throw new Error("El nombre es obligatorio.");
  if (input.systemPrompt.trim().length === 0) throw new Error("El prompt es obligatorio.");

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .insert(agentPatch(input) as never)
    .select("id")
    .single();
  if (error) throw new Error(`createAgent: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "agent_created",
    payload: { agentId: data.id, name: input.name.trim() } as unknown as Json,
  });

  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
  return data.id;
}

/**
 * Carga el catálogo de productos de un agente desde el dashboard, en dos flujos:
 *  - `create`: crea el vector store del agente (si no tiene), sube cada producto como
 *    documento a OpenAI (`file_search`) y hace upsert en `products`; guarda el `vector_store_id`.
 *  - `existing`: el agente ya tiene un `vector_store_id`; los productos se cargan SOLO a
 *    `products` (Supabase) sin re-subir documentos al store.
 *
 * Reusa `runCatalogImport` (idempotente por `(agent_id, sku)`). Corre server-side con
 * service-role, protegida por el Basic Auth del dashboard. Devuelve el resultado para
 * mostrar en la UI (N cargados, vector store, avisos/errores). Ver docs/16, ADR-0028.
 */
export async function loadAgentCatalog(
  agentId: string,
  input: AgentCatalogInput,
): Promise<CatalogImportResult> {
  const vectorStoreMode = input.mode === "create" ? "create" : "supabase-only";

  const result = await runCatalogImport(
    { agentId, products: input.products, filename: input.filename ?? null },
    { vectorStoreMode },
  );

  revalidatePath(`/dashboard/agents/${agentId}`);
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
  return result;
}

/**
 * Envía un mensaje manual escrito por un operador al cliente por WhatsApp
 * (Callbell). Guarda el outbound marcado `manual` (para distinguirlo del bot) y
 * loguea `manual_message_sent`. No alimenta el contexto de la IA
 * (`previous_response_id`): es una intervención humana fuera de banda. Corre
 * server-side con service-role, protegida por el Basic Auth. Ver docs/13, ADR-0020.
 */
export async function sendManualMessage(conversationId: string, text: string): Promise<void> {
  const clean = text.trim();
  if (clean.length === 0) throw new Error("El mensaje está vacío.");

  const supabase = createServiceClient();

  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("id, contact_id, agent_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convoErr) throw new Error(`sendManualMessage convo: ${convoErr.message}`);
  if (!convo) throw new Error("La conversación no existe.");

  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", convo.contact_id)
    .maybeSingle();
  if (contactErr) throw new Error(`sendManualMessage contact: ${contactErr.message}`);
  if (!contact?.phone) throw new Error("El contacto no tiene teléfono.");

  // Credenciales de Callbell del agente de la conversación (cuenta/canal correctos).
  const agent = await loadAgentForConversation(supabase, convo.agent_id);
  const creds = agent ? agentCallbellCreds(agent) : credsFromEnv();

  // Enviar por Callbell (lanza si la API responde error, p. ej. fuera de la ventana 24h).
  const sent = await sendText(creds, contact.phone, clean, {
    metadata: { conversation_id: conversationId, source: "dashboard-manual" },
  });

  const { error: msgErr } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    role: "assistant",
    type: "text",
    content: clean,
    tags: ["manual"] as unknown as Json,
    callbell_message_uuid: sent.uuid,
  });
  if (msgErr) throw new Error(`sendManualMessage save: ${msgErr.message}`);

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "manual_message_sent",
    payload: { uuid: sent.uuid, status: sent.status, chars: clean.length } as unknown as Json,
  });

  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard");
}
