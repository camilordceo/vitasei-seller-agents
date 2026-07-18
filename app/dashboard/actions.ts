"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { cancelScheduledRetargets } from "@/lib/agent/retarget";
import { parseRetargetConfig } from "@/lib/agent/retargetPlan";
import { parsePaymentMethods } from "@/lib/agent/paymentMethods";
import { normalizeProviderId } from "@/lib/messaging/types";
import { DEFAULT_CURRENCY, normalizeCurrency, type CurrencyCode } from "@/lib/dashboard/currency";
import { computeOrderTotal, normalizeQty } from "@/lib/agent/order";
import { callbellProviderFromEnv } from "@/lib/messaging/callbell";
import { loadAgentForConversation, providerForAgent } from "@/lib/agent/agents";
import { regenerateReply } from "@/lib/agent/processMessage";
import { runCatalogImport, type CatalogImportResult } from "@/lib/openai/catalogLoader";
import type { CallRequestStatus, Json } from "@/lib/supabase/types";
import type { OrderEditInput } from "./orders/types";
import type { AgentEditInput, AgentCatalogInput, VoiceConfigInput } from "./agents/types";
import {
  credsFor,
  loadAgentVoiceConfig,
  triggerVoiceCallNow,
} from "@/lib/agent/voiceCall";
import {
  parseVoiceConfig,
  parseVoiceCountries,
  parseVoiceExtractors,
} from "@/lib/agent/voiceCallPlan";
import {
  attachActions,
  createExtractor,
  listVoices,
  syncAssistantVoice,
  updateExtractor,
} from "@/lib/synthflow/client";
import type { SynthflowVoice, VoiceExtractor } from "@/lib/synthflow/types";

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
 * Cambia el estado de una solicitud de llamada (pending → done / cancelled, o
 * reabrir a pending). Loguea el cambio para auditoría y revalida la sección
 * Llamadas. Ver ADR-0034.
 */
