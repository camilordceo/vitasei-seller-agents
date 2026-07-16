import type { FulfillmentMethod } from "@/lib/supabase/types";
import type { OrderDraft, OrderItemDraft } from "@/lib/openai/extractOrder";
import { formatCOP } from "@/lib/dashboard/format";

/**
 * Lógica PURA de armado de orden (Sprint 5): transcript para la extracción,
 * total y normalización de ítems. Sin I/O; testeable con Vitest.
 */

export interface TranscriptMessage {
  direction: "inbound" | "outbound";
  content: string | null;
}

/** Convierte los mensajes en un transcript legible para la extracción. */
export function buildTranscript(messages: TranscriptMessage[]): string {
  return messages
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => `${m.direction === "inbound" ? "Cliente" : "Asesor"}: ${m.content!.trim()}`)
    .join("\n");
}

/** Suma qty * unit_price de los ítems con precio; null si ninguno tiene precio. */
export function computeOrderTotal(
  items: Array<{ qty: number; unit_price: number | null }>,
): number | null {
  let total = 0;
  let any = false;
  for (const it of items) {
    if (it.unit_price != null && Number.isFinite(it.unit_price)) {
      total += normalizeQty(it.qty) * it.unit_price;
      any = true;
    }
  }
  return any ? total : null;
}

/** qty entero >= 1 (la DB exige qty > 0). */
export function normalizeQty(qty: number): number {
  const n = Math.floor(qty);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Método de fulfillment definitivo: prioriza el ya elegido en la conversación
 * (por el tag de pago del agente); si sigue `undecided`/vacío, usa el del draft
 * (extracción, solo conoce addi/cod). El método es texto libre (ADR-0055).
 */
export function resolveFulfillmentMethod(
  conversationMethod: FulfillmentMethod,
  draftMethod: string | null,
): FulfillmentMethod {
  if (conversationMethod && conversationMethod !== "undecided") return conversationMethod;
  if (draftMethod === "addi" || draftMethod === "cod") return draftMethod;
  return "undecided";
}

const METHOD_LABEL_FALLBACK: Record<string, string> = {
  addi: "Addi",
  cod: "Contra entrega",
  undecided: "Sin definir",
};

/**
 * Texto del aviso de venta para el dueño (WhatsApp): cliente, método, total,
 * productos y datos de envío. Puro (fácil de ajustar el formato / testear).
 * La marca y la etiqueta del método vienen del agente (multi-marca, ADR-0055).
 */
export function buildSaleNotification(info: {
  /** Teléfono del cliente en E.164 sin '+'. */
  clientPhone: string;
  method: string;
  /** Nombre visible del método (config del agente); fallback a un mapa conocido. */
  methodLabel?: string | null;
  /** Marca del agente para el encabezado (default "Vitasei" para no romper CO). */
  brand?: string;
  total: number | null;
  draft: OrderDraft;
}): string {
  const { clientPhone, method, total, draft } = info;
  const brand = info.brand?.trim() || "Vitasei";
  const methodLabel = info.methodLabel?.trim() || METHOD_LABEL_FALLBACK[method] || method;
  const lines: string[] = [`🛒 Nueva venta — ${brand}`, ""];

  const name = draft.shipping.name?.trim();
  lines.push(`Cliente: ${name ? `${name} · ` : ""}+${clientPhone}`);
  lines.push(`Método: ${methodLabel}`);
  lines.push(`Total: ${total != null ? formatCOP(total) : "por confirmar"}`);

  if (draft.items.length > 0) {
    lines.push("", "Productos:");
    for (const it of draft.items) {
      const qty = normalizeQty(it.qty);
      const label = [it.name, it.sku].filter(Boolean).join(" ") || "(sin nombre)";
      const price = it.unit_price != null ? ` — ${formatCOP(it.unit_price)}` : "";
      lines.push(`• ${qty}x ${label}${price}`);
    }
  }

  const s = draft.shipping;
  if (s.name || s.address || s.city || s.phone) {
    lines.push("", "Envío:");
    if (s.name) lines.push(s.name);
    const addr = [s.address, s.city].filter(Boolean).join(", ");
    if (addr) lines.push(addr);
    if (s.phone) lines.push(`Tel: ${s.phone}`);
  }

  if (draft.notes?.trim()) lines.push("", `Notas: ${draft.notes.trim()}`);

  return lines.join("\n");
}

/** Quita acentos y baja a minúsculas para comparar frases sin depender de tildes. */
function normalizeForMatch(text: string): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * ¿El texto que ve el cliente es un CIERRE de compra confirmado? Red de seguridad
 * para cuando el modelo cierra la venta pero olvida emitir `#orden-lista` (emite
 * solo `#compra-contra-entrega`/`#addi`). Se usa junto con "método ya decidido" y
 * "hay datos reales" para inferir la orden — el gate de datos permite ampliar las
 * frases sin crear órdenes vacías. Ver ADR-0031 y ADR-0039.
 */
export function isPurchaseConfirmation(cleanText: string): boolean {
  const t = normalizeForMatch(cleanText);
  return (
    /\bqued[oa]\s+(confirmad|registrad|list)[oa]\b/.test(t) || // "queda confirmado/registrado/listo"
    /\b(pedido|orden|compra)\s+(esta\s+|ya\s+)?(confirmad|registrad|list)[oa]\b/.test(t) || // "pedido (ya) confirmado/listo"
    /\b(confirmad|registrad|list)[oa]\s+(tu|el|la)\s+(pedido|orden|compra)\b/.test(t) || // "confirmada tu compra"
    /\bconfirm(o|amos)\s+(tu|el|la)\s+(pedido|orden|compra)\b/.test(t) || // "confirmo/confirmamos tu pedido"
    /\bgracias\s+por\s+tu\s+(compra|pedido|orden)\b/.test(t) // "gracias por tu compra/pedido/orden"
  );
}

/**
 * ¿La extracción encontró datos REALES de orden (ítems o algún dato de envío)?
 * Gate para NO crear una orden vacía cuando el cliente solo eligió método
 * (#compra-contra-entrega/#addi) antes de dar sus datos. `#orden-lista` (explícito)
 * ignora este gate. Ver ADR-0039.
 */
export function hasOrderData(draft: OrderDraft): boolean {
  const s = draft.shipping;
  return (
    draft.items.length > 0 ||
    Boolean(s.name?.trim() || s.address?.trim() || s.city?.trim() || s.phone?.trim())
  );
}

/** Normaliza un ítem del draft a los campos de `order_items` (sku no nulo). */
export function normalizeOrderItem(it: OrderItemDraft): {
  sku: string;
  name: string | null;
  qty: number;
  unit_price: number | null;
} {
  return {
    sku: (it.sku ?? "").trim(),
    name: it.name ?? null,
    qty: normalizeQty(it.qty),
    unit_price: it.unit_price ?? null,
  };
}
