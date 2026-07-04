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
 * (por `#addi`/`#compra-contra-entrega`); si sigue `undecided`, usa el del draft.
 */
export function resolveFulfillmentMethod(
  conversationMethod: FulfillmentMethod,
  draftMethod: string | null,
): FulfillmentMethod {
  if (conversationMethod === "addi" || conversationMethod === "cod") return conversationMethod;
  if (draftMethod === "addi" || draftMethod === "cod") return draftMethod;
  return "undecided";
}

const METHOD_LABEL_ES: Record<string, string> = {
  addi: "Addi",
  cod: "Contra entrega",
  undecided: "Sin definir",
};

/**
 * Texto del aviso de venta para el dueño (WhatsApp): cliente, método, total,
 * productos y datos de envío. Puro (fácil de ajustar el formato / testear).
 */
export function buildSaleNotification(info: {
  /** Teléfono del cliente en E.164 sin '+'. */
  clientPhone: string;
  method: string;
  total: number | null;
  draft: OrderDraft;
}): string {
  const { clientPhone, method, total, draft } = info;
  const lines: string[] = ["🛒 Nueva venta — Vitasei", ""];

  const name = draft.shipping.name?.trim();
  lines.push(`Cliente: ${name ? `${name} · ` : ""}+${clientPhone}`);
  lines.push(`Método: ${METHOD_LABEL_ES[method] ?? method}`);
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
 * solo `#compra-contra-entrega`/`#addi`). Se usa junto con "método ya decidido"
 * para inferir la orden. Frases DELIBERADAMENTE estrictas (solo aparecen en el
 * cierre real, no al arrancar la recolección de datos). Ver ADR-0031.
 */
export function isPurchaseConfirmation(cleanText: string): boolean {
  const t = normalizeForMatch(cleanText);
  return (
    /\bqued[oa]\s+confirmad[oa]\b/.test(t) || // "queda/quedó confirmado/a"
    /\b(pedido|orden|compra)\s+(esta\s+)?confirmad[oa]\b/.test(t) || // "pedido (está) confirmado"
    /\bconfirmad[oa]\s+(tu|el|la)\s+(pedido|orden|compra)\b/.test(t) || // "confirmada tu compra"
    /\bgracias\s+por\s+tu\s+(compra|pedido)\b/.test(t) // "gracias por tu compra/pedido"
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