export async function setCallRequestStatus(
  callRequestId: string,
  status: CallRequestStatus,
): Promise<void> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("call_requests")
    .update({ status })
    .eq("id", callRequestId)
    .select("conversation_id")
    .maybeSingle();
  if (error) throw new Error(`setCallRequestStatus: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: data?.conversation_id ?? null,
    type: "call_request_status_changed",
    payload: { callRequestId, status } as unknown as Json,
  });

  revalidatePath("/dashboard/calls");
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
 * Moneda de venta del agente dueño de una conversación, para sellarla en la orden
 * que nace. Sin agente (órdenes manuales sueltas) cae al default. Best-effort: si
 * falta la migración 0029 la lectura falla y volvemos al default en vez de tumbar
 * la creación de la orden. Ver ADR-0068.
 */
async function currencyForConversationAgent(
  supabase: ReturnType<typeof createServiceClient>,
  agentId: string | null,
): Promise<CurrencyCode> {
  if (!agentId) return DEFAULT_CURRENCY;
  try {
    const { data } = await supabase.from("agents").select("currency").eq("id", agentId).maybeSingle();
    return normalizeCurrency((data as { currency?: string | null } | null)?.currency);
  } catch {
    return DEFAULT_CURRENCY;
  }
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
 * Crea una orden EN BLANCO para una conversación existente y devuelve su id para
 * que el dashboard abra el editor. Sirve para registrar a mano una venta que el
 * agente no cerró (p. ej. cerró sin `#orden-lista`) o para crear una **nueva** orden
 * cuando la anterior quedó cancelada. Es una acción HUMANA explícita: **siempre crea
 * una orden nueva** asociada a esta conversación (una conversación puede tener varias;
 * el panel las lista todas). No deduplica: el usuario decide cuándo crear otra. Nace
 * en `pending_handoff` con el método de la conversación; ítems/envío/total se completan
 * en el editor. La idempotencia por "orden activa" vive solo en el bot (que crea
 * automáticamente y no debe duplicar por ráfaga). Ver ADR-0059.
 * Cuenta en métricas apenas exista (salvo que se marque Cancelada). Ver docs/12, ADR-0032.
 */
export async function createOrderForConversation(conversationId: string): Promise<string> {
  const supabase = createServiceClient();

  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("contact_id, fulfillment_method, agent_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convoErr) throw new Error(`createOrderForConversation convo: ${convoErr.message}`);
  if (!convo) throw new Error("La conversación no existe.");

  const { data: order, error: ordErr } = await supabase
    .from("orders")
    .insert({
      conversation_id: conversationId,
      contact_id: convo.contact_id,
      status: "pending_handoff",
      fulfillment_method: convo.fulfillment_method ?? "undecided",
      // Misma razón que en el bot: el default de la tabla es COP. Ver ADR-0068.
      currency: await currencyForConversationAgent(supabase, convo.agent_id),
    })
    .select("id")
    .single();
  if (ordErr) throw new Error(`createOrderForConversation insert: ${ordErr.message}`);

  // Compró → cancela seguimientos pendientes (no "¿sigues ahí?" tras una venta).
  // Best-effort: el worker igual cancela por la guarda de compra si esto falla.
  try {
    await cancelScheduledRetargets(supabase, conversationId, "converted");
  } catch {
    // no-op
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "order_manual_created",
    payload: {
      orderId: order.id,
      source: "dashboard-conversation",
      method: convo.fulfillment_method ?? "undecided",
    } as unknown as Json,
  });

  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard");
  return order.id;
}

/**
 * Crea una orden manual "de cero" (sección Órdenes) para registrar ventas que no
 * pasaron por el bot (históricas, por teléfono, etc.) y verlas en métricas. Como
 * toda orden necesita conversación + contacto (FKs NOT NULL), crea un contacto
 * (reutilizado por teléfono si ya existe) y una conversación "manual"
 * (`handed_off`) que la anclan. Devuelve el id de la orden para abrir el editor y
 * completar ítems/envío/total. Ver docs/12, ADR-0032.
 */
export async function createManualOrder(input: { name: string; phone: string }): Promise<string> {
  const supabase = createServiceClient();
  const name = textOrNull(input.name);
  const phone = input.phone.replace(/\D/g, ""); // E.164 sin '+': solo dígitos

  // Contacto: reutiliza por teléfono si viene y ya existe; si no, crea uno.
  let contactId: string;
  if (phone) {
    const { data: existing, error: selErr } = await supabase
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (selErr) throw new Error(`createManualOrder contact select: ${selErr.message}`);
    if (existing) {
      contactId = existing.id;
      if (name) await supabase.from("contacts").update({ name }).eq("id", contactId);
    } else {
      const { data, error } = await supabase
        .from("contacts")
        .insert({ phone, name })
        .select("id")
        .single();
      if (error) throw new Error(`createManualOrder contact insert: ${error.message}`);
      contactId = data.id;
    }
  } else {
    const { data, error } = await supabase
      .from("contacts")
      .insert({ phone: "", name })
      .select("id")
      .single();
    if (error) throw new Error(`createManualOrder contact insert: ${error.message}`);
    contactId = data.id;
  }

  // Conversación "manual" que ancla la orden (no pasa por el bot).
  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .insert({ contact_id: contactId, status: "handed_off", fulfillment_method: "undecided" })
    .select("id")
    .single();
  if (convoErr) throw new Error(`createManualOrder conversation: ${convoErr.message}`);

  const { data: order, error: ordErr } = await supabase
    .from("orders")
    .insert({
      conversation_id: convo.id,
      contact_id: contactId,
      status: "pending_handoff",
      fulfillment_method: "undecided",
      shipping_name: name,
      shipping_phone: phone || null,
    })
    .select("id")
    .single();
  if (ordErr) throw new Error(`createManualOrder order: ${ordErr.message}`);

  await supabase.from("events_log").insert({
    conversation_id: convo.id,
    type: "order_manual_created",
    payload: { orderId: order.id, source: "dashboard-standalone" } as unknown as Json,
  });

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard");
  return order.id;
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
    /** Link del header de imagen (opcional). Vacío = plantilla de solo texto. */
    image7d: string;
    image15d: string;
  },
): Promise<void> {
  const supabase = createServiceClient();
  const clean = (s: string): string | null => {
    const t = s.trim();
    return t.length > 0 ? t : null;
  };
  const cleanUrl = (s: string): string | null => {
    const t = s.trim();
    if (t.length === 0) return null;
    if (!/^https?:\/\/\S+/i.test(t))
      throw new Error("El link de la imagen debe empezar por http:// o https://");
    return t;
  };

  const img7 = cleanUrl(input.image7d);
  const img15 = cleanUrl(input.image15d);
  const base = {
    reactivation_enabled: input.enabled,
    reactivation_template_7d: clean(input.template7d),
    reactivation_template_15d: clean(input.template15d),
  };

  let { error } = await supabase
    .from("agents")
    .update({ ...base, reactivation_image_7d: img7, reactivation_image_15d: img15 })
    .eq("id", agentId);
  // Ventana de migración: si aún no existen las columnas de imagen (0022), guarda sin
  // ellas (ON/OFF + UUIDs sí se guardan) para no bloquear la edición. Ver ADR-0044.
  if (error?.code === "42703") {
    ({ error } = await supabase.from("agents").update(base).eq("id", agentId));
  }
  if (error) throw new Error(`updateReactivationSettings: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "reactivation_settings_updated",
    payload: {
      agentId,
      enabled: input.enabled,
      has7d: clean(input.template7d) != null,
      has15d: clean(input.template15d) != null,
      hasImage7d: img7 != null,
      hasImage15d: img15 != null,
    } as unknown as Json,
  });

  revalidatePath("/dashboard/retargets");
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
}

/**
 * Actualiza las instrucciones de retarget (turno-guía 1h/8h) de UN agente. Vacío =
 * usar la guía por defecto. Solo edita la guía; el envoltorio de seguridad se aplica
 * siempre en el backend. Service-role, protegida por el Basic Auth. Ver ADR-0043.
 */
/**
 * Guarda las etapas de retarget de un agente (cuántas y a qué hora + guía). Recibe
 * horas desde la UI, las convierte a minutos y las normaliza con `parseRetargetConfig`
 * (descarta inválidas/duplicadas, ordena, recorta). Lista vacía = usar el backstop
 * genérico. Ver ADR-0052.
 */
export async function updateRetargetConfig(
  agentId: string,
  stages: Array<{ delayHours: number; guidance: string }>,
): Promise<void> {
  const clean = parseRetargetConfig(
    stages.map((s) => ({
      delayMinutes: Math.round((Number(s.delayHours) || 0) * 60),
      guidance: s.guidance,
    })),
  );

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("agents")
    .update({ retarget_config: (clean.length > 0 ? clean : null) as unknown as Json })
    .eq("id", agentId);
  if (error) {
    if (error.code === "42703")
      throw new Error("Falta aplicar la migración 0024 (retarget_config) en Supabase.");
    throw new Error(`updateRetargetConfig: ${error.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "retarget_config_updated",
    payload: { agentId, stages: clean.length } as unknown as Json,
  });

  revalidatePath("/dashboard/retargets");
  revalidatePath("/dashboard/agents");
}

/**
 * Costo por chat del formulario → número o NULL. Acepta lo que la gente teclea de
 * verdad ("1.000", "1,000", "$ 1000"): se quitan símbolos y separadores de miles.
 * Solo un valor > 0 se guarda; el resto es "sin configurar".
 */
function parseCostPerChat(raw: string | null | undefined): number | null {
  const cleaned = (raw ?? "").replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;
  // Con los dos separadores, el ÚLTIMO manda como decimal ("1.234,56" y "1,234.56").
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = cleaned.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // Una sola coma: decimal si deja 1-2 dígitos ("1000,5"), si no es de miles.
    normalized =
      cleaned.length - lastComma - 1 <= 2 ? cleaned.replace(",", ".") : cleaned.split(",").join("");
  } else if (lastDot >= 0 && cleaned.length - lastDot - 1 === 3) {
    // "1.000" en es-CO son mil pesos, no uno con tres decimales.
    normalized = cleaned.split(".").join("");
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Normaliza la temperatura a [0, 2] (default 0.3 si viene inválida). */
function cleanTemperature(t: number): number {
  if (!Number.isFinite(t)) return 0.3;
  return Math.min(2, Math.max(0, t));
}

/**
 * Construye el patch de columnas de un agente a partir del formulario. Los secretos
 * (API keys, secreto del webhook) son write-only: solo se incluyen si se pegó uno
 * nuevo (vacío = no cambiar), para no borrarlos sin querer. Ver docs/16, ADR-0023;
 * docs/24, ADR-0056.
 */
function agentPatch(input: AgentEditInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: input.name.trim(),
    brand: textOrNull(input.brand),
    country: textOrNull(input.country),
    whatsapp_number: textOrNull(input.whatsappNumber),
    provider: normalizeProviderId(input.provider),
    callbell_channel_uuid: textOrNull(input.callbellChannelUuid),
    kapso_phone_number_id: textOrNull(input.kapsoPhoneNumberId),
    kapso_template_language: textOrNull(input.kapsoTemplateLanguage),
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
    // Métodos de pago (tags de compra por agente). Se normalizan/deduplican con el
    // helper puro antes de guardar (tags válidos + method estable). Ver ADR-0055.
    payment_methods: parsePaymentMethods(input.paymentMethods) as unknown as Json,
    // Costo por chat (ROAS, ADR-0065). Vacío o no numérico → NULL = "sin configurar",
    // que el reporte distingue de un 0 (un costo 0 daría un retorno infinito).
    cost_per_chat: parseCostPerChat(input.costPerChat),
    cost_currency: (textOrNull(input.costCurrency) ?? "COP").toUpperCase(),
    // Moneda de VENTA: manda en Órdenes y se sella en cada orden nueva. Se normaliza
    // contra las monedas con tasa conocida para que nunca entre un código sin
    // conversión posible. Ver ADR-0068.
    currency: normalizeCurrency(input.currency),
  };
  const newKey = input.callbellApiKey.trim();
  if (newKey.length > 0) patch.callbell_api_key = newKey;
  const newKapsoKey = input.kapsoApiKey.trim();
  if (newKapsoKey.length > 0) patch.kapso_api_key = newKapsoKey;
  const newKapsoSecret = input.kapsoWebhookSecret.trim();
  if (newKapsoSecret.length > 0) patch.kapso_webhook_secret = newKapsoSecret;
  return patch;
}

/**
 * Traduce el 42703 (columna inexistente) de un guardado de agente a algo accionable.
 *
 * La LECTURA de agentes sobrevive sin la migración 0026 (`selectAgents` reintenta con
 * las columnas viejas), así que el inbound nunca se cae. La ESCRITURA no puede hacer lo
 * mismo: reintentar sin `provider` guardaría el agente **ignorando en silencio** el
 * proveedor que el operador acaba de elegir, que es peor que fallar. Así que falla, pero
 * diciendo exactamente qué hacer — mismo criterio que `setHotmartAgent` con la 0020.
 */
function missingProviderMigration(error: { code?: string; message?: string }): string | null {
  if (error.code !== "42703") return null;
  // El mensaje de Postgres nombra la columna que falta → se dice QUÉ migración.
  return /cost_(per_chat|currency)/.test(error.message ?? "")
    ? "Falta aplicar la migración 0028 (costo por chat) en Supabase."
    : "Falta aplicar la migración 0026 (provider + credenciales de Kapso) en Supabase.";
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
  if (error) throw new Error(`saveAgent: ${missingProviderMigration(error) ?? error.message}`);

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
  if (error) throw new Error(`createAgent: ${missingProviderMigration(error) ?? error.message}`);

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
 * Carga el catálogo de productos de un agente desde el dashboard, en tres flujos:
 *  - `create`: crea el vector store del agente (si no tiene), reconstruye el documento
 *    del catálogo y hace upsert en `products`; guarda el `vector_store_id`.
 *  - `add`: MANTIENE el vector store actual y agrega/actualiza los productos del JSON
 *    (merge: el documento se reconstruye desde TODO el catálogo en la BD, así no se
 *    pierde lo anterior). Ideal para agregar uno o pocos productos. Ver ADR-0048.
 *  - `existing`: el agente ya tiene un `vector_store_id`; los productos se cargan SOLO a
 *    `products` (Supabase) sin tocar el store.
 *
 * Reusa `runCatalogImport` (idempotente por `(agent_id, sku)`). Corre server-side con
 * service-role, protegida por el Basic Auth del dashboard. Devuelve el resultado para
 * mostrar en la UI (N cargados, vector store, avisos/errores). Ver docs/16, ADR-0028.
 */
export async function loadAgentCatalog(
  agentId: string,
  input: AgentCatalogInput,
): Promise<CatalogImportResult> {
  const vectorStoreMode =
    input.mode === "create" ? "create" : input.mode === "add" ? "sync" : "supabase-only";

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

  // Proveedor del agente de la conversación (Callbell o Kapso, con sus credenciales).
  const agent = await loadAgentForConversation(supabase, convo.agent_id);
  const messaging = agent ? providerForAgent(agent) : callbellProviderFromEnv();

  // Enviar (lanza si la API responde error, p. ej. fuera de la ventana 24h).
  const sent = await messaging.sendText(contact.phone, clean, {
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

// ============================================================================
// Labels (etiquetas de conversaciones) — ver docs/18, ADR-0036
// ============================================================================

export type Label = {
  id: string;
  name: string;
  color: string;
  agent_id: string | null;
};

/**
 * Obtiene todas las etiquetas disponibles para un agente (globales + las del agente).
 * Resiliente: devuelve array vacío si la tabla no existe o hay error.
 */
export async function getLabels(agentId?: string | null): Promise<Label[]> {
  try {
    const supabase = createServiceClient();

    let query = supabase.from("labels").select("id, name, color, agent_id").order("name");

    if (agentId) {
      // Globales (agent_id = null) + las de este agente
      query = query.or(`agent_id.is.null,agent_id.eq.${agentId}`);
    } else {
      // Solo globales si no hay agente
      query = query.is("agent_id", null);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[getLabels] error:", error.message);
      return [];
    }
    return (data ?? []) as Label[];
  } catch (e) {
    console.error("[getLabels] unexpected error:", e);
    return [];
  }
}

/**
 * Obtiene las etiquetas de una conversación específica.
 * Resiliente: devuelve array vacío si la tabla no existe o hay error.
 */
export async function getConversationLabels(conversationId: string): Promise<Label[]> {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("conversation_labels")
      .select("label_id, labels(id, name, color, agent_id)")
      .eq("conversation_id", conversationId);

    if (error) {
      console.error("[getConversationLabels] error:", error.message);
      return [];
    }

    // eslint-disable-next-line
    return (data ?? []).map((row: any) => row.labels).filter(Boolean) as Label[];
  } catch (e) {
    console.error("[getConversationLabels] unexpected error:", e);
    return [];
  }
}

/**
 * Crea una etiqueta nueva. Devuelve el id de la etiqueta creada.
 */
export async function createLabel(input: {
  name: string;
  color: string;
  agentId?: string | null;
}): Promise<string> {
  const name = input.name.trim();
  if (name.length === 0) throw new Error("El nombre de la etiqueta es obligatorio.");

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("labels")
    .insert({
      name,
      color: input.color || "#6B7280",
      agent_id: input.agentId || null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("Ya existe una etiqueta con ese nombre.");
    }
    throw new Error(`createLabel: ${error.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "label_created",
    payload: { labelId: data.id, name, color: input.color } as unknown as Json,
  });

  return data.id;
}

/**
 * Agrega una etiqueta a una conversación. Idempotente.
 */
export async function addLabelToConversation(
  conversationId: string,
  labelId: string,
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("conversation_labels")
    .upsert({ conversation_id: conversationId, label_id: labelId }, { onConflict: "conversation_id,label_id" });

  if (error) throw new Error(`addLabelToConversation: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "label_added",
    payload: { labelId } as unknown as Json,
  });

  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
}

/**
 * Quita una etiqueta de una conversación.
 */
export async function removeLabelFromConversation(
  conversationId: string,
  labelId: string,
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("conversation_labels")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("label_id", labelId);

  if (error) throw new Error(`removeLabelFromConversation: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "label_removed",
    payload: { labelId } as unknown as Json,
  });

  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
}

/**
 * Elimina una etiqueta del catálogo (cascade borra las asociaciones).
 */
export async function deleteLabel(labelId: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.from("labels").delete().eq("id", labelId);

  if (error) throw new Error(`deleteLabel: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "label_deleted",
    payload: { labelId } as unknown as Json,
  });

  revalidatePath("/dashboard/conversations");
}

// --- Videos por palabra clave (ver docs/20, ADR-0038) -----------------------

/**
 * Crea una regla de video: cuando la respuesta del bot menciona `keyword`, envía
 * `videoUrl`. `agentId` fija el MERCADO/marca (null = global → aplica a todas). El
 * backend carga los del agente de la conversación + los globales, así los videos de
 * Colombia no salen en México/EE.UU. y viceversa. Valida palabra no vacía y URL
 * http(s). Server-side con service-role, protegida por el Basic Auth del dashboard.
 */
export async function createVideo(
  keyword: string,
  videoUrl: string,
  caption?: string,
  agentId?: string | null,
): Promise<string> {
  const kw = keyword.trim();
  const url = videoUrl.trim();
  if (!kw) throw new Error("La palabra clave no puede estar vacía.");
  if (!/^https?:\/\/\S+/i.test(url))
    throw new Error("La URL del video debe empezar por http:// o https://");
  const agent_id = agentId && agentId.trim() ? agentId.trim() : null;

  const supabase = createServiceClient();
  let res = await supabase
    .from("videos")
    .insert({ keyword: kw, video_url: url, caption: textOrNull(caption ?? ""), agent_id })
    .select("id")
    .single();
  // Ventana de migración: si aún no existe la columna caption (0017), guarda sin ella.
  if (res.error?.code === "42703") {
    res = await supabase
      .from("videos")
      .insert({ keyword: kw, video_url: url, agent_id })
      .select("id")
      .single();
  }
  const { data, error } = res;
  if (error) {
    // El índice único (palabra por marca) da 23505 si ya existe esa palabra en el mercado.
    if (error.code === "23505")
      throw new Error(
        agent_id
          ? `Ya existe un video para "${kw}" en ese mercado.`
          : `Ya existe un video global para "${kw}".`,
      );
    throw new Error(`createVideo: ${error.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "video_created",
    payload: { keyword: kw, agentId: agent_id } as unknown as Json,
  });
  revalidatePath("/dashboard/videos");
  return data.id;
}

/** Edita una regla de video (palabra, URL, caption y/o mercado) y guarda. */
export async function updateVideo(
  id: string,
  input: { keyword: string; videoUrl: string; caption?: string; agentId?: string | null },
): Promise<void> {
  const kw = input.keyword.trim();
  const url = input.videoUrl.trim();
  if (!kw) throw new Error("La palabra clave no puede estar vacía.");
  if (!/^https?:\/\/\S+/i.test(url))
    throw new Error("La URL del video debe empezar por http:// o https://");
  const agent_id = input.agentId && input.agentId.trim() ? input.agentId.trim() : null;

  const supabase = createServiceClient();
  let { error } = await supabase
    .from("videos")
    .update({ keyword: kw, video_url: url, caption: textOrNull(input.caption ?? ""), agent_id })
    .eq("id", id);
  // Ventana de migración: si aún no existe la columna caption (0017), guarda sin ella.
  if (error?.code === "42703") {
    ({ error } = await supabase
      .from("videos")
      .update({ keyword: kw, video_url: url, agent_id })
      .eq("id", id));
  }
  if (error) {
    if (error.code === "23505")
      throw new Error(
        agent_id
          ? `Ya existe un video para "${kw}" en ese mercado.`
          : `Ya existe un video global para "${kw}".`,
      );
    throw new Error(`updateVideo: ${error.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "video_updated",
    payload: { videoId: id, keyword: kw, agentId: agent_id } as unknown as Json,
  });
  revalidatePath("/dashboard/videos");
}

/** Activa o desactiva una regla de video (sin borrarla). */
export async function setVideoEnabled(id: string, enabled: boolean): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("videos").update({ enabled }).eq("id", id);
  if (error) throw new Error(`setVideoEnabled: ${error.message}`);
  revalidatePath("/dashboard/videos");
}

/** Elimina una regla de video. */
export async function deleteVideo(id: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("videos").delete().eq("id", id);
  if (error) throw new Error(`deleteVideo: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "video_deleted",
    payload: { videoId: id } as unknown as Json,
  });
  revalidatePath("/dashboard/videos");
}

// --- Fuente de producto de la conversación (ver docs/21) --------------------

/**
 * Fija o cambia la fuente/producto de una conversación (ej. "magnesio"). Vacío =
 * quita la categoría. Sirve para categorizar a mano conversaciones viejas o
 * corregir la autodetección. Corre server-side con service-role.
 */
export async function setConversationProductCategory(
  conversationId: string,
  category: string | null,
): Promise<void> {
  const value = textOrNull(category ?? "");
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("conversations")
    .update({ product_category: value })
    .eq("id", conversationId);
  if (error) {
    if (error.code === "42703")
      throw new Error("Falta aplicar la migración 0018 (product_category) en Supabase.");
    throw new Error(`setConversationProductCategory: ${error.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: "product_category_set",
    payload: { category: value } as unknown as Json,
  });
  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
}

// --- Plantillas de Hotmart (dashboard, ver docs/17, ADR-0040) ---------------

const DEFAULT_HOTMART_EVENT = "PURCHASE_OUT_OF_SHOPPING_CART";

export interface HotmartTemplateInput {
  name: string;
  templateUuid: string;
  messageText: string;
  /** Producto de Hotmart (id); vacío = aplica a todos. */
  productId?: string;
  /** Agente dueño; vacío/null = global (todas las marcas). */
  agentId?: string | null;
}

/** Traduce el 42P01 (tabla ausente) a un mensaje accionable para el operador. */
function hotmartTableError(code?: string): string | null {
  if (code === "42P01")
    return "Falta aplicar la migración 0019 (hotmart_templates) en Supabase.";
  return null;
}

/**
 * Crea una plantilla de Hotmart (carrito abandonado). Global por defecto
 * (agent_id null). Valida nombre. Service-role, protegida por el Basic Auth.
 */
export async function createHotmartTemplate(input: HotmartTemplateInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre de la plantilla es obligatorio.");

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("hotmart_templates")
    .insert({
      name,
      event_type: DEFAULT_HOTMART_EVENT,
      template_uuid: textOrNull(input.templateUuid),
      message_text: textOrNull(input.messageText),
      product_id: textOrNull(input.productId ?? ""),
      agent_id: input.agentId || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(hotmartTableError(error.code) ?? `createHotmartTemplate: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "hotmart_template_created",
    payload: { id: data.id, name } as unknown as Json,
  });
  revalidatePath("/dashboard/hotmart");
  return data.id;
}

/** Edita una plantilla de Hotmart (nombre, UUID, texto, producto, agente). */
export async function updateHotmartTemplate(
  id: string,
  input: HotmartTemplateInput,
): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre de la plantilla es obligatorio.");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("hotmart_templates")
    .update({
      name,
      template_uuid: textOrNull(input.templateUuid),
      message_text: textOrNull(input.messageText),
      product_id: textOrNull(input.productId ?? ""),
      agent_id: input.agentId || null,
    })
    .eq("id", id);
  if (error) throw new Error(hotmartTableError(error.code) ?? `updateHotmartTemplate: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "hotmart_template_updated",
    payload: { id, name } as unknown as Json,
  });
  revalidatePath("/dashboard/hotmart");
}

/** Activa o desactiva una plantilla de Hotmart (sin borrarla). */
export async function setHotmartTemplateEnabled(id: string, enabled: boolean): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("hotmart_templates").update({ enabled }).eq("id", id);
  if (error) throw new Error(hotmartTableError(error.code) ?? `setHotmartTemplateEnabled: ${error.message}`);
  revalidatePath("/dashboard/hotmart");
}

/** Elimina una plantilla de Hotmart. */
export async function deleteHotmartTemplate(id: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("hotmart_templates").delete().eq("id", id);
  if (error) throw new Error(hotmartTableError(error.code) ?? `deleteHotmartTemplate: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "hotmart_template_deleted",
    payload: { id } as unknown as Json,
  });
  revalidatePath("/dashboard/hotmart");
}

/**
 * Designa qué agente maneja los eventos de Hotmart (marca `hotmart_enabled`).
 * Exclusivo: apaga la marca en todos y la prende en el elegido. `null` = ninguno
 * (usa el fallback env/primer-activo). Ver ADR-0041.
 */
export async function setHotmartAgent(agentId: string | null): Promise<void> {
  const supabase = createServiceClient();

  // Apagar la marca en cualquier agente que la tuviera (exclusividad).
  const off = await supabase
    .from("agents")
    .update({ hotmart_enabled: false })
    .eq("hotmart_enabled", true);
  if (off.error) {
    if (off.error.code === "42703")
      throw new Error("Falta aplicar la migración 0020 (hotmart_enabled) en Supabase.");
    throw new Error(`setHotmartAgent off: ${off.error.message}`);
  }

  // Prender en el agente elegido (si hay).
  if (agentId) {
    const on = await supabase.from("agents").update({ hotmart_enabled: true }).eq("id", agentId);
    if (on.error) throw new Error(`setHotmartAgent on: ${on.error.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "hotmart_agent_set",
    payload: { agentId } as unknown as Json,
  });
  revalidatePath("/dashboard/hotmart");
  revalidatePath("/dashboard/agents");
}

// --- Inventario: imagen del producto (ver docs/22, ADR-0042) ----------------

/**
 * Cambia SOLO el `image_url` de un producto (la foto que el bot envía por WhatsApp).
 * Vacío = quita la imagen. Valida que sea http(s). **No** toca el vector store ni
 * sube archivos: es solo el link que se reenvía a Callbell. Service-role, protegida
 * por el Basic Auth del dashboard. Ver ADR-0042.
 */
export async function updateProductImage(productId: string, imageUrl: string): Promise<void> {
  const url = imageUrl.trim();
  if (url.length > 0 && !/^https?:\/\/\S+/i.test(url))
    throw new Error("El link de la imagen debe empezar por http:// o https://");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("products")
    .update({ image_url: url.length > 0 ? url : null })
    .eq("id", productId);
  if (error) throw new Error(`updateProductImage: ${error.message}`);

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "product_image_updated",
    payload: { productId, hasImage: url.length > 0 } as unknown as Json,
  });
  revalidatePath("/dashboard/inventory");
}

// --- Llamadas con IA (Synthflow) — docs/25, ADR-0060..0063 ------------------

/**
 * Cancela llamadas PROGRAMADAS. Acepta varias de un golpe (multi-selección en la
 * sección Llamadas) porque el caso de uso es justamente "por si acaso, tumba
 * estas cinco". Solo toca las que aún no salieron: una llamada ya colocada no se
 * puede des-hacer.
 */
export async function cancelVoiceCalls(ids: string[]): Promise<number> {
  const clean = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (clean.length === 0) return 0;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("voice_calls")
    .update({ status: "cancelled", error: "cancelled_from_dashboard" })
    .in("id", clean)
    .eq("status", "scheduled")
    .select("id, conversation_id");
  if (error) {
    if (error.code === "42P01") {
      throw new Error("Falta aplicar la migración 0027 (llamadas con IA) en Supabase.");
    }
    throw new Error(`cancelVoiceCalls: ${error.message}`);
  }

  const rows = data ?? [];
  for (const row of rows) {
    await supabase.from("events_log").insert({
      conversation_id: (row as { conversation_id: string }).conversation_id,
      type: "voice_call_cancelled",
      payload: { voiceCallId: (row as { id: string }).id, reason: "dashboard" } as unknown as Json,
    });
  }

  revalidatePath("/dashboard/calls");
  revalidatePath("/dashboard");
  return rows.length;
}

/**
 * Dispara una llamada con IA YA, desde el detalle de la conversación.
 * Devuelve el error en texto (no lanza) para poder mostrarlo en la UI: las
 * causas normales —agente apagado, fuera de horario, país no habilitado— son
 * información útil para el operador, no fallas del sistema.
 */
export async function triggerVoiceCall(
  conversationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await triggerVoiceCallNow(conversationId);
  if (result.ok) {
    revalidatePath(`/dashboard/conversations/${conversationId}`);
    revalidatePath("/dashboard/calls");
  }
  return result;
}

/**
 * Guarda la config de voz de un agente y **sincroniza los extractores con
 * Synthflow** (crear / actualizar / adjuntar / quitar). La sincronización puede
 * fallar por red: en ese caso se guarda igual la config local y se devuelve el
 * aviso, para no perder lo que el operador escribió. Ver ADR-0062.
 */
export async function saveVoiceConfig(
  agentId: string,
  input: VoiceConfigInput,
): Promise<{ ok: boolean; warning?: string }> {
  const supabase = createServiceClient();

  const stages = parseVoiceConfig(input.stages);
  const extractors = parseVoiceExtractors(input.extractors);
  const countries = parseVoiceCountries(input.countries);

  const patch: Record<string, unknown> = {
    voice_enabled: input.voiceEnabled,
    synthflow_model_id: textOrNull(input.modelId),
    synthflow_from_number: textOrNull(input.fromNumber),
    voice_id: textOrNull(input.voiceId),
    voice_name: textOrNull(input.voiceName),
    voice_prompt: textOrNull(input.prompt),
    voice_greeting: textOrNull(input.greeting),
    voice_config: (stages.length > 0 ? stages : null) as unknown as Json,
    voice_countries: (countries.length > 0 ? countries : null) as unknown as Json,
    voice_stop_when_answered: input.stopWhenAnswered,
  };
  // El secreto solo se pisa si pegaron uno nuevo (patrón del resto de credenciales).
  const newKey = (input.apiKey ?? "").trim();
  if (newKey.length > 0) patch.synthflow_api_key = newKey;

  // Sincronizar extractores ANTES de guardar, para persistir los `actionId`.
  let warning: string | undefined;
  let synced = extractors;
  if (input.modelId && extractors.length > 0) {
    try {
      synced = await syncExtractorsWithSynthflow(supabase, agentId, input.modelId, extractors);
    } catch (e) {
      warning = `La config se guardó, pero no se pudieron sincronizar los extractores con Synthflow: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }
  }
  patch.voice_extractors = (synced.length > 0 ? synced : null) as unknown as Json;

  const { error } = await supabase
    .from("agents")
    .update(patch as never)
    .eq("id", agentId);
  if (error) {
    if (error.code === "42703") {
      throw new Error("Falta aplicar la migración 0027 (llamadas con IA) en Supabase.");
    }
    throw new Error(`saveVoiceConfig: ${error.message}`);
  }

  await supabase.from("events_log").insert({
    conversation_id: null,
    type: "voice_config_updated",
    payload: {
      agentId,
      enabled: input.voiceEnabled,
      stages: stages.length,
      extractors: synced.length,
    } as unknown as Json,
  });

  revalidatePath("/dashboard/agents");
  revalidatePath(`/dashboard/agents/${agentId}`);
  revalidatePath("/dashboard/calls");
  return { ok: true, warning };
}

/**
 * Crea/actualiza en Synthflow los extractores del agente y los adjunta a su
 * assistant. Devuelve la lista con los `actionId` resueltos para persistirlos.
 */
async function syncExtractorsWithSynthflow(
  supabase: ReturnType<typeof createServiceClient>,
  agentId: string,
  modelId: string,
  extractors: VoiceExtractor[],
): Promise<VoiceExtractor[]> {
  const agent = await loadAgentVoiceConfig(supabase, agentId);
  if (!agent) throw new Error("No se pudo leer la config de voz del agente.");
  const creds = credsFor(agent);

  const out: VoiceExtractor[] = [];
  for (const extractor of extractors) {
    if (extractor.actionId) {
      try {
        await updateExtractor(creds, extractor.actionId, extractor);
        out.push(extractor);
        continue;
      } catch {
        // El id quedó colgado (lo borraron desde el panel de Synthflow): se recrea.
      }
    }
    const actionId = await createExtractor(creds, extractor);
    out.push({ ...extractor, actionId });
  }

  await attachActions(
    creds,
    modelId,
    out.map((e) => e.actionId).filter((id): id is string => Boolean(id)),
  );
  return out;
}

/**
 * Trae las voces disponibles en Synthflow para el selector del dashboard.
 * Devuelve `[]` con un mensaje si falta configuración, en vez de romper la página.
 */
export async function listSynthflowVoices(
  agentId: string,
  search?: string,
): Promise<{ voices: SynthflowVoice[]; error?: string }> {
  try {
    const supabase = createServiceClient();
    const agent = await loadAgentVoiceConfig(supabase, agentId);
    if (!agent) return { voices: [], error: "Falta aplicar la migración 0027." };
    const voices = await listVoices(credsFor(agent), { search, max: 300 });
    return { voices };
  } catch (e) {
    return { voices: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Sincroniza la voz elegida con el assistant de Synthflow (read-modify-write). */
export async function syncVoiceToSynthflow(
  agentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = createServiceClient();
    const agent = await loadAgentVoiceConfig(supabase, agentId);
    if (!agent) return { ok: false, error: "Falta aplicar la migración 0027." };
    if (!agent.modelId) return { ok: false, error: "El agente no tiene assistant de Synthflow." };
    if (!agent.voiceId) return { ok: false, error: "El agente no tiene voz seleccionada." };
    await syncAssistantVoice(credsFor(agent), agent.modelId, agent.voiceId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
